from datetime import date, datetime

from pydantic import BaseModel, Field


class UserProfilePayload(BaseModel):
    income: str = Field(max_length=40)
    experience: str = Field(max_length=40)
    risk: str = Field(max_length=40)
    drawdown: str = Field(max_length=40)
    horizon: str = Field(max_length=40)
    goal: str = Field(max_length=40)
    liquidity: str = Field(max_length=40)
    supplement: str = Field(default="", max_length=500)
    interests: list[str] = Field(default_factory=list, max_length=8)
    updatedAt: datetime | None = None


class UserProfileRecord(BaseModel):
    client_id: str
    profile: UserProfilePayload
    updated_at: datetime


class DailyQuotaStatus(BaseModel):
    client_id: str
    usage_date: date
    agent_used: int
    agent_limit: int
    agent_remaining: int
    profile_used: int
    profile_limit: int
    profile_remaining: int


class ProfileUpdateResponse(BaseModel):
    record: UserProfileRecord
    quota: DailyQuotaStatus


class ConversationMessage(BaseModel):
    role: str
    content: str
    created_at: datetime


class PortfolioPositionPayload(BaseModel):
    symbol: str = Field(pattern=r"^\d{6}$")
    name: str = Field(max_length=80)
    shares: int = Field(ge=0)
    avgCost: float = Field(ge=0)
    lastPrice: float = Field(ge=0)


class PortfolioPayload(BaseModel):
    initialCash: float = Field(ge=0)
    cash: float = Field(ge=0)
    positions: list[PortfolioPositionPayload] = Field(default_factory=list, max_length=100)


class PortfolioRecord(BaseModel):
    client_id: str
    portfolio: PortfolioPayload
    updated_at: datetime
