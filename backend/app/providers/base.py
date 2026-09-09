from typing import Protocol

from app.domain.models import MarketOverview


class MarketDataProvider(Protocol):
    @property
    def name(self) -> str: ...

    def get_market_overview(self) -> MarketOverview: ...


class MarketProviderError(RuntimeError):
    """Raised when an upstream market provider cannot return a valid snapshot."""
