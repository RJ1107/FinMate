from datetime import UTC, datetime

from app.domain.models import QuoteBatch, StockQuote
from app.providers.base import MarketProviderError
from app.providers.eastmoney import (
    EASTMONEY_FAST_NEWS_URL,
    SINA_INDEX_URL,
    SINA_NEWS_URL,
    EastmoneyStockProvider,
)


def test_indices_fall_back_to_tencent_when_sina_is_blocked(monkeypatch) -> None:
    provider = EastmoneyStockProvider()
    rows = [
        'v_sh000001="1~上证指数~000001~3934.40~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~20260910161403~-17.11~-0.43~0~0~0~0~77967269";',
        'v_sz399001="51~深证成指~399001~13617.00~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~20260910161403~-71.00~-0.52~0~0~0~0~65432100";',
        'v_sz399006="51~创业板指~399006~3342.00~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~20260910161403~-8.00~-0.24~0~0~0~0~123";',
        'v_sh000688="1~科创50~000688~1570.00~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~20260910161403~-3.00~-0.19~0~0~0~0~123";',
        'v_sh000300="1~沪深300~000300~4550.00~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~20260910161403~-10.00~-0.22~0~0~0~0~123";',
    ]

    def fake_text(url, *args, **kwargs):
        if url.startswith(SINA_INDEX_URL):
            raise MarketProviderError("blocked")
        return "\n".join(rows)

    monkeypatch.setattr(provider, "_text", fake_text)
    indices, turnover, observed_at = provider.market_indices()

    assert [item.name for item in indices] == [
        "上证指数", "深证成指", "创业板指", "科创50", "沪深300"
    ]
    assert indices[0].price == 3934.4
    assert turnover == 1433.99
    assert observed_at.strftime("%Y-%m-%d %H:%M:%S") == "2026-09-10 16:14:03"


def test_news_falls_back_to_eastmoney_fast_feed(monkeypatch) -> None:
    provider = EastmoneyStockProvider()

    def fake_json(url, *args, **kwargs):
        if url == SINA_NEWS_URL:
            raise MarketProviderError("blocked")
        assert url == EASTMONEY_FAST_NEWS_URL
        return {
            "data": {
                "fastNewsList": [{
                    "code": "news-1",
                    "title": "A股市场收盘",
                    "summary": "主要指数完成当日交易。",
                    "showTime": "2026-09-10 15:01:00",
                }]
            }
        }

    monkeypatch.setattr(provider, "_json", fake_json)
    items = provider.market_news(6)

    assert len(items) == 1
    assert items[0].headline == "A股市场收盘"
    assert items[0].source == "东方财富快讯"
    assert items[0].published_at.strftime("%Y-%m-%d %H:%M:%S") == "2026-09-10 15:01:00"

def test_overview_uses_live_quote_batch_without_ranking_requests(monkeypatch) -> None:
    provider = EastmoneyStockProvider()
    observed_at = datetime.now(UTC)
    monkeypatch.setattr(provider, "quotes", lambda symbols: QuoteBatch(
        quotes=[StockQuote(
            symbol="603986", name="兆易创新", sector="半导体", price=400.0,
            change_percent=3.2, turnover_million_cny=8000.0,
            market_cap_billion_cny=2800.0,
        )],
        source="tencent-live-quote",
        observed_at=observed_at,
    ))

    overview = provider.get_market_overview()

    assert overview.provenance.source == "tencent-live-quote"
    assert overview.displayed_count == 1
    assert overview.sectors[0].stocks[0].price == 400.0
