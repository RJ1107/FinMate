import html
import json
import re
import time
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import requests

from app.domain.models import (
    Candle,
    DataMode,
    MarketMetrics,
    MarketNewsItem,
    MarketOverview,
    Provenance,
    QuoteBatch,
    SectorSnapshot,
    StockProfile,
    StockQuote,
    StockSearchItem,
    StockSeries,
)
from app.providers.base import MarketProviderError

SHANGHAI = ZoneInfo("Asia/Shanghai")
SUGGEST_URL = "https://searchapi.eastmoney.com/api/suggest/get"
QUOTE_URL = "https://push2.eastmoney.com/api/qt/ulist.np/get"
MARKET_RANK_URL = "https://push2.eastmoney.com/api/qt/clist/get"
SINA_RANK_URL = (
    "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
    "Market_Center.getHQNodeData"
)
SINA_COUNT_URL = (
    "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
    "Market_Center.getHQNodeStockCount"
)
SINA_SW_SECTOR_URL = "https://vip.stock.finance.sina.com.cn/q/view/SwHy.php"
EASTMONEY_NEWS_SEARCH_URL = "https://search-api-web.eastmoney.com/search/jsonp"
PROFILE_URL = "https://push2.eastmoney.com/api/qt/stock/get"
TENCENT_MINUTE_URL = "https://web.ifzq.gtimg.cn/appstock/app/minute/query"
TENCENT_FIVE_DAY_URL = "https://web.ifzq.gtimg.cn/appstock/app/day/query"
TENCENT_KLINE_URL = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
TENCENT_QUOTE_URL = "https://qt.gtimg.cn/q="
TENCENT_SEARCH_URL = "https://smartbox.gtimg.cn/s3/"
SUGGEST_TOKEN = "D43BF722C8E33BDC906FB84D85E326E8"
CONCEPT_DISPLAY_LIMIT = 60


