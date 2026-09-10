from uuid import uuid4

from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app
from tests.test_market_service import OnDemandProvider


def test_health_and_market_contract(monkeypatch) -> None:
    monkeypatch.setenv("MARKET_PROVIDER", "demo")
    get_settings.cache_clear()

    with TestClient(create_app()) as client:
        health = client.get("/api/v1/health/live")
        overview = client.get("/api/v1/market/overview")

    assert health.status_code == 200
    assert overview.status_code == 200
    payload = overview.json()
    assert payload["market"] == "CN-A"
    assert payload["provenance"]["mode"] == "demo"
    assert payload["sectors"][0]["stocks"]


def test_market_pulse_contract_does_not_require_cloud_map(monkeypatch) -> None:
    monkeypatch.setenv("MARKET_PROVIDER", "demo")
    get_settings.cache_clear()

    with TestClient(create_app()) as client:
        response = client.get("/api/v1/market/pulse")

    assert response.status_code == 200
    payload = response.json()
    assert payload["indices"]
    assert payload["metrics"]["limit_up"] == 67
    assert payload["breadth_status"] == "ready"


def test_profile_and_conversation_are_persisted(monkeypatch) -> None:
    monkeypatch.setenv("MARKET_PROVIDER", "demo")
    get_settings.cache_clear()
    profile = {
        "income": "10-30 万", "experience": "1-3 年", "risk": "均衡",
        "drawdown": "约 10%", "horizon": "1-3 年", "goal": "长期成长",
        "liquidity": "适中", "supplement": "优先解释风险", "interests": ["半导体"],
        "updatedAt": None,
    }
    portfolio = {
        "initialCash": 100000,
        "cash": 80000,
        "positions": [{
            "symbol": "300750", "name": "宁德时代", "shares": 100,
            "avgCost": 200, "lastPrice": 210,
        }],
    }

    with TestClient(create_app()) as client:
        saved = client.put("/api/v1/memory/profile/client_test123", json=profile)
        loaded = client.get("/api/v1/memory/profile/client_test123")
        saved_portfolio = client.put(
            "/api/v1/memory/portfolio/client_test123", json=portfolio
        )
        loaded_portfolio = client.get("/api/v1/memory/portfolio/client_test123")
        answer = client.post("/api/v1/agent/query", json={
            "question": "什么是市盈率？",
            "client_id": "client_test123",
            "conversation_id": "conversation_test123",
        })
        messages = client.app.state.memory_store.recent_messages(
            "client_test123", "conversation_test123"
        )

    assert saved.status_code == 200
    assert loaded.json()["profile"]["interests"] == ["半导体"]
    assert saved_portfolio.status_code == 200
    assert loaded_portfolio.json()["portfolio"]["positions"][0]["symbol"] == "300750"
    assert answer.status_code == 200
    assert [message.role for message in messages[-2:]] == ["user", "assistant"]


def test_daily_agent_and_profile_quotas_are_enforced(monkeypatch) -> None:
    monkeypatch.setenv("MARKET_PROVIDER", "demo")
    get_settings.cache_clear()
    suffix = uuid4().hex[:12]
    client_id = f"client_quota_{suffix}"
    conversation_id = f"conversation_{suffix}"
    profile = {
        "income": "10-30 万", "experience": "1-3 年", "risk": "均衡",
        "drawdown": "约 10%", "horizon": "1-3 年", "goal": "长期成长",
        "liquidity": "适中", "supplement": "第一次", "interests": [],
        "updatedAt": None,
    }

    with TestClient(create_app()) as client:
        initial = client.get(f"/api/v1/memory/quota/{client_id}")
        first = client.put(f"/api/v1/memory/profile/{client_id}", json=profile)
        profile["supplement"] = "第二次"
        second = client.put(f"/api/v1/memory/profile/{client_id}", json=profile)
        profile["supplement"] = "第三次"
        blocked_profile = client.put(f"/api/v1/memory/profile/{client_id}", json=profile)
        store = client.app.state.memory_store
        for _ in range(20):
            assert store.consume_agent_query(client_id) is not None
        blocked_agent = client.post("/api/v1/agent/query", json={
            "question": "今天市场怎么样？",
            "client_id": client_id,
            "conversation_id": conversation_id,
        })

    assert initial.json()["agent_remaining"] == 20
    assert initial.json()["profile_remaining"] == 2
    assert first.json()["quota"]["profile_remaining"] == 1
    assert second.json()["quota"]["profile_remaining"] == 0
    assert blocked_profile.status_code == 429
    assert blocked_profile.json()["detail"]["code"] == "daily_profile_limit"
    assert blocked_agent.status_code == 429
    assert blocked_agent.json()["detail"]["code"] == "daily_agent_limit"


def test_ready_and_missing_stock(monkeypatch) -> None:
    monkeypatch.setenv("MARKET_PROVIDER", "demo")
    get_settings.cache_clear()

    with TestClient(create_app()) as client:
        ready = client.get("/api/v1/health/ready")
        missing = client.get("/api/v1/market/stocks/999999")

    assert ready.status_code == 200
    assert ready.json()["status"] == "ready"
    assert missing.status_code == 404


def test_comma_separated_cors_environment(monkeypatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "https://finmate.example,https://admin.example")
    get_settings.cache_clear()

    settings = get_settings()

    assert settings.cors_origin_list == [
        "https://finmate.example",
        "https://admin.example",
    ]


def test_agent_query_contract(monkeypatch) -> None:
    monkeypatch.setenv("MARKET_PROVIDER", "demo")
    get_settings.cache_clear()

    with TestClient(create_app()) as client:
        response = client.post("/api/v1/agent/query", json={
            "question": "中芯国际表现如何？",
            "client_id": f"client_{uuid4().hex[:12]}",
            "conversation_id": f"conversation_{uuid4().hex[:12]}",
        })

    assert response.status_code == 200
    payload = response.json()
    assert payload["intent"] == "stock_snapshot"
    assert payload["resolved_entity"] == "中芯国际 (688981)"
    assert payload["evidence"]
    assert payload["trace"]


def test_agent_status_does_not_expose_credentials(monkeypatch) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "unit-test-secret")
    get_settings.cache_clear()
    with TestClient(create_app()) as client:
        response = client.get("/api/v1/agent/status")
    assert response.status_code == 200
    assert response.json()["configured"] is True
    assert response.json()["provider"] == "OpenRouter"
    assert "unit-test-secret" not in response.text


def test_agent_status_without_model() -> None:
    with TestClient(create_app()) as client:
        response = client.get("/api/v1/agent/status")
    assert response.json() == {"configured": False, "provider": None, "model": None}


def test_search_quote_profile_and_series_routes(monkeypatch) -> None:
    monkeypatch.setenv("MARKET_PROVIDER", "demo")
    get_settings.cache_clear()
    with TestClient(create_app()) as client:
        client.app.state.market_service.stock_provider = OnDemandProvider()
        search = client.get("/api/v1/market/search", params={"q": "兆易创新"})
        quotes = client.get("/api/v1/market/quotes", params={"symbols": "603986"})
        profile = client.get("/api/v1/market/stocks/603986/profile")
        series = client.get("/api/v1/market/stocks/603986/series", params={"interval": "daily"})

    assert search.json()[0]["symbol"] == "603986"
    assert quotes.json()["quotes"][0]["price"] == 395.08
    assert profile.json()["industry"] == "半导体"
    assert len(series.json()["candles"]) == 2
