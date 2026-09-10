from fastapi import APIRouter, HTTPException, Request, status

from app.agents.market_fact import MarketFactAgent
from app.domain.agent import AgentAnswer, AgentQuery, AgentStatus
from app.providers.base import MarketProviderError
from app.services.memory import MemoryStore, render_memory_context

router = APIRouter(prefix="/agent", tags=["agent"])


@router.get("/status", response_model=AgentStatus)
def agent_status(request: Request) -> AgentStatus:
    agent: MarketFactAgent = request.app.state.market_agent
    refiner = agent.answer_refiner
    return AgentStatus(
        configured=refiner is not None,
        provider="OpenRouter" if refiner else None,
        model=getattr(refiner, "model", None),
    )


@router.post("/query", response_model=AgentAnswer)
def query_agent(payload: AgentQuery, request: Request) -> AgentAnswer:
    agent: MarketFactAgent = request.app.state.market_agent
    store: MemoryStore = request.app.state.memory_store
    profile = None
    portfolio = None
    messages = []
    quota = None
    quota = store.consume_agent_query(payload.client_id)
    if quota is None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "daily_agent_limit",
                "message": "今天的 20 次 FinMate 对话额度已用完，请明天再来。",
                "limit": 20,
                "remaining": 0,
            },
        )
    profile = store.get_profile(payload.client_id)
    portfolio = store.get_portfolio(payload.client_id)
    messages = store.recent_messages(payload.client_id, payload.conversation_id, limit=8)
    news = []
    if any(marker in payload.question for marker in ("新闻", "消息", "资讯", "要闻", "发生了什么", "催化")):
        try:
            news = request.app.state.market_service.get_market_news(payload.question, 6)
            store.ingest_news(news)
        except MarketProviderError:
            news = []
    result = agent.ask(
        payload.question,
        memory_context=render_memory_context(profile, messages, portfolio),
        retrieved_news=news,
    )
    store.add_turn(
        payload.client_id,
        payload.conversation_id,
        payload.question,
        result.answer,
        result.request_id,
    )
    return result.model_copy(update={
        "daily_remaining": quota.agent_remaining,
        "daily_limit": quota.agent_limit,
    })