class EastmoneyStockProvider:
    """On-demand A-share search, quote, profile and K-line adapter."""

    name = "eastmoney-akshare"

    def __init__(self) -> None:
        self.headers = {
            "User-Agent": "Mozilla/5.0 FinMate/0.1",
            "Referer": "https://quote.eastmoney.com/",
            "Connection": "close",
        }

    def get_market_overview(self, display_limit: int = 180) -> MarketOverview:
        """Select a readable turnover-ranked view from the full A-share universe."""
        try:
            stocks, universe_total = self._eastmoney_market_leaders(display_limit)
            source = "eastmoney-a-share-turnover-ranking"
        except MarketProviderError:
            stocks, universe_total = self._sina_market_leaders(display_limit)
            source = "sina-a-share-turnover-ranking"
        if not stocks:
            raise MarketProviderError("No usable A-share turnover ranking was returned")

        sectors = _group_market_sectors(stocks)
        advancers = sum(stock.change_percent > 0 for stock in stocks)
        decliners = sum(stock.change_percent < 0 for stock in stocks)
        unchanged = len(stocks) - advancers - decliners
        directional = max(advancers + decliners, 1)
        now = datetime.now(SHANGHAI)
        try:
            industry_sectors = self.market_sectors()
        except MarketProviderError:
            industry_sectors = []
        return MarketOverview(
            indices=[],
            metrics=MarketMetrics(
                advancers=advancers,
                decliners=decliners,
                unchanged=unchanged,
                limit_up=sum(stock.change_percent >= 9.8 for stock in stocks),
                limit_down=sum(stock.change_percent <= -9.8 for stock in stocks),
                turnover_billion_cny=round(
                    sum(stock.turnover_million_cny for stock in stocks) / 1000, 1
                ),
                sentiment_score=round(advancers / directional * 100, 1),
            ),
            sectors=sectors,
            industry_sectors=industry_sectors,
            provenance=Provenance(
                source=source,
                mode=DataMode.LIVE,
                observed_at=now,
                retrieved_at=now,
            ),
            universe_total=universe_total,
            displayed_count=len(stocks),
            selection_method="全市场成交额前列",
        )

    def industry_sectors(self) -> list[SectorSnapshot]:
        """Load one aggregate row per Shenwan industry without crawling constituents."""
        headers = {**self.headers, "Referer": "https://finance.sina.com.cn/"}
        try:
            response = requests.get(SINA_SW_SECTOR_URL, headers=headers, timeout=3)
            response.raise_for_status()
            text = response.content.decode("gb18030", errors="replace")
            encoded = text.split("=", 1)[1].strip().rstrip(";")
            payload = json.loads(encoded)
        except (requests.RequestException, ValueError, IndexError, json.JSONDecodeError) as exc:
            raise MarketProviderError(f"Industry overview request failed: {exc}") from exc

        sectors: list[SectorSnapshot] = []
        for value in payload.values():
            parts = str(value).split(",")
            if len(parts) < 8:
                continue
            try:
                sector_id = parts[0]
                name = parts[1]
                count = int(float(parts[2]))
                change = float(parts[5])
                turnover = max(0.0, float(parts[7]) / 1_000_000_000)
            except (TypeError, ValueError, IndexError):
                continue
            if not sector_id.startswith("sw_") or not name:
                continue
            sectors.append(SectorSnapshot(
                name=name,
                sector_id=sector_id,
                constituent_count=count,
                change_percent=round(change, 2),
                turnover_billion_cny=round(turnover, 2),
                stocks=[],
            ))
        if not sectors:
            raise MarketProviderError("Industry overview returned no usable sectors")
        return sorted(sectors, key=lambda sector: sector.turnover_billion_cny, reverse=True)

    def market_sectors(self) -> list[SectorSnapshot]:
        try:
            return self.concept_sectors()
        except MarketProviderError:
            return self.industry_sectors()

    def concept_sectors(self, limit: int = CONCEPT_DISPLAY_LIMIT) -> list[SectorSnapshot]:
        """Load a readable turnover-ranked subset from all Eastmoney concept boards."""
        payload = self._json(MARKET_RANK_URL, {
            "pn": 1,
            "pz": max(limit, CONCEPT_DISPLAY_LIMIT),
            "po": 1,
            "np": 1,
            "fltt": 2,
            "invt": 2,
            "fid": "f6",
            "fs": "m:90+t:3",
            "fields": "f12,f14,f2,f3,f6,f20,f104,f105,f106",
        }, attempts=1, timeout=4)
        rows = (payload.get("data") or {}).get("diff") or []
        sectors: list[SectorSnapshot] = []
        for row in rows:
            sector_id = str(row.get("f12") or "")
            name = str(row.get("f14") or "").strip()
            try:
                change = float(row["f3"])
                turnover = max(0.0, float(row["f6"]) / 1_000_000_000)
            except (KeyError, TypeError, ValueError):
                continue
            if not sector_id.startswith("BK") or not name:
                continue
            constituent_count = sum(
                max(0, int(_float(row.get(field)))) for field in ("f104", "f105", "f106")
            )
            sectors.append(SectorSnapshot(
                name=name,
                sector_id=sector_id,
                constituent_count=constituent_count or None,
                change_percent=round(change, 2),
                turnover_billion_cny=round(turnover, 2),
                stocks=[],
            ))
        if not sectors:
            raise MarketProviderError("Concept board overview returned no usable sectors")
        return sorted(
            sectors, key=lambda sector: sector.turnover_billion_cny, reverse=True
        )[:limit]

    def sector_stocks(self, sector_id: str, name: str, limit: int = 40) -> SectorSnapshot:
        if sector_id.startswith("BK") and sector_id.isalnum():
            payload = self._json(MARKET_RANK_URL, {
                "pn": 1,
                "pz": limit,
                "po": 1,
                "np": 1,
                "fltt": 2,
                "invt": 2,
                "fid": "f6",
                "fs": f"b:{sector_id}",
                "fields": "f12,f14,f2,f3,f6,f20,f100",
            }, attempts=1, timeout=5)
            data = payload.get("data") or {}
            stocks = [
                quote for row in (data.get("diff") or [])
                if (quote := _eastmoney_rank_quote(row)) is not None
            ]
            stocks = [stock.model_copy(update={"sector": name}) for stock in stocks]
            if not stocks:
                raise MarketProviderError("Concept board returned no usable constituents")
            weights = sum(max(stock.turnover_million_cny, 1) for stock in stocks)
            return SectorSnapshot(
                name=name,
                sector_id=sector_id,
                constituent_count=max(int(data.get("total") or 0), len(stocks)),
                change_percent=round(sum(
                    stock.change_percent * max(stock.turnover_million_cny, 1)
                    for stock in stocks
                ) / weights, 2),
                turnover_billion_cny=round(
                    sum(stock.turnover_million_cny for stock in stocks) / 1000, 2
                ),
                stocks=stocks,
                news=self.sector_news(name),
            )
        if not sector_id.startswith("sw_") or not sector_id.replace("_", "").isalnum():
            raise MarketProviderError("Unsupported sector identifier")
        payload = self._json_once(SINA_RANK_URL, {
            "page": 1,
            "num": limit,
            "sort": "amount",
            "asc": 0,
            "node": sector_id,
            "symbol": "",
            "_s_r_a": "page",
        }, referer="https://finance.sina.com.cn/")
        if not isinstance(payload, list):
            raise MarketProviderError("Industry constituents returned an invalid payload")
        stocks = [quote for row in payload if (quote := _sina_rank_quote(row)) is not None]
        stocks = [stock.model_copy(update={"sector": name}) for stock in stocks]
        if not stocks:
            raise MarketProviderError("Industry constituents returned no usable stocks")
        weights = sum(max(stock.turnover_million_cny, 1) for stock in stocks)
        return SectorSnapshot(
            name=name,
            sector_id=sector_id,
            constituent_count=len(stocks),
            change_percent=round(sum(
                stock.change_percent * max(stock.turnover_million_cny, 1) for stock in stocks
            ) / weights, 2),
            turnover_billion_cny=round(sum(stock.turnover_million_cny for stock in stocks) / 1000, 2),
            stocks=stocks,
            news=self.sector_news(name),
        )

    def sector_news(self, name: str, limit: int = 6) -> list[MarketNewsItem]:
        search = {
            "uid": "",
            "keyword": name,
            "type": ["cmsArticleWebOld"],
            "client": "web",
            "clientType": "web",
            "clientVersion": "curr",
            "param": {
                "cmsArticleWebOld": {
                    "searchScope": "default",
                    "sort": "time",
                    "pageIndex": 1,
                    "pageSize": limit,
                    "preTag": "",
                    "postTag": "",
                }
            },
        }
        try:
            payload = self._json(EASTMONEY_NEWS_SEARCH_URL, {
                "cb": "finmate",
                "param": json.dumps(search, ensure_ascii=False),
            }, referer="https://so.eastmoney.com/", attempts=1, timeout=5)
        except (MarketProviderError, ValueError, json.JSONDecodeError):
            return []
        rows = ((payload.get("result") or {}).get("cmsArticleWebOld") or [])
        news: list[MarketNewsItem] = []
        for row in rows:
            headline = _clean_news_text(row.get("title"))
            if not headline:
                continue
            try:
                published_at = datetime.strptime(
                    str(row.get("date")), "%Y-%m-%d %H:%M:%S"
                ).replace(tzinfo=SHANGHAI)
            except (TypeError, ValueError):
                published_at = datetime.now(SHANGHAI)
            summary = _clean_news_text(row.get("content"))
            news.append(MarketNewsItem(
                news_id=f"EM-{row.get('code') or len(news)}",
                headline=headline,
                summary=summary[:220] or headline,
                source=str(row.get("mediaName") or "东方财富资讯"),
                published_at=published_at,
                url=str(row.get("url") or "") or None,
            ))
        return news

    def _eastmoney_market_leaders(self, limit: int) -> tuple[list[StockQuote], int]:
        rows: list[dict[str, Any]] = []
        total = 0
        page_size = 100
        for page in range(1, (limit + page_size - 1) // page_size + 1):
            payload = self._json_once(MARKET_RANK_URL, {
                "pn": page,
                "pz": page_size,
                "po": 1,
                "np": 1,
                "fltt": 2,
                "invt": 2,
                "fid": "f6",
                "fs": "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048",
                "fields": "f12,f14,f2,f3,f6,f20,f100",
            })
            data = payload.get("data") or {}
            page_rows = data.get("diff") or []
            if not page_rows:
                break
            total = max(total, int(data.get("total") or 0))
            rows.extend(page_rows)
        stocks = [_eastmoney_rank_quote(row) for row in rows]
        return [stock for stock in stocks if stock is not None][:limit], total

    def _sina_market_leaders(self, limit: int) -> tuple[list[StockQuote], int]:
        rows: list[dict[str, Any]] = []
        page_size = 100
        for page in range(1, (limit + page_size - 1) // page_size + 1):
            payload = self._json_once(SINA_RANK_URL, {
                "page": page,
                "num": page_size,
                "sort": "amount",
                "asc": 0,
                "node": "hs_a",
                "symbol": "",
                "_s_r_a": "page",
            }, referer="https://finance.sina.com.cn/")
            if not isinstance(payload, list) or not payload:
                break
            rows.extend(payload)
        try:
            count_payload = self._json_once(
                SINA_COUNT_URL, {"node": "hs_a"}, referer="https://finance.sina.com.cn/"
            )
            total = int(count_payload)
        except (MarketProviderError, TypeError, ValueError):
            total = len(rows)
        stocks = [_sina_rank_quote(row) for row in rows]
        return [stock for stock in stocks if stock is not None][:limit], total

    def search(self, query: str, limit: int = 8) -> list[StockSearchItem]:
        value = query.strip()
        try:
            text = self._text(
                TENCENT_SEARCH_URL, {"q": value, "t": "all"}, referer="https://gu.qq.com/"
            )
            encoded = text.split("=", 1)[1].rstrip(";")
            rows = json.loads(encoded).split("^")
            results = []
            market_names = {"sh": "沪A", "sz": "深A", "bj": "北A"}
            for row in rows:
                parts = row.split("~")
                if len(parts) >= 3 and parts[0] in market_names and parts[1].isdigit() and len(parts[1]) == 6:
                    results.append(StockSearchItem(
                        symbol=parts[1], name=parts[2], market=market_names[parts[0]],
                        security_type="AStock",
                    ))
            if results:
                return results[:limit]
        except (MarketProviderError, ValueError, IndexError, json.JSONDecodeError):
            pass
        payload = self._json(SUGGEST_URL, {
            "input": value, "type": "14", "token": SUGGEST_TOKEN, "count": limit,
        })
        rows = payload.get("QuotationCodeTable", {}).get("Data") or []
        return [
            StockSearchItem(
                symbol=str(row["Code"]), name=str(row["Name"]), market=str(row.get("SecurityTypeName", "A股")),
                security_type=str(row.get("Classify", "AStock")),
            )
            for row in rows if row.get("Classify") == "AStock" and str(row.get("Code", "")).isdigit()
        ][:limit]

    def quotes(self, symbols: list[str]) -> QuoteBatch:
        normalized = list(dict.fromkeys(_normalize_symbol(item) for item in symbols))
        if not normalized:
            return QuoteBatch(quotes=[], source="tencent-live-quote", observed_at=datetime.now(SHANGHAI))
        quotes: list[StockQuote] = []
        for start in range(0, len(normalized), 80):
            chunk = normalized[start:start + 80]
            try:
                text = self._text(
                    TENCENT_QUOTE_URL + ",".join(_tencent_code(symbol) for symbol in chunk),
                    {},
                    referer="https://gu.qq.com/",
                    encoding="gbk",
                )
                quotes.extend(_tencent_quotes(text))
            except MarketProviderError:
                quotes = []
                break
        if quotes:
            return QuoteBatch(
                quotes=quotes, source="tencent-live-quote", observed_at=datetime.now(SHANGHAI)
            )
        payload = self._json(QUOTE_URL, {
            "fltt": "2", "invt": "2", "fields": "f12,f14,f2,f3,f6,f20",
            "secids": ",".join(_secid(symbol) for symbol in normalized),
        })
        rows = (payload.get("data") or {}).get("diff") or []
        quotes = []
        for row in rows:
            try:
                price = float(row["f2"])
                change = float(row["f3"])
            except (KeyError, TypeError, ValueError):
                continue
            if price <= 0:
                continue
            symbol = str(row["f12"]).zfill(6)
            quotes.append(StockQuote(
                symbol=symbol, name=str(row.get("f14") or symbol), sector=_fallback_sector(symbol),
                price=price, change_percent=change,
                turnover_million_cny=max(0.0, _float(row.get("f6")) / 1_000_000),
                market_cap_billion_cny=max(0.0, _float(row.get("f20")) / 100_000_000),
            ))
        if not quotes:
            raise MarketProviderError("Eastmoney returned no usable batch quotes")
        return QuoteBatch(quotes=quotes, source="eastmoney-batch-quote", observed_at=datetime.now(SHANGHAI))

    def profile(self, symbol: str) -> StockProfile:
        code = _normalize_symbol(symbol)
        try:
            payload = self._json(PROFILE_URL, {
                "fltt": "2", "invt": "2", "secid": _secid(code),
                "fields": "f57,f58,f84,f85,f116,f117,f127,f189,f43",
            })
        except MarketProviderError:
            quote = self.quotes([code]).quotes[0]
            return StockProfile(
                symbol=code,
                name=quote.name,
                industry=quote.sector,
                market_cap_billion_cny=quote.market_cap_billion_cny,
                source="tencent-live-profile-fallback",
                observed_at=datetime.now(SHANGHAI),
            )
        values = payload.get("data") or {}
        if not values:
            raise MarketProviderError("Eastmoney returned no company profile")
        return StockProfile(
            symbol=code, name=str(values.get("f58") or code), industry=_optional_text(values.get("f127")),
            listing_date=_listing_date(values.get("f189")),
            total_shares=_optional_float(values.get("f84")), float_shares=_optional_float(values.get("f85")),
            market_cap_billion_cny=_to_billions(values.get("f116")),
            float_market_cap_billion_cny=_to_billions(values.get("f117")),
            source="eastmoney-company-profile", observed_at=datetime.now(SHANGHAI),
        )

    def series(self, symbol: str, interval: str) -> StockSeries:
        code = _normalize_symbol(symbol)
        now = datetime.now(SHANGHAI)
        tencent_code = _tencent_code(code)
        if interval == "intraday":
            payload = self._json(TENCENT_MINUTE_URL, {"code": tencent_code}, referer="https://gu.qq.com/")
            node = ((payload.get("data") or {}).get(tencent_code) or {}).get("data") or {}
            candles = _minute_rows(node.get("data") or [], now.strftime("%Y-%m-%d"))
            label, realtime = "分时", True
        elif interval == "five_day":
            payload = self._json(TENCENT_FIVE_DAY_URL, {"code": tencent_code}, referer="https://gu.qq.com/")
            days = ((payload.get("data") or {}).get(tencent_code) or {}).get("data") or []
            candles = []
            for day in days:
                date_text = str(day.get("date", ""))
                date_text = f"{date_text[:4]}-{date_text[4:6]}-{date_text[6:8]}"
                candles.extend(_minute_rows(day.get("data") or [], date_text))
            candles.sort(key=lambda candle: candle.time)
            label, realtime = "五日", True
        else:
            config = {"daily": ("day", "日K"), "weekly": ("week", "周K"), "monthly": ("month", "月K")}
            try:
                period, label = config[interval]
            except KeyError as exc:
                raise MarketProviderError(f"Unsupported series interval: {interval}") from exc
            payload = self._json(TENCENT_KLINE_URL, {
                "param": f"{tencent_code},{period},,,360,qfq",
            }, referer="https://gu.qq.com/")
            node = (payload.get("data") or {}).get(tencent_code) or {}
            candles = _kline_rows(node.get(f"qfq{period}") or node.get(period) or [])
            realtime = False
        if not candles:
            raise MarketProviderError("No chart data returned for this stock and interval")
        return StockSeries(symbol=code, interval=interval, label=label, candles=candles[-360:],
                           source="tencent-market-kline", observed_at=now, is_realtime=realtime)

    def daily_range(self, symbol: str, start: datetime, end: datetime) -> StockSeries:
        code = _normalize_symbol(symbol)
        tencent_code = _tencent_code(code)
        payload = self._json(TENCENT_KLINE_URL, {
            "param": f"{tencent_code},day,{start.strftime('%Y-%m-%d')},{end.strftime('%Y-%m-%d')},640,qfq",
        }, referer="https://gu.qq.com/")
        node = (payload.get("data") or {}).get(tencent_code) or {}
        candles = _kline_rows(node.get("qfqday") or node.get("day") or [])
        if not candles:
            raise MarketProviderError("No trading record was found in the requested date range")
        return StockSeries(symbol=code, interval="daily", label="历史日K", candles=candles,
                           source="tencent-market-kline", observed_at=datetime.now(SHANGHAI))

    def _json(
        self,
        url: str,
        params: dict[str, Any],
        referer: str | None = None,
        attempts: int = 3,
        timeout: float = 8,
    ) -> dict[str, Any]:
        text = self._text(
            url, params, referer, attempts=attempts, timeout=timeout
        ).strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            start, end = text.find("("), text.rfind(")")
            if start >= 0 and end > start:
                return json.loads(text[start + 1:end])
            raise

    def _json_once(
        self, url: str, params: dict[str, Any], referer: str | None = None
    ) -> Any:
        headers = {**self.headers, **({"Referer": referer} if referer else {})}
        try:
            response = requests.get(url, params=params, headers=headers, timeout=3)
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, ValueError) as exc:
            raise MarketProviderError(f"Market ranking request failed: {exc}") from exc

    def _text(
        self,
        url: str,
        params: dict[str, Any],
        referer: str | None = None,
        encoding: str | None = None,
        attempts: int = 3,
        timeout: float = 8,
    ) -> str:
        last_error: Exception | None = None
        headers = {**self.headers, **({"Referer": referer} if referer else {})}
        for attempt in range(attempts):
            try:
                response = requests.get(url, params=params, headers=headers, timeout=timeout)
                response.raise_for_status()
                return response.content.decode(encoding) if encoding else response.text
            except (requests.RequestException, ValueError) as exc:
                last_error = exc
                if attempt < attempts - 1:
                    time.sleep(0.15 * (attempt + 1))
        raise MarketProviderError(f"Market data request failed after retries: {last_error}") from last_error


def _minute_rows(rows: list[str], date_text: str) -> list[Candle]:
    result: list[Candle] = []
    previous_volume = 0.0
    previous_amount = 0.0
    for value in rows:
        parts = str(value).split()
        if len(parts) < 4:
            continue
        try:
            price, total_volume, total_amount = float(parts[1]), float(parts[2]), float(parts[3])
            clock = parts[0].zfill(4)
            result.append(Candle(
                time=f"{date_text} {clock[:2]}:{clock[2:]}", open=price, high=price, low=price, close=price,
                volume=max(0.0, total_volume - previous_volume), amount=max(0.0, total_amount - previous_amount),
            ))
            previous_volume, previous_amount = total_volume, total_amount
        except (TypeError, ValueError):
            continue
    return result


def _kline_rows(rows: list[list[Any]]) -> list[Candle]:
    result: list[Candle] = []
    for row in rows:
        try:
            result.append(Candle(time=str(row[0]), open=float(row[1]), close=float(row[2]), high=float(row[3]),
                                 low=float(row[4]), volume=max(0.0, float(row[5]))))
        except (IndexError, TypeError, ValueError):
            continue
    return result


def _tencent_quotes(text: str) -> list[StockQuote]:
    quotes: list[StockQuote] = []
    for line in text.split(";"):
        if '="' not in line:
            continue
        parts = line.split('="', 1)[1].rstrip('"\r\n ').split("~")
        if len(parts) < 47:
            continue
        try:
            price = float(parts[3])
            change = float(parts[32])
        except (TypeError, ValueError):
            continue
        if price <= 0 or not parts[2].isdigit():
            continue
        symbol = parts[2].zfill(6)
        quotes.append(StockQuote(
            symbol=symbol,
            name=parts[1] or symbol,
            sector=_fallback_sector(symbol),
            price=price,
            change_percent=change,
            turnover_million_cny=max(0.0, _float(parts[37]) / 100),
            market_cap_billion_cny=max(0.0, _float(parts[45])),
        ))
    return quotes


def _eastmoney_rank_quote(row: dict[str, Any]) -> StockQuote | None:
    try:
        symbol = str(row["f12"]).zfill(6)
        price = float(row["f2"])
        change = float(row["f3"])
        turnover = max(0.0, float(row["f6"]) / 1_000_000)
    except (KeyError, TypeError, ValueError):
        return None
    if price <= 0 or not symbol.isdigit():
        return None
    industry = str(row.get("f100") or "").strip()
    return StockQuote(
        symbol=symbol,
        name=str(row.get("f14") or symbol),
        sector=industry if industry and industry != "-" else _fallback_sector(symbol),
        price=price,
        change_percent=change,
        turnover_million_cny=turnover,
        market_cap_billion_cny=max(0.0, _float(row.get("f20")) / 100_000_000),
    )


def _sina_rank_quote(row: dict[str, Any]) -> StockQuote | None:
    try:
        symbol = str(row.get("code") or "").zfill(6)
        price = float(row["trade"])
        change = float(row["changepercent"])
        turnover = max(0.0, float(row["amount"]) / 1_000_000)
    except (KeyError, TypeError, ValueError):
        return None
    if price <= 0 or not symbol.isdigit():
        return None
    return StockQuote(
        symbol=symbol,
        name=str(row.get("name") or symbol),
        sector=_fallback_sector(symbol),
        price=price,
        change_percent=change,
        turnover_million_cny=turnover,
        market_cap_billion_cny=max(0.0, _float(row.get("mktcap")) / 10_000),
    )


def _group_market_sectors(stocks: list[StockQuote]) -> list[SectorSnapshot]:
    grouped: dict[str, list[StockQuote]] = {}
    for stock in stocks:
        grouped.setdefault(stock.sector, []).append(stock)
    sectors = [
        SectorSnapshot(
            name=name,
            change_percent=round(
                sum(stock.change_percent * max(stock.turnover_million_cny, 1) for stock in group)
                / sum(max(stock.turnover_million_cny, 1) for stock in group),
                2,
            ),
            turnover_billion_cny=round(
                sum(stock.turnover_million_cny for stock in group) / 1000, 2
            ),
            stocks=sorted(group, key=lambda stock: stock.turnover_million_cny, reverse=True),
        )
        for name, group in grouped.items()
    ]
    return sorted(sectors, key=lambda sector: sector.turnover_billion_cny, reverse=True)


def _normalize_symbol(symbol: str) -> str:
    digits = "".join(character for character in symbol if character.isdigit())
    if len(digits) != 6:
        raise MarketProviderError("A-share symbol must contain six digits")
    return digits


def _secid(symbol: str) -> str:
    return f"{1 if symbol.startswith(('5', '6', '9')) else 0}.{symbol}"


def _tencent_code(symbol: str) -> str:
    return f"{'sh' if symbol.startswith(('5', '6', '9')) else 'sz'}{symbol}"


def _fallback_sector(symbol: str) -> str:
    if symbol.startswith("688"): return "科创板"
    if symbol.startswith("30"): return "创业板"
    if symbol.startswith("60"): return "沪市主板"
    if symbol.startswith(("00", "001")): return "深市主板"
    if symbol.startswith(("8", "4", "92")): return "北交所"
    return "A股"


def _float(value: Any) -> float:
    try: return float(value or 0)
    except (TypeError, ValueError): return 0.0


def _clean_news_text(value: Any) -> str:
    plain = re.sub(r"<[^>]+>", "", str(value or ""))
    return re.sub(r"\s+", " ", html.unescape(plain)).strip()


def _optional_float(value: Any) -> float | None:
    try: return float(value)
    except (TypeError, ValueError): return None


def _to_billions(value: Any) -> float | None:
    number = _optional_float(value)
    return round(number / 100_000_000, 2) if number is not None else None


def _optional_text(value: Any) -> str | None:
    return str(value) if value is not None and str(value).strip() else None


def _listing_date(value: Any) -> str | None:
    text = "".join(character for character in str(value or "") if character.isdigit())
    return f"{text[:4]}-{text[4:6]}-{text[6:8]}" if len(text) == 8 else None
