from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class DataMode(StrEnum):
    LIVE = "live"
    DELAYED = "delayed"
    CACHED = "cached"
    DEMO = "demo"


class Provenance(BaseModel):
    source: str
    mode: DataMode
    observed_at: datetime
    retrieved_at: datetime
    market_timezone: str = "Asia/Shanghai"
    fallback_reason: str | None = None


class IndexQuote(BaseModel):
    symbol: str
    name: str
    price: float
    change_percent: float
    market: str = "CN"
    currency: str = "CNY"


class MarketNewsItem(BaseModel):
    news_id: str
    headline: str
    summary: str
    source: str
    published_at: datetime
    url: str | None = None


class MarketMetrics(BaseModel):
    advancers: int = Field(ge=0)
    decliners: int = Field(ge=0)
    unchanged: int = Field(ge=0)
    limit_up: int = Field(ge=0)
    limit_down: int = Field(ge=0)
    turnover_billion_cny: float = Field(ge=0)
    sentiment_score: float = Field(ge=0, le=100)


class StockQuote(BaseModel):
    symbol: str
    name: str
    sector: str
    price: float = Field(gt=0)
    change_percent: float
    turnover_million_cny: float = Field(ge=0)
    market_cap_billion_cny: float | None = Field(default=None, ge=0)


class SectorSnapshot(BaseModel):
    name: str
    sector_id: str | None = None
    constituent_count: int | None = Field(default=None, ge=0)
    change_percent: float
    turnover_billion_cny: float = Field(ge=0)
    stocks: list[StockQuote]
    news: list[MarketNewsItem] = Field(default_factory=list)


class MarketOverview(BaseModel):
    market: str = "CN-A"
    indices: list[IndexQuote]
    reference_indices: list[IndexQuote] = Field(default_factory=list)
    metrics: MarketMetrics
    sectors: list[SectorSnapshot]
    industry_sectors: list[SectorSnapshot] = Field(default_factory=list)
    provenance: Provenance
    universe_total: int | None = Field(default=None, ge=0)
    displayed_count: int | None = Field(default=None, ge=0)
    selection_method: str | None = None


class StockDetail(BaseModel):
    quote: StockQuote
    relative_to_sector_percent: float
    rank_in_sector: int = Field(ge=1)
    sector_size: int = Field(ge=1)
    provenance: Provenance


class StockSearchItem(BaseModel):
    symbol: str
    name: str
    market: str
    security_type: str


class QuoteBatch(BaseModel):
    quotes: list[StockQuote]
    source: str
    observed_at: datetime


class StockProfile(BaseModel):
    symbol: str
    name: str
    industry: str | None = None
    listing_date: str | None = None
    total_shares: float | None = None
    float_shares: float | None = None
    market_cap_billion_cny: float | None = None
    float_market_cap_billion_cny: float | None = None
    source: str
    observed_at: datetime


class Candle(BaseModel):
    time: str
    open: float
    high: float
    low: float
    close: float
    volume: float = Field(ge=0)
    amount: float | None = Field(default=None, ge=0)
    average: float | None = None


class StockSeries(BaseModel):
    symbol: str
    interval: str
    label: str
    candles: list[Candle]
    source: str
    observed_at: datetime
    is_realtime: bool = False
