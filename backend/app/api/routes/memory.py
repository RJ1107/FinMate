from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Request, status

from app.domain.memory import (
    DailyQuotaStatus,
    PortfolioPayload,
    PortfolioRecord,
    ProfileUpdateResponse,
    UserProfilePayload,
    UserProfileRecord,
)
from app.services.memory import MemoryStore

router = APIRouter(prefix="/memory", tags=["memory"])
ClientId = Annotated[str, Path(pattern=r"^[A-Za-z0-9_-]{8,64}$")]


@router.get("/profile/{client_id}", response_model=UserProfileRecord)
def get_profile(client_id: ClientId, request: Request) -> UserProfileRecord:
    store: MemoryStore = request.app.state.memory_store
    profile = store.get_profile(client_id)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")
    return profile


@router.put("/profile/{client_id}", response_model=ProfileUpdateResponse)
def put_profile(
    client_id: ClientId, payload: UserProfilePayload, request: Request
) -> ProfileUpdateResponse:
    store: MemoryStore = request.app.state.memory_store
    result = store.upsert_profile_limited(client_id, payload)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "daily_profile_limit",
                "message": "今天的 2 次用户画像修改额度已用完，请明天再修改。",
                "limit": 2,
                "remaining": 0,
            },
        )
    record, quota = result
    return ProfileUpdateResponse(record=record, quota=quota)


@router.get("/quota/{client_id}", response_model=DailyQuotaStatus)
def get_quota(client_id: ClientId, request: Request) -> DailyQuotaStatus:
    store: MemoryStore = request.app.state.memory_store
    return store.get_daily_quota(client_id)


@router.get("/portfolio/{client_id}", response_model=PortfolioRecord)
def get_portfolio(client_id: ClientId, request: Request) -> PortfolioRecord:
    store: MemoryStore = request.app.state.memory_store
    portfolio = store.get_portfolio(client_id)
    if portfolio is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Portfolio not found")
    return portfolio


@router.put("/portfolio/{client_id}", response_model=PortfolioRecord)
def put_portfolio(
    client_id: ClientId, payload: PortfolioPayload, request: Request
) -> PortfolioRecord:
    store: MemoryStore = request.app.state.memory_store
    return store.upsert_portfolio(client_id, payload)
