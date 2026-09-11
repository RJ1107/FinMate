from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.agents.market_fact import MarketFactAgent
from app.api.routes.agent import router as agent_router
from app.api.routes.health import router as health_router
from app.api.routes.market import router as market_router
from app.api.routes.memory import router as memory_router
from app.config import get_settings
from app.services.llm import OpenRouterAnswerRefiner
from app.services.market import MarketService
from app.services.memory import MemoryStore


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    memory_store = MemoryStore(settings.database_dsn)
    app.state.memory_store = memory_store
    app.state.market_service = MarketService(
        provider_name=settings.market_provider,
        cache_ttl_seconds=settings.market_cache_ttl_seconds,
        snapshot_store=memory_store,
    )
    answer_refiner = None
    if settings.openrouter_configured and settings.openrouter_api_key:
        answer_refiner = OpenRouterAnswerRefiner(
            api_key=settings.openrouter_api_key.get_secret_value(),
            base_url=settings.openrouter_base_url,
            model=settings.openrouter_model,
            fallback_model=settings.openrouter_fallback_model,
            http_referer=settings.openrouter_http_referer,
            app_title=settings.openrouter_app_title,
        )
    app.state.market_agent = MarketFactAgent(
        app.state.market_service,
        answer_refiner,
        use_live_market_overlay=True,
    )
    yield
    app.state.memory_store.close()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description="Explainable A-share market intelligence API",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "OPTIONS"],
        allow_headers=["*"],
    )
    app.include_router(health_router, prefix="/api/v1")
    app.include_router(market_router, prefix="/api/v1")
    app.include_router(memory_router, prefix="/api/v1")
    app.include_router(agent_router, prefix="/api/v1")
    return app


app = create_app()
