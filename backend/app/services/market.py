from dataclasses import dataclass
from datetime import datetime, timedelta
from threading import Lock, Thread
from zoneinfo import ZoneInfo

from psycopg import Error as PsycopgError

from app.domain.models import (
    DataMode,
    IndexQuote,
    MarketNewsItem,
    MarketOverview,
    MarketPulse,
    MarketPulseMetrics,
    Provenance,
    QuoteBatch,
    SectorSnapshot,
    StockDetail,
    StockProfile,
    StockQuote,
    StockSearchItem,
    StockSeries,
)
from app.providers.base import MarketDataProvider, MarketProviderError
from app.providers.demo import DemoMarketDataProvider
from app.providers.eastmoney import EastmoneyStockProvider


@dataclass
class _CacheEntry:
    overview: MarketOverview
    expires_at: datetime


@dataclass
class _BreadthEntry:
    metrics: MarketPulseMetrics
    observed_at: datetime
    expires_at: datetime


@dataclass
class _PulseCore:
    indices: list[IndexQuote]
    turnover: float
    limit_up: int | None
    limit_down: int | None
    observed_at: datetime
    expires_at: datetime


class MarketService:
    def __init__(
        self, provider_name: str = "auto", cache_ttl_seconds: int = 60, snapshot_store=None
    ) -> None:
        self.provider_name = provider_name.lower()
        self.snapshot_store = snapshot_store
        self.cache_ttl = timedelta(seconds=cache_ttl_seconds)
        self.demo_provider = DemoMarketDataProvider()
        self.stock_provider = EastmoneyStockProvider()
        self.live_provider: MarketDataProvider = self.stock_provider
        self._cache: _CacheEntry | None = None
        self._breadth_cache: _BreadthEntry | None = None
        self._pulse_core: _PulseCore | None = None
        self._overview_refreshing = False
        self._breadth_refreshing = False
        self._breadth_failed = False
        self._breadth_retry_at: datetime | None = None
        self._resource_cache: dict[str, tuple[datetime, object]] = {}
        self._resource_locks: dict[str, Lock] = {}
        self._lock = Lock()
        self._overview_lock = Lock()
        self._pulse_lock = Lock()

    def get_overview(self, force_refresh: bool = False) -> MarketOverview:
        now = datetime.now(tz=ZoneInfo("Asia/Shanghai"))
        if not force_refresh and self.provider_name != "demo":
            with self._lock:
                cached = self._cache
            if cached is not None:
                if now >= cached.expires_at:
                    self._schedule_overview_refresh()
                return self._as_cached(cached.overview, now)
            persisted = self._load_persisted_overview()
            if persisted is not None:
                persisted.provenance.mode = DataMode.CACHED
                with self._lock:
                    self._cache = _CacheEntry(
                        overview=persisted, expires_at=now + self.cache_ttl
                    )
                self._schedule_overview_refresh()
                return self._as_cached(persisted, now)

        with self._overview_lock:
            if not force_refresh and self._cache and now < self._cache.expires_at:
                return self._as_cached(self._cache.overview, now)

            if self.provider_name == "demo":
                overview = self.demo_provider.get_market_overview()
            else:
                try:
                    overview = self.live_provider.get_market_overview()
                    baseline = self.demo_provider.get_market_overview()
                    overview.sectors = self._enrich_display_sectors(
                        overview.sectors, baseline.sectors
                    )
                    if not overview.industry_sectors:
                        overview.industry_sectors = [
                            sector for sector in overview.sectors
                            if sector.name not in {"A股", "沪市主板", "深市主板", "创业板", "科创板", "北交所"}
                        ]
                except MarketProviderError as exc:
                    overview = self._load_persisted_overview()
                    if overview is None:
                        overview = self.demo_provider.get_market_overview()
                    else:
                        overview.provenance.mode = DataMode.CACHED
                    overview.provenance.fallback_reason = str(exc)

            overview.industry_sectors = self._enrich_industry_sectors(
                overview.industry_sectors, overview.sectors
            )
            if overview.provenance.mode in {DataMode.LIVE, DataMode.DELAYED}:
                self._persist_overview(overview)

            completed_at = datetime.now(tz=ZoneInfo("Asia/Shanghai"))
            with self._lock:
                if overview.industry_sectors:
                    self._resource_cache["market-sectors"] = (
                        completed_at + self.cache_ttl,
                        overview.industry_sectors,
                    )
                self._cache = _CacheEntry(overview=overview, expires_at=completed_at + self.cache_ttl)
            return overview

    def _schedule_overview_refresh(self) -> None:
        with self._lock:
            if self._overview_refreshing:
                return
            self._overview_refreshing = True
        Thread(target=self._refresh_overview, name="finmate-overview-refresh", daemon=True).start()

    def _refresh_overview(self) -> None:
        try:
            self.get_overview(force_refresh=True)
        finally:
            with self._lock:
                self._overview_refreshing = False

    def get_pulse(self, force_refresh: bool = False) -> MarketPulse:
        now = datetime.now(tz=ZoneInfo("Asia/Shanghai"))
        if self.provider_name == "demo":
            overview = self.demo_provider.get_market_overview()
            return MarketPulse(
                indices=overview.indices,
                metrics=MarketPulseMetrics(**overview.metrics.model_dump()),
                breadth_status="ready",
                provenance=overview.provenance,
            )

        with self._pulse_lock:
            core = self._pulse_core
            if force_refresh or core is None or now >= core.expires_at:
                indices, turnover, observed_at = self.stock_provider.market_indices()
                completed_at = datetime.now(tz=ZoneInfo("Asia/Shanghai"))
                core = _PulseCore(
                    indices=indices,
                    turnover=turnover,
                    limit_up=None,
                    limit_down=None,
                    observed_at=observed_at,
                    expires_at=completed_at + timedelta(seconds=30),
                )
                self._pulse_core = core
            indices = core.indices
            turnover = core.turnover
            limit_up = core.limit_up
            limit_down = core.limit_down
            observed_at = core.observed_at
        with self._lock:
            breadth = self._breadth_cache
            needs_refresh = force_refresh or breadth is None or now >= breadth.expires_at
            retry_allowed = self._breadth_retry_at is None or now >= self._breadth_retry_at
            start_refresh = needs_refresh and retry_allowed and not self._breadth_refreshing
            if start_refresh:
                self._breadth_refreshing = True
            failed = self._breadth_failed
        if start_refresh:
            Thread(target=self._refresh_breadth, name="finmate-breadth-refresh", daemon=True).start()

        if breadth is None:
            metrics = MarketPulseMetrics(
                limit_up=limit_up,
                limit_down=limit_down,
                turnover_billion_cny=turnover,
            )
            status = "unavailable" if failed else "updating"
        else:
            metrics = breadth.metrics.model_copy(update={
                "limit_up": limit_up if limit_up is not None else breadth.metrics.limit_up,
                "limit_down": limit_down if limit_down is not None else breadth.metrics.limit_down,
                "turnover_billion_cny": turnover,
            })
            status = "ready"
        return MarketPulse(
            indices=indices,
            metrics=metrics,
            breadth_status=status,
            provenance=Provenance(
                source="tencent-index-and-a-share-breadth",
                mode=DataMode.LIVE,
                observed_at=observed_at,
                retrieved_at=now,
            ),
        )

    def _refresh_breadth(self) -> None:
        try:
            metrics, observed_at = self.stock_provider.market_breadth()
            with self._lock:
                self._breadth_cache = _BreadthEntry(
                    metrics=metrics,
                    observed_at=observed_at,
                    expires_at=datetime.now(tz=ZoneInfo("Asia/Shanghai")) + self.cache_ttl,
                )
                self._breadth_failed = False
                self._breadth_retry_at = None
        except MarketProviderError:
            with self._lock:
                self._breadth_failed = True
                self._breadth_retry_at = datetime.now(tz=ZoneInfo("Asia/Shanghai")) + timedelta(minutes=5)
        finally:
            with self._lock:
                self._breadth_refreshing = False

    def get_market_news(self, query: str = "", limit: int = 8) -> list[MarketNewsItem]:
        news = self._cached_resource(
            "market-news", 60, lambda: self.stock_provider.market_news(36)
        )
        items = list(news)
        normalized = query.strip().lower()
        if normalized:
            items.sort(
                key=lambda item: (_news_score(normalized, item), item.published_at.timestamp()),
                reverse=True,
            )
        return items[:limit]

    def get_stock(self, symbol: str) -> StockDetail | None:
        overview = self.get_overview()
        normalized_symbol = symbol.strip().upper()
        for sector in overview.sectors:
            ranked = sorted(sector.stocks, key=lambda stock: stock.change_percent, reverse=True)
            for position, stock in enumerate(ranked, start=1):
                if stock.symbol.upper() == normalized_symbol:
                    return StockDetail(
                        quote=stock,
                        relative_to_sector_percent=round(
                            stock.change_percent - sector.change_percent, 2
                        ),
                        rank_in_sector=position,
                        sector_size=len(ranked),
                        provenance=overview.provenance,
                    )
        return self.get_live_stock(normalized_symbol)

    @staticmethod
    def _enrich_display_sectors(
        sectors: list[SectorSnapshot], baseline_sectors: list[SectorSnapshot]
    ) -> list[SectorSnapshot]:
        curated = {
            stock.symbol: sector.name
            for sector in baseline_sectors
            for stock in sector.stocks
        }
        generic = {"A股", "沪市主板", "深市主板", "创业板", "科创板", "北交所"}
        grouped: dict[str, list[StockQuote]] = {}
        for sector in sectors:
            for stock in sector.stocks:
                name = curated.get(stock.symbol, stock.sector) if stock.sector in generic else stock.sector
                grouped.setdefault(name, []).append(stock.model_copy(update={"sector": name}))
        result = []
        for name, stocks in grouped.items():
            turnover = sum(stock.turnover_million_cny for stock in stocks)
            weighted_change = sum(
                stock.change_percent * max(stock.turnover_million_cny, 1) for stock in stocks
            ) / sum(max(stock.turnover_million_cny, 1) for stock in stocks)
            result.append(SectorSnapshot(
                name=name,
                change_percent=round(weighted_change, 2),
                turnover_billion_cny=round(turnover / 1000, 2),
                stocks=sorted(
                    stocks, key=lambda stock: stock.turnover_million_cny, reverse=True
                ),
            ))
        return sorted(result, key=lambda sector: sector.turnover_billion_cny, reverse=True)

    @staticmethod
    def _enrich_industry_sectors(
        industry_sectors: list[SectorSnapshot], display_sectors: list[SectorSnapshot]
    ) -> list[SectorSnapshot]:
        generic = {"A股", "沪市主板", "深市主板", "创业板", "科创板", "北交所"}
        if not industry_sectors:
            return [sector for sector in display_sectors if sector.name not in generic]
        display_by_name = {sector.name: sector for sector in display_sectors}
        result = []
        for sector in industry_sectors:
            sample = display_by_name.get(sector.name)
            if sample is None:
                result.append(sector)
                continue
            result.append(sector.model_copy(update={
                "change_percent": sector.change_percent or sample.change_percent,
                "turnover_billion_cny": sector.turnover_billion_cny or sample.turnover_billion_cny,
            }))
        return result

    def get_live_stock(self, symbol: str) -> StockDetail | None:
        normalized_symbol = symbol.strip().upper()
        try:
            batch = self.get_quotes([normalized_symbol])
            if not batch.quotes:
                return None
            quote = batch.quotes[0]
            for sector in self.get_overview().sectors:
                baseline = next(
                    (stock for stock in sector.stocks if stock.symbol.upper() == normalized_symbol),
                    None,
                )
                if baseline is None:
                    continue
                quote = quote.model_copy(update={"sector": sector.name})
                ranked_changes = sorted(
                    [
                        quote.change_percent if stock.symbol.upper() == normalized_symbol else stock.change_percent
                        for stock in sector.stocks
                    ],
                    reverse=True,
                )
                return StockDetail(
                    quote=quote,
                    relative_to_sector_percent=round(quote.change_percent - sector.change_percent, 2),
                    rank_in_sector=ranked_changes.index(quote.change_percent) + 1,
                    sector_size=len(sector.stocks),
                    provenance=self._live_provenance(batch.source, batch.observed_at),
                )
            return StockDetail(
                quote=quote, relative_to_sector_percent=0, rank_in_sector=1, sector_size=1,
                provenance=self._live_provenance(batch.source, batch.observed_at),
            )
        except MarketProviderError:
            return None

    def search_stocks(self, query: str, limit: int = 8) -> list[StockSearchItem]:
        key = f"search:{query.strip().lower()}:{limit}"
        return self._cached_resource(key, 300, lambda: self.stock_provider.search(query, limit))

    def get_quotes(self, symbols: list[str]) -> QuoteBatch:
        key = f"quotes:{','.join(sorted(symbols))}"
        return self._cached_resource(key, 2, lambda: self.stock_provider.quotes(symbols))

    def get_sector(self, sector_id: str, name: str, limit: int = 40) -> SectorSnapshot:
        key = f"sector:{sector_id}:{limit}"
        detail = self._cached_resource(
            key, 60, lambda: self.stock_provider.sector_stocks(sector_id, name, limit)
        )
        overview = self.get_overview()
        display = next(
            (sector for sector in overview.sectors if sector.name == name),
            None,
        )
        aggregate = next(
            (sector for sector in overview.industry_sectors if sector.sector_id == sector_id),
            None,
        )
        if aggregate is None:
            return detail if detail.stocks or display is None else detail.model_copy(
                update={"stocks": display.stocks[:limit]}
            )
        return detail.model_copy(update={
            "change_percent": aggregate.change_percent,
            "turnover_billion_cny": aggregate.turnover_billion_cny,
            "constituent_count": aggregate.constituent_count,
            "stocks": detail.stocks if detail.stocks else (display.stocks[:limit] if display else []),
        })

    def get_industry_sectors(self) -> list[SectorSnapshot]:
        overview = self.get_overview()
        if not overview.industry_sectors:
            raise MarketProviderError("No market sectors are available")
        return overview.industry_sectors

    def get_realtime_overview(self) -> MarketOverview:
        """Overlay the curated market universe with current quotes for agent evidence."""
        overview = self.get_overview().model_copy(deep=True)
        symbols = [
            stock.symbol
            for sector in overview.sectors
            for stock in sector.stocks
        ]
        try:
            batch = self.get_quotes(symbols)
        except MarketProviderError:
            return overview
        if not batch.quotes:
            return overview

        updates = {quote.symbol: quote for quote in batch.quotes}
        all_stocks = []
        for sector in overview.sectors:
            sector.stocks = [
                stock.model_copy(update={
                    "name": updates[stock.symbol].name or stock.name,
                    "price": updates[stock.symbol].price,
                    "change_percent": updates[stock.symbol].change_percent,
                    "turnover_million_cny": updates[stock.symbol].turnover_million_cny,
                    "market_cap_billion_cny": updates[stock.symbol].market_cap_billion_cny,
                }) if stock.symbol in updates else stock
                for stock in sector.stocks
            ]
            all_stocks.extend(sector.stocks)
            sector.change_percent = round(
                sum(stock.change_percent for stock in sector.stocks)
                / max(len(sector.stocks), 1),
                2,
            )
            sector.turnover_billion_cny = round(
                sum(stock.turnover_million_cny for stock in sector.stocks) / 1000,
                2,
            )

        advancers = sum(stock.change_percent > 0 for stock in all_stocks)
        decliners = sum(stock.change_percent < 0 for stock in all_stocks)
        unchanged = len(all_stocks) - advancers - decliners
        directional = max(advancers + decliners, 1)
        overview.metrics.advancers = advancers
        overview.metrics.decliners = decliners
        overview.metrics.unchanged = unchanged
        overview.metrics.limit_up = sum(stock.change_percent >= 9.8 for stock in all_stocks)
        overview.metrics.limit_down = sum(stock.change_percent <= -9.8 for stock in all_stocks)
        overview.metrics.turnover_billion_cny = round(
            sum(stock.turnover_million_cny for stock in all_stocks) / 1000,
            2,
        )
        overview.metrics.sentiment_score = round(advancers / directional * 100, 1)
        overview.provenance = self._live_provenance(batch.source, batch.observed_at)
        return overview

    def get_profile(self, symbol: str) -> StockProfile:
        return self._cached_resource(
            f"profile:{symbol}", 43_200, lambda: self._load_profile(symbol)
        )

    def _load_profile(self, symbol: str) -> StockProfile:
        profile = self.stock_provider.profile(symbol)
        normalized_symbol = symbol.strip().upper()
        for sector in self.get_overview().sectors:
            match = next(
                (stock for stock in sector.stocks if stock.symbol.upper() == normalized_symbol),
                None,
            )
            if match is None:
                continue
            generic_industries = {None, "A股", "沪市主板", "深市主板", "创业板", "科创板"}
            updates = {
                "industry": sector.name if profile.industry in generic_industries else profile.industry,
                "name": profile.name or match.name,
                "market_cap_billion_cny": profile.market_cap_billion_cny or match.market_cap_billion_cny,
            }
            return profile.model_copy(update=updates)
        return profile

    def get_series(self, symbol: str, interval: str) -> StockSeries:
        ttl = 3 if interval in {"intraday", "five_day"} else 300
        return self._cached_resource(
            f"series:{symbol}:{interval}", ttl, lambda: self.stock_provider.series(symbol, interval)
        )

    def _cached_resource(self, key: str, ttl_seconds: int, loader):
        now = datetime.now(tz=ZoneInfo("Asia/Shanghai"))
        with self._lock:
            cached = self._resource_cache.get(key)
            if cached and now < cached[0]:
                return cached[1]
            resource_lock = self._resource_locks.setdefault(key, Lock())
        with resource_lock:
            now = datetime.now(tz=ZoneInfo("Asia/Shanghai"))
            with self._lock:
                cached = self._resource_cache.get(key)
                if cached and now < cached[0]:
                    return cached[1]
            try:
                value = loader()
            except MarketProviderError:
                with self._lock:
                    cached = self._resource_cache.get(key)
                if cached:
                    return cached[1]
                raise
            completed_at = datetime.now(tz=ZoneInfo("Asia/Shanghai"))
            with self._lock:
                self._resource_cache[key] = (completed_at + timedelta(seconds=ttl_seconds), value)
            return value

    def _persist_overview(self, overview: MarketOverview) -> None:
        if self.snapshot_store is None:
            return
        try:
            self.snapshot_store.upsert_market_snapshot(
                "market-overview",
                overview.model_dump(mode="json"),
                overview.provenance.observed_at,
            )
        except (PsycopgError, RuntimeError):
            return

    def _load_persisted_overview(self) -> MarketOverview | None:
        if self.snapshot_store is None:
            return None
        try:
            payload = self.snapshot_store.get_market_snapshot("market-overview")
            return MarketOverview.model_validate(payload) if payload else None
        except (PsycopgError, RuntimeError, ValueError):
            return None

    @staticmethod
    def _live_provenance(source: str, observed_at: datetime):
        from app.domain.models import Provenance
        return Provenance(source=source, mode=DataMode.LIVE, observed_at=observed_at, retrieved_at=observed_at)

    @staticmethod
    def _as_cached(overview: MarketOverview, retrieved_at: datetime) -> MarketOverview:
        cached = overview.model_copy(deep=True)
        if cached.provenance.mode not in {DataMode.DEMO, DataMode.CACHED}:
            cached.provenance.mode = DataMode.CACHED
        cached.provenance.retrieved_at = retrieved_at
        return cached


def _news_score(query: str, item: MarketNewsItem) -> int:
    haystack = f"{item.headline} {item.summary}".lower()
    compact = "".join(query.split())
    tokens = {compact[index:index + 2] for index in range(max(0, len(compact) - 1))}
    return sum(token in haystack for token in tokens) + (3 if compact in haystack else 0)
