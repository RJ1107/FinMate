from datetime import UTC, datetime

from app.domain.models import (
    Candle,
    DataMode,
    IndexQuote,
    QuoteBatch,
    StockProfile,
    StockQuote,
    StockSearchItem,
    StockSeries,
)
from app.providers.base import MarketProviderError
from app.services.market import MarketService


class BrokenProvider:
    @property
    def name(self) -> str:
        return "broken-provider"

    def get_market_overview(self):
        raise MarketProviderError("simulated upstream failure")


class OnDemandProvider:
    def __init__(self) -> None:
        self.quote_calls = 0

    def search(self, query: str, limit: int = 8):
        return [StockSearchItem(symbol="603986", name="兆易创新", market="沪A", security_type="AStock")]

    def quotes(self, symbols: list[str]):
        self.quote_calls += 1
        return QuoteBatch(quotes=[StockQuote(symbol=symbols[0], name="兆易创新", sector="沪市主板",
            price=395.08, change_percent=2.5, turnover_million_cny=7499.6,
            market_cap_billion_cny=2781.25)], source="test-live", observed_at=datetime.now(UTC))

    def profile(self, symbol: str):
        return StockProfile(symbol=symbol, name="兆易创新", industry="半导体", listing_date="2016-08-18",
            total_shares=703_971_427, float_shares=670_718_327, market_cap_billion_cny=2781.25,
            float_market_cap_billion_cny=2649.87, source="test-profile", observed_at=datetime.now(UTC))

    def series(self, symbol: str, interval: str):
        return self.daily_range(symbol, datetime.now(UTC), datetime.now(UTC)).model_copy(update={"interval": interval, "label": interval})

    def daily_range(self, symbol: str, start: datetime, end: datetime):
        return StockSeries(symbol=symbol, interval="daily", label="历史日K", source="test-history",
            observed_at=datetime.now(UTC), candles=[
                Candle(time="2026-09-04", open=380, high=386, low=379, close=382, volume=100),
                Candle(time="2026-09-07", open=383, high=396, low=382, close=395, volume=200),
            ])


def test_demo_overview_is_explicit_and_complete() -> None:
    service = MarketService(provider_name="demo")

    overview = service.get_overview()

    assert overview.provenance.mode == DataMode.DEMO
    assert overview.provenance.source == "finmate-demo-snapshot"
    assert len(overview.indices) == 5
    assert any(index.name == "科创 50" for index in overview.indices)
    assert len(overview.sectors) >= 20
    assert sum(len(sector.stocks) for sector in overview.sectors) >= 100
    assert any(sector.name == "计算机" for sector in overview.sectors)


def test_stock_detail_uses_current_snapshot() -> None:
    service = MarketService(provider_name="demo")

    detail = service.get_stock("688981")

    assert detail is not None
    assert detail.quote.name == "中芯国际"
    assert detail.quote.sector == "半导体"
    assert detail.rank_in_sector == 1


def test_unknown_stock_returns_none() -> None:
    service = MarketService(provider_name="demo")

    assert service.get_stock("999999") is None


def test_auto_provider_falls_back_and_explains_failure() -> None:
    service = MarketService(provider_name="auto")
    service.live_provider = BrokenProvider()

    overview = service.get_overview()

    assert overview.provenance.mode == DataMode.DEMO
    assert overview.provenance.fallback_reason == "simulated upstream failure"


def test_second_live_read_is_marked_cached() -> None:
    service = MarketService(provider_name="auto")
    live_overview = service.demo_provider.get_market_overview()
    live_overview.provenance.mode = DataMode.DELAYED

    class WorkingProvider:
        @property
        def name(self) -> str:
            return "working-provider"

        def get_market_overview(self):
            return live_overview

    service.live_provider = WorkingProvider()

    first = service.get_overview()
    second = service.get_overview()

    assert first.provenance.mode == DataMode.DELAYED
    assert second.provenance.mode == DataMode.CACHED


def test_on_demand_stock_search_quote_profile_and_cache() -> None:
    service = MarketService(provider_name="demo")
    provider = OnDemandProvider()
    service.stock_provider = provider

    assert service.search_stocks("兆易创新")[0].symbol == "603986"
    assert service.get_quotes(["603986"]).quotes[0].price == 395.08
    assert service.get_quotes(["603986"]).quotes[0].price == 395.08
    assert provider.quote_calls == 1
    assert service.get_profile("603986").industry == "半导体"
    assert service.get_stock("603986").quote.name == "兆易创新"


def test_realtime_overview_overlays_quotes_and_marks_sample_live() -> None:
    service = MarketService(provider_name="demo")
    provider = OnDemandProvider()
    service.stock_provider = provider

    overview = service.get_realtime_overview()

    assert overview.provenance.mode == DataMode.LIVE
    assert overview.provenance.source == "test-live"
    assert overview.metrics.advancers + overview.metrics.decliners + overview.metrics.unchanged >= 100
    assert provider.quote_calls == 1

def test_overview_persists_and_restores_last_live_snapshot() -> None:
    class SnapshotStore:
        payload = None

        def upsert_market_snapshot(self, snapshot_key, payload, observed_at):
            assert snapshot_key == "market-overview"
            assert observed_at is not None
            self.payload = payload

        def get_market_snapshot(self, snapshot_key):
            assert snapshot_key == "market-overview"
            return self.payload

    store = SnapshotStore()
    live_service = MarketService(provider_name="auto", snapshot_store=store)
    live_overview = live_service.demo_provider.get_market_overview()
    live_overview.provenance.mode = DataMode.DELAYED

    class WorkingProvider:
        def get_market_overview(self):
            return live_overview

    live_service.live_provider = WorkingProvider()
    live_service.get_overview()
    assert store.payload is not None

    fallback_service = MarketService(provider_name="auto", snapshot_store=store)
    fallback_service.live_provider = BrokenProvider()
    restored = fallback_service.get_overview()

    assert restored.provenance.mode == DataMode.CACHED
    assert restored.provenance.source == live_overview.provenance.source


def test_failed_breadth_reports_unavailable_without_immediate_retry() -> None:
    class FailingBreadthProvider:
        def __init__(self):
            self.breadth_calls = 0

        def market_indices(self):
            return (
                [IndexQuote(
                    symbol="000001", name="上证指数", price=3900,
                    change_percent=0.1,
                )],
                1200.0,
                datetime.now(UTC),
            )

        def market_breadth(self):
            self.breadth_calls += 1
            raise MarketProviderError("blocked")

    provider = FailingBreadthProvider()
    service = MarketService(provider_name="auto")
    service.stock_provider = provider
    service._refresh_breadth()

    pulse = service.get_pulse()

    assert pulse.breadth_status == "unavailable"
    assert provider.breadth_calls == 1
