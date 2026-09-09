from datetime import datetime
from zoneinfo import ZoneInfo

from app.domain.models import (
    DataMode,
    MarketMetrics,
    MarketOverview,
    Provenance,
    SectorSnapshot,
    StockQuote,
)
from app.providers.base import MarketProviderError


class AkShareMarketDataProvider:
    """AKShare adapter with all upstream field names contained in this module."""

    @property
    def name(self) -> str:
        return "akshare-eastmoney"

    def get_market_overview(self) -> MarketOverview:
        try:
            import akshare as ak

            frame = ak.stock_zh_a_spot_em()
        except Exception as exc:
            raise MarketProviderError(f"AKShare snapshot request failed: {exc}") from exc

        required = {"代码", "名称", "最新价", "涨跌幅", "成交额", "总市值"}
        missing = required.difference(frame.columns)
        if missing:
            raise MarketProviderError(f"AKShare response is missing columns: {sorted(missing)}")

        clean = frame.dropna(subset=["代码", "名称", "最新价", "涨跌幅", "成交额"]).copy()
        for column in ("最新价", "涨跌幅", "成交额", "总市值"):
            clean[column] = clean[column].apply(_numeric_or_none)
        clean = clean.dropna(subset=["最新价", "涨跌幅", "成交额"])
        clean = clean[clean["最新价"] > 0]
        if clean.empty:
            raise MarketProviderError("AKShare returned no usable A-share quotes")

        # A broad market snapshot stays useful even when an upstream sector endpoint changes.
        leaders = clean.sort_values("成交额", ascending=False).head(80)
        stocks = [self._to_stock(row) for _, row in leaders.iterrows()]
        sectors = self._group_by_display_sector(stocks)
        changes = clean["涨跌幅"].astype(float)
        turnover = clean["成交额"].astype(float).sum() / 1_000_000_000
        advancers = int((changes > 0).sum())
        decliners = int((changes < 0).sum())
        unchanged = int((changes == 0).sum())
        breadth = advancers / max(advancers + decliners, 1)
        sentiment = round(min(100.0, max(0.0, breadth * 100)), 1)
        now = datetime.now(tz=ZoneInfo("Asia/Shanghai"))

        return MarketOverview(
            indices=[],
            metrics=MarketMetrics(
                advancers=advancers,
                decliners=decliners,
                unchanged=unchanged,
                limit_up=int((changes >= 9.9).sum()),
                limit_down=int((changes <= -9.9).sum()),
                turnover_billion_cny=round(turnover, 1),
                sentiment_score=sentiment,
            ),
            sectors=sectors,
            provenance=Provenance(
                source=self.name,
                mode=DataMode.DELAYED,
                observed_at=now,
                retrieved_at=now,
            ),
        )

    @staticmethod
    def _to_stock(row: object) -> StockQuote:
        symbol = str(row["代码"]).zfill(6)
        sector = _fallback_sector(symbol)
        market_cap = float(row["总市值"]) / 100_000_000 if row["总市值"] == row["总市值"] else None
        return StockQuote(
            symbol=symbol,
            name=str(row["名称"]),
            sector=sector,
            price=float(row["最新价"]),
            change_percent=float(row["涨跌幅"]),
            turnover_million_cny=float(row["成交额"]) / 1_000_000,
            market_cap_billion_cny=market_cap,
        )

    @staticmethod
    def _group_by_display_sector(stocks: list[StockQuote]) -> list[SectorSnapshot]:
        grouped: dict[str, list[StockQuote]] = {}
        for stock in stocks:
            grouped.setdefault(stock.sector, []).append(stock)
        return [
            SectorSnapshot(
                name=name,
                change_percent=round(sum(stock.change_percent for stock in group) / len(group), 2),
                turnover_billion_cny=round(
                    sum(stock.turnover_million_cny for stock in group) / 1000, 2
                ),
                stocks=group,
            )
            for name, group in grouped.items()
        ]


def _fallback_sector(symbol: str) -> str:
    if symbol.startswith("688"):
        return "科创板"
    if symbol.startswith("30"):
        return "创业板"
    if symbol.startswith("60"):
        return "沪市主板"
    if symbol.startswith(("00", "001")):
        return "深市主板"
    if symbol.startswith(("8", "4", "92")):
        return "北交所"
    return "其他"


def _numeric_or_none(value: object) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
