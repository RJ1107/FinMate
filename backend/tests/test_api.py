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
        response = client.post("/api/v1/agent/query", json={"question": "中芯国际表现如何？"})

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


def test_search_quote_profile_and_series_routes() -> None:
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
