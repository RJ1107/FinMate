from dataclasses import dataclass
from datetime import datetime, timedelta
from threading import Lock
from zoneinfo import ZoneInfo

from app.domain.models import (
    DataMode,
    MarketOverview,
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


class MarketService:
    def __init__(self, provider_name: str = "auto", cache_ttl_seconds: int = 60) -> None:
        self.provider_name = provider_name.lower()
        self.cache_ttl = timedelta(seconds=cache_ttl_seconds)
        self.demo_provider = DemoMarketDataProvider()
        self.stock_provider = EastmoneyStockProvider()
        self.live_provider: MarketDataProvider = self.stock_provider
        self._cache: _CacheEntry | None = None
        self._resource_cache: dict[str, tuple[datetime, object]] = {}
        self._lock = Lock()

    def get_overview(self, force_refresh: bool = False) -> MarketOverview:
        now = datetime.now(tz=ZoneInfo("Asia/Shanghai"))
        with self._lock:
            if not force_refresh and self._cache and now < self._cache.expires_at:
                return self._as_cached(self._cache.overview, now)

            if self.provider_name == "demo":
                overview = self.demo_provider.get_market_overview()
            else:
                try:
                    overview = self.live_provider.get_market_overview()
                    baseline = self.demo_provider.get_market_overview()
                    if not overview.indices:
                        overview.indices = baseline.indices
                    if not overview.reference_indices:
                        overview.reference_indices = baseline.reference_indices
                    overview.sectors = self._enrich_display_sectors(
                        overview.sectors, baseline.sectors
                    )
                    if not overview.industry_sectors:
                        overview.industry_sectors = [
                            sector for sector in overview.sectors
                            if sector.name not in {"A股", "沪市主板", "深市主板", "创业板", "科创板", "北交所"}
                        ]
                except MarketProviderError as exc:
                    overview = self.demo_provider.get_market_overview()
                    overview.provenance.fallback_reason = str(exc)
                    try:
                        overview.industry_sectors = self.stock_provider.market_sectors()
                    except MarketProviderError:
                        pass

            overview.industry_sectors = self._enrich_industry_sectors(
                overview.industry_sectors, overview.sectors
            )

            if overview.industry_sectors:
                self._resource_cache["market-sectors"] = (
                    now + timedelta(seconds=15),
                    overview.industry_sectors,
                )

            self._cache = _CacheEntry(overview=overview, expires_at=now + self.cache_ttl)
            return overview

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
        aggregate = next(
            (sector for sector in overview.industry_sectors if sector.sector_id == sector_id),
            None,
        )
        if aggregate is None:
            return detail
        return detail.model_copy(update={
            "change_percent": aggregate.change_percent,
            "turnover_billion_cny": aggregate.turnover_billion_cny,
            "constituent_count": aggregate.constituent_count,
        })

    def get_industry_sectors(self) -> list[SectorSnapshot]:
        return self._cached_resource(
            "market-sectors",
            15,
            lambda: self._enrich_industry_sectors(
                self.stock_provider.market_sectors(), self.get_overview().sectors
            ),
        )

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
        try:
            value = loader()
        except MarketProviderError:
            with self._lock:
                cached = self._resource_cache.get(key)
            if cached:
                return cached[1]
            raise
        with self._lock:
            self._resource_cache[key] = (now + timedelta(seconds=ttl_seconds), value)
        return value

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
