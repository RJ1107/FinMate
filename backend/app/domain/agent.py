from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field

from app.domain.models import DataMode


class AgentIntent(StrEnum):
    MARKET_SUMMARY = "market_summary"
    MARKET_NEWS = "market_news"
    STOCK_SNAPSHOT = "stock_snapshot"
    PORTFOLIO_ALLOCATION = "portfolio_allocation"
    UNKNOWN = "unknown"


class AgentQuery(BaseModel):
    question: str = Field(min_length=2, max_length=500)
    client_id: str = Field(pattern=r"^[A-Za-z0-9_-]{8,64}$")
    conversation_id: str = Field(pattern=r"^[A-Za-z0-9_-]{8,64}$")


class AgentStatus(BaseModel):
    configured: bool
    provider: str | None = None
    model: str | None = None


class AgentEvidence(BaseModel):
    evidence_id: str
    title: str
    value: str
    source: str
    observed_at: datetime


class AgentTraceStep(BaseModel):
    node: str
    label: str
    summary: str
    duration_ms: float = Field(ge=0)


class AgentAnswer(BaseModel):
    request_id: str
    answer: str
    intent: AgentIntent
    resolved_entity: str | None = None
    confidence: float = Field(ge=0, le=1)
    evidence: list[AgentEvidence]
    trace: list[AgentTraceStep]
    data_mode: DataMode
    observed_at: datetime
    answer_mode: str = "deterministic"
    model: str | None = None
    daily_remaining: int | None = None
    daily_limit: int = 20
