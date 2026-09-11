from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.domain.models import (
    MarketNewsItem,
    MarketOverview,
    MarketPulse,
    QuoteBatch,
    SectorSnapshot,
    StockDetail,
    StockProfile,
    StockSearchItem,
    StockSeries,
)
from app.providers.base import MarketProviderError
from app.services.market import MarketService

router = APIRouter(prefix="/market", tags=["market"])


def get_market_service(request: Request) -> MarketService:
    return request.app.state.market_service


@router.get("/overview", response_model=MarketOverview)
def market_overview(
    request: Request,
    refresh: Annotated[bool, Query(description="Bypass the in-memory cache")] = False,
) -> MarketOverview:
    return get_market_service(request).get_overview(force_refresh=refresh)


@router.get("/pulse", response_model=MarketPulse)
def market_pulse(
    request: Request,
    refresh: Annotated[bool, Query(description="Refresh live index and breadth caches")] = False,
) -> MarketPulse:
    try:
        return get_market_service(request).get_pulse(force_refresh=refresh)
    except MarketProviderError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/news", response_model=list[MarketNewsItem])
def market_news(
    request: Request,
    q: Annotated[str, Query(max_length=80)] = "",
    limit: Annotated[int, Query(ge=1, le=36)] = 8,
) -> list[MarketNewsItem]:
    try:
        items = get_market_service(request).get_market_news(q, limit)
        request.app.state.memory_store.ingest_news(items)
        return items
    except MarketProviderError as exc:
        cached = request.app.state.memory_store.recent_news(limit)
        if cached:
            return cached
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/stocks/{symbol}", response_model=StockDetail)
def stock_detail(symbol: str, request: Request) -> StockDetail:
    detail = get_market_service(request).get_live_stock(symbol)
    if detail is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Stock {symbol!r} is not present in the current market snapshot",
        )
    return detail


@router.get("/search", response_model=list[StockSearchItem])
def stock_search(request: Request, q: Annotated[str, Query(min_length=1, max_length=40)],
                 limit: Annotated[int, Query(ge=1, le=12)] = 8) -> list[StockSearchItem]:
    try:
        return get_market_service(request).search_stocks(q, limit)
    except MarketProviderError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/quotes", response_model=QuoteBatch)
def live_quotes(request: Request, symbols: Annotated[str, Query(min_length=6, max_length=1600)]) -> QuoteBatch:
    try:
        return get_market_service(request).get_quotes(symbols.split(","))
    except MarketProviderError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/sectors/{sector_id}", response_model=SectorSnapshot)
def sector_detail(
    sector_id: str,
    request: Request,
    name: Annotated[str, Query(min_length=1, max_length=30)],
    limit: Annotated[int, Query(ge=5, le=80)] = 40,
) -> SectorSnapshot:
    try:
        return get_market_service(request).get_sector(sector_id, name, limit)
    except MarketProviderError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/sectors", response_model=list[SectorSnapshot])
def industry_sectors(request: Request) -> list[SectorSnapshot]:
    try:
        return get_market_service(request).get_industry_sectors()
    except MarketProviderError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/stocks/{symbol}/profile", response_model=StockProfile)
def stock_profile(symbol: str, request: Request) -> StockProfile:
    try:
        return get_market_service(request).get_profile(symbol)
    except MarketProviderError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/stocks/{symbol}/series", response_model=StockSeries)
def stock_series(symbol: str, request: Request,
                 interval: Annotated[str, Query(pattern="^(intraday|five_day|daily|weekly|monthly)$")] = "intraday") -> StockSeries:
    try:
        return get_market_service(request).get_series(symbol, interval)
    except MarketProviderError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
