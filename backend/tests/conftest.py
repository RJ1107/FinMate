import pytest

from app.config import get_settings


@pytest.fixture(autouse=True)
def isolate_model_credentials(monkeypatch):
    """Unit tests must never spend the developer's OpenRouter credits."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
