from fastapi import APIRouter, Request

from app.agents.market_fact import MarketFactAgent
from app.domain.agent import AgentAnswer, AgentQuery, AgentStatus

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
    return agent.ask(payload.question)
