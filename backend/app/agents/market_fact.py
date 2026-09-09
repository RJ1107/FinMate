import operator
import re
import time
from datetime import datetime, timedelta
from typing import Annotated, Literal, TypedDict
from uuid import uuid4
from zoneinfo import ZoneInfo

from langgraph.graph import END, START, StateGraph

from app.domain.agent import AgentAnswer, AgentEvidence, AgentIntent, AgentTraceStep
from app.domain.models import MarketOverview, StockDetail
from app.providers.base import MarketProviderError
from app.services.llm import AnswerRefinementError, AnswerRefiner
from app.services.market import MarketService


class MarketFactState(TypedDict, total=False):
    question: str
    intent: AgentIntent
    symbol: str
    resolved_entity: str
    overview: MarketOverview
    detail: StockDetail | None
    answer: str
    confidence: float
    evidence: Annotated[list[AgentEvidence], operator.add]
    trace: Annotated[list[AgentTraceStep], operator.add]
    answer_mode: str
    model: str
    tool_plan: str


class MarketFactAgent:
    """A deterministic baseline graph that keeps market math outside the LLM."""

    def __init__(
        self,
        market_service: MarketService,
        answer_refiner: AnswerRefiner | None = None,
        use_live_market_overlay: bool = False,
    ) -> None:
        self.market_service = market_service
        self.answer_refiner = answer_refiner
        self.use_live_market_overlay = use_live_market_overlay
        self.graph = self._build_graph()

    def ask(self, question: str) -> AgentAnswer:
        result = self.graph.invoke({"question": question, "evidence": [], "trace": []})
        overview = result["overview"]
        detail = result.get("detail")
        provenance = detail.provenance if detail is not None else overview.provenance
        return AgentAnswer(
            request_id=str(uuid4()),
            answer=result["answer"],
            intent=result["intent"],
            resolved_entity=result.get("resolved_entity"),
            confidence=result["confidence"],
            evidence=result.get("evidence", []),
            trace=result.get("trace", []),
            data_mode=provenance.mode,
            observed_at=provenance.observed_at,
            answer_mode=result.get("answer_mode", "deterministic"),
            model=result.get("model"),
        )

    def _build_graph(self):
        builder = StateGraph(MarketFactState)
        builder.add_node("load_market", self._load_market)
        builder.add_node("route_intent", self._route_intent)
        builder.add_node("plan_tools", self._plan_tools)
        builder.add_node("resolve_entity", self._resolve_entity)
        builder.add_node("compose_market", self._compose_market)
        builder.add_node("compose_stock", self._compose_stock)
        builder.add_node("compose_clarification", self._compose_clarification)
        builder.add_node("compose_help", self._compose_help)
        builder.add_node("verify_evidence", self._verify_evidence)
        if self.answer_refiner:
            builder.add_node("refine_with_model", self._refine_with_model)

        builder.add_edge(START, "load_market")
        builder.add_edge("load_market", "route_intent")
        builder.add_conditional_edges(
            "route_intent",
            self._route_after_intent,
            {
                AgentIntent.MARKET_SUMMARY: "compose_market",
                AgentIntent.STOCK_SNAPSHOT: "plan_tools",
                AgentIntent.UNKNOWN: "compose_help",
            },
        )
        builder.add_edge("plan_tools", "resolve_entity")
        builder.add_conditional_edges(
            "resolve_entity",
            self._route_after_entity,
            {"found": "compose_stock", "missing": "compose_clarification"},
        )
        if self.answer_refiner:
            builder.add_edge("compose_market", "verify_evidence")
            builder.add_edge("compose_stock", "verify_evidence")
            builder.add_edge("verify_evidence", "refine_with_model")
            builder.add_edge("refine_with_model", END)
        else:
            builder.add_edge("compose_market", "verify_evidence")
            builder.add_edge("compose_stock", "verify_evidence")
            builder.add_edge("verify_evidence", END)
        builder.add_edge("compose_clarification", END)
        builder.add_edge("compose_help", "refine_with_model" if self.answer_refiner else END)
        return builder.compile(name="finmate-market-fact-agent")

    def _load_market(self, state: MarketFactState) -> dict:
        started = time.perf_counter()
        overview = (
            self.market_service.get_realtime_overview()
            if self.use_live_market_overlay
            else self.market_service.get_overview()
        )
        return {
            "overview": overview,
            "trace": [
                _trace(
                    "load_market",
                    "读取市场行情",
                    f"{sum(len(sector.stocks) for sector in overview.sectors)} 只行情完成校验",
                    started,
                )
            ],
        }

    def _route_intent(self, state: MarketFactState) -> dict:
        started = time.perf_counter()
        question = state["question"].strip().lower()
        stock_terms = [
            stock.symbol.lower() for sector in state["overview"].sectors for stock in sector.stocks
        ] + [stock.name.lower() for sector in state["overview"].sectors for stock in sector.stocks]
        market_markers = (
            "大盘",
            "市场",
            "涨跌",
            "上涨",
            "下跌",
            "行情",
            "板块",
            "成交额",
            "涨停",
            "跌停",
            "今天怎么样",
            "情绪",
            "数据源",
            "数据来源",
            "行情来源",
        )
        matched_stock = next((term for term in stock_terms if term in question), None)
        external = None
        symbol_match = re.search(r"(?<!\d)(\d{6})(?!\d)", question)
        candidate = _stock_search_candidate(question)
        generic_candidate = any(
            marker in candidate
            for marker in (
                "市场", "大盘", "板块", "成交额", "涨停", "跌停", "情绪", "预测", "未来",
            )
        )
        stock_question_markers = (
            "如何", "怎么样", "表现", "走势", "涨", "跌", "股价", "行情", "价格", "收盘",
            "开盘", "最高", "最低", "成交", "市值", "多少", "昨天", "上周", "上个月",
        )
        looks_like_stock = bool(
            symbol_match
            or (
                candidate
                and not generic_candidate
                and any(item in question for item in stock_question_markers)
            )
        )
        if not matched_stock and looks_like_stock:
            try:
                external = self.market_service.search_stocks(symbol_match.group(1) if symbol_match else candidate, 1)
            except MarketProviderError:
                external = []
        if matched_stock or external or looks_like_stock:
            intent = AgentIntent.STOCK_SNAPSHOT
        elif any(marker in question for marker in market_markers):
            intent = AgentIntent.MARKET_SUMMARY
        else:
            intent = AgentIntent.UNKNOWN
        result = {
            "intent": intent,
            "trace": [_trace("route_intent", "识别问题意图", intent.value, started)],
        }
        if external:
            result["symbol"] = external[0].symbol
            result["resolved_entity"] = f"{external[0].name} ({external[0].symbol})"
        return result

    def _plan_tools(self, state: MarketFactState) -> dict:
        started = time.perf_counter()
        history = _history_window(state["question"])
        tool_plan = "historical_kline" if history else "live_quote"
        summary = "历史 K 线工具" if history else "实时行情工具"
        return {
            "tool_plan": tool_plan,
            "trace": [_trace("plan_tools", "规划工具调用", summary, started)],
        }

    def _resolve_entity(self, state: MarketFactState) -> dict:
        started = time.perf_counter()
        question = state["question"].strip().lower()
        if state.get("symbol"):
            detail = (
                self.market_service.get_live_stock(state["symbol"])
                if self.use_live_market_overlay
                else self.market_service.get_stock(state["symbol"])
            )
            return {
                "detail": detail,
                "trace": [_trace("resolve_entity", "调用行情工具", state.get("resolved_entity", state["symbol"]), started)],
            }
        for sector in state["overview"].sectors:
            for stock in sector.stocks:
                if stock.symbol.lower() in question or stock.name.lower() in question:
                    detail = (
                        self.market_service.get_live_stock(stock.symbol)
                        if self.use_live_market_overlay
                        else self.market_service.get_stock(stock.symbol)
                    )
                    return {
                        "symbol": stock.symbol,
                        "resolved_entity": f"{stock.name} ({stock.symbol})",
                        "detail": detail,
                        "trace": [
                            _trace(
                                "resolve_entity",
                                "调用实时行情工具" if self.use_live_market_overlay else "读取个股行情",
                                f"已返回 {stock.name} ({stock.symbol})",
                                started,
                            )
                        ],
                    }
        return {
            "detail": None,
            "trace": [_trace("resolve_entity", "解析金融实体", "未找到唯一标的", started)],
        }

    def _compose_market(self, state: MarketFactState) -> dict:
        started = time.perf_counter()
        overview = state["overview"]
        metrics = overview.metrics
        question = state["question"]
        sample_size = sum(len(sector.stocks) for sector in overview.sectors)
        scope = f"当前 {sample_size} 只观察样本中"

        if "涨停" in question or "跌停" in question:
            answer = (
                f"{scope}涨停 {metrics.limit_up} 家，跌停 {metrics.limit_down} 家；"
                f"市场上涨 {metrics.advancers} 家、下跌 {metrics.decliners} 家。"
            )
            evidence = [
                _evidence(
                    "MKT-001",
                    "样本涨跌停家数",
                    f"{metrics.limit_up} 涨停 / {metrics.limit_down} 跌停",
                    overview,
                ),
                _evidence(
                    "MKT-002",
                    "市场宽度",
                    f"{metrics.advancers} 涨 / {metrics.decliners} 跌",
                    overview,
                ),
            ]
            return {
                "answer": answer,
                "confidence": 1.0,
                "evidence": evidence,
                "trace": [_trace("compose_market", "生成涨跌停结论", "2 条事实证据", started)],
            }

        strongest = max(overview.sectors, key=lambda sector: sector.change_percent)
        weakest = min(overview.sectors, key=lambda sector: sector.change_percent)
        direction = (
            "偏强"
            if metrics.sentiment_score >= 60
            else "偏弱"
            if metrics.sentiment_score < 40
            else "震荡"
        )
        answer = (
            f"{scope}整体{direction}：上涨 {metrics.advancers} 家，下跌 {metrics.decliners} 家，"
            f"成交额 {metrics.turnover_billion_cny * 10:.1f} 亿元，情绪分数 {metrics.sentiment_score:.0f}/100。"
            f"样本板块中 {strongest.name} 表现最强（{_signed(strongest.change_percent)}%），"
            f"{weakest.name} 表现最弱（{_signed(weakest.change_percent)}%）。"
        )
        evidence = [
            _evidence(
                "MKT-001",
                "样本宽度",
                f"{metrics.advancers} 涨 / {metrics.decliners} 跌",
                overview,
            ),
            _evidence(
                "MKT-002", "市场成交额", f"{metrics.turnover_billion_cny * 10:.1f} 亿元", overview
            ),
            _evidence("MKT-003", "强弱板块", f"{strongest.name} / {weakest.name}", overview),
        ]
        return {
            "answer": answer,
            "confidence": 1.0,
            "evidence": evidence,
            "trace": [_trace("compose_market", "生成市场结论", "3 条事实证据", started)],
        }

    def _compose_stock(self, state: MarketFactState) -> dict:
        started = time.perf_counter()
        detail = state["detail"]
        if detail is None:
            return self._compose_clarification(state)
        quote = detail.quote
        window = _history_window(state["question"])
        if window:
            try:
                series = self.market_service.stock_provider.daily_range(quote.symbol, window[0], window[1])
                candles = series.candles
                target = candles[-1]
                if window[3] == "period" and len(candles) > 1:
                    first = candles[0]
                    change = (target.close / first.close - 1) * 100
                    answer = (
                        f"{quote.name}（{quote.symbol}）{window[2]}首个交易日收盘 {first.close:.2f} 元，"
                        f"末个交易日收盘 {target.close:.2f} 元，区间涨跌 {_signed(change)}%。"
                        f"区间最高 {max(item.high for item in candles):.2f} 元，最低 {min(item.low for item in candles):.2f} 元。"
                    )
                else:
                    previous = candles[-2] if len(candles) > 1 else None
                    change = ((target.close / previous.close - 1) * 100) if previous else ((target.close / target.open - 1) * 100)
                    answer = (
                        f"{quote.name}（{quote.symbol}）最近符合{window[2]}的交易记录为 {target.time}："
                        f"收盘 {target.close:.2f} 元，涨跌 {_signed(change)}%，"
                        f"最高 {target.high:.2f} 元，最低 {target.low:.2f} 元，成交量 {target.volume:.0f} 手。"
                    )
                evidence = [AgentEvidence(
                    evidence_id="HIST-001", title=f"{quote.name} {window[2]}历史行情",
                    value=f"{target.time} · 收盘 {target.close:.2f} · {_signed(change)}%",
                    source=series.source, observed_at=_candle_datetime(target.time),
                )]
                return {
                    "answer": answer, "confidence": 0.98, "evidence": evidence,
                    "trace": [_trace("compose_stock", "查询历史行情", f"已校验 {window[2]} K 线", started)],
                }
            except MarketProviderError as exc:
                return {
                    "answer": f"已识别 {quote.name}（{quote.symbol}），但{window[2]}历史行情暂时无法读取，请稍后重试。",
                    "confidence": 0.2,
                    "trace": [_trace("compose_stock", "查询历史行情失败", str(exc)[:80], started)],
                }
        price_label = "最新收盘价" if "收盘" in state["question"] else "最新价"
        answer = (
            f"{quote.name}（{quote.symbol}）{price_label} {quote.price:.2f} 元，"
            f"涨跌幅 {_signed(quote.change_percent)}%，成交额 {quote.turnover_million_cny / 100:.2f} 亿元。"
        )
        evidence = [
            AgentEvidence(
                evidence_id="STK-001",
                title=f"{quote.name} 行情",
                value=f"{quote.price:.2f} 元 · {_signed(quote.change_percent)}%",
                source=detail.provenance.source,
                observed_at=detail.provenance.observed_at,
            ),
        ]
        if detail.sector_size > 1:
            comparison = "强于" if detail.relative_to_sector_percent >= 0 else "弱于"
            answer += (
                f"它{comparison}{quote.sector}板块 {abs(detail.relative_to_sector_percent):.2f} 个百分点，"
                f"涨跌幅在当前样本板块中排名 {detail.rank_in_sector}/{detail.sector_size}。"
            )
            evidence.append(_evidence(
                "STK-002",
                "相对板块表现",
                f"{_signed(detail.relative_to_sector_percent)} 个百分点",
                state["overview"],
            ))
        else:
            answer += f"所属板块为{quote.sector}。"
        return {
            "answer": answer,
            "confidence": 1.0,
            "evidence": evidence,
            "trace": [_trace("compose_stock", "生成个股结论", f"{len(evidence)} 条事实证据", started)],
        }

    def _compose_clarification(self, state: MarketFactState) -> dict:
        started = time.perf_counter()
        return {
            "answer": "我识别到这是个股问题，但没有找到唯一匹配。请提供六位股票代码或完整公司简称。",
            "confidence": 0.0,
            "trace": [_trace("compose_clarification", "请求补充信息", "缺少唯一股票实体", started)],
        }

    def _refine_with_model(self, state: MarketFactState) -> dict:
        started = time.perf_counter()
        if self.answer_refiner is None:
            return {}
        try:
            detail = state.get("detail")
            provenance = detail.provenance if detail is not None else state["overview"].provenance
            source_requested = _asks_for_source(state["question"])
            source_context = (
                f"；用户主动询问数据来源，可回答：{_source_label(provenance.source)}"
                if source_requested
                else "；不要向用户披露内部数据源、缓存或工具实现"
            )
            deterministic_answer = state["answer"]
            refined = self.answer_refiner.refine(
                question=state["question"],
                draft=(
                    f"内部校验时间：{provenance.observed_at.isoformat()}{source_context}。\n"
                    f"已验证工具结论：{deterministic_answer}"
                ),
                evidence=state.get("evidence", []),
            )
        except AnswerRefinementError:
            return {
                "answer_mode": "deterministic",
                "trace": [
                    _trace(
                        "refine_with_model",
                        "大模型增强",
                        "调用失败，保留确定性结论",
                        started,
                    )
                ],
            }
        valid, validation_summary = _validate_model_answer(
            refined.content,
            state["question"],
            deterministic_answer,
            state.get("evidence", []),
        )
        if not valid:
            return {
                "answer": deterministic_answer,
                "answer_mode": "deterministic",
                "trace": [
                    _trace("refine_with_model", "模型输出复核", validation_summary, started)
                ],
            }
        return {
            "answer": refined.content,
            "answer_mode": "model",
            "model": refined.model,
            "trace": [
                _trace("refine_with_model", "模型组织答案", "已通过事实与披露复核", started)
            ],
        }

    def _compose_help(self, state: MarketFactState) -> dict:
        started = time.perf_counter()
        return {
            "answer": "请基于通用金融知识直接回答这个问题；涉及未来走势时，用条件、影响因素与风险场景表达，不编造实时行情数字。",
            "confidence": 0.6,
            "trace": [_trace("compose_help", "进入通用金融问答", "无需行情工具", started)],
        }

    def _verify_evidence(self, state: MarketFactState) -> dict:
        started = time.perf_counter()
        evidence = state.get("evidence", [])
        if not evidence:
            return {
                "confidence": min(state.get("confidence", 0.0), 0.2),
                "trace": [_trace("verify_evidence", "校验工具结果", "未取得可引用行情", started)],
            }
        return {
            "trace": [
                _trace(
                    "verify_evidence",
                    "校验工具结果",
                    f"{len(evidence)} 条行情事实通过",
                    started,
                )
            ]
        }

    @staticmethod
    def _route_after_intent(state: MarketFactState) -> AgentIntent:
        return state["intent"]

    @staticmethod
    def _route_after_entity(state: MarketFactState) -> Literal["found", "missing"]:
        return "found" if state.get("detail") is not None else "missing"


def _trace(node: str, label: str, summary: str, started: float) -> AgentTraceStep:
    return AgentTraceStep(
        node=node,
        label=label,
        summary=summary,
        duration_ms=round((time.perf_counter() - started) * 1000, 3),
    )


def _evidence(
    evidence_id: str,
    title: str,
    value: str,
    overview: MarketOverview,
) -> AgentEvidence:
    return AgentEvidence(
        evidence_id=evidence_id,
        title=title,
        value=value,
        source=overview.provenance.source,
        observed_at=overview.provenance.observed_at,
    )


def _signed(value: float) -> str:
    return f"{value:+.2f}"


def _stock_search_candidate(question: str) -> str:
    value = question.strip()
    removable = (
        "请问", "帮我查一下", "帮我查", "查询", "股票", "股价", "行情", "走势", "表现", "怎么样",
        "如何", "今天", "今日", "现在", "当前", "昨天", "昨日", "前天", "上周", "上个月", "本月",
        "涨了多少", "跌了多少", "涨跌", "收盘价", "开盘价", "最新价", "价格", "多少",
        "成交额", "市值", "的", "？", "?", "。", "，", ",", " ",
    )
    for token in removable:
        value = value.replace(token, "")
    value = re.sub(r"\d{4}[年/-]\d{1,2}[月/-]\d{1,2}日?", "", value)
    return value[:16]


def _history_window(question: str, now: datetime | None = None):
    current = now or datetime.now(ZoneInfo("Asia/Shanghai"))
    explicit = re.search(r"(20\d{2})[年/-](\d{1,2})[月/-](\d{1,2})日?", question)
    if explicit:
        target = current.replace(year=int(explicit.group(1)), month=int(explicit.group(2)), day=int(explicit.group(3)), hour=23, minute=59, second=59)
        return target - timedelta(days=10), target, target.strftime("%Y-%m-%d"), "day"
    if "前天" in question:
        target = current - timedelta(days=2)
        return target - timedelta(days=10), target, "前天", "day"
    if "昨天" in question or "昨日" in question:
        target = current - timedelta(days=1)
        return target - timedelta(days=10), target, "昨天", "day"
    if "上周" in question:
        this_monday = current - timedelta(days=current.weekday())
        start = this_monday - timedelta(days=7)
        return start, this_monday - timedelta(seconds=1), "上周", "period"
    if "上个月" in question:
        first_this_month = current.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end = first_this_month - timedelta(seconds=1)
        return end.replace(day=1, hour=0, minute=0, second=0), end, "上个月", "period"
    return None


def _candle_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=ZoneInfo("Asia/Shanghai"))


def _asks_for_source(question: str) -> bool:
    return any(marker in question for marker in ("数据源", "数据来源", "行情来源", "哪里来的数据", "来源是"))


def _source_label(source: str) -> str:
    normalized = source.lower()
    if "tencent" in normalized:
        return "腾讯行情接口"
    if "eastmoney" in normalized:
        return "东方财富行情接口"
    if "akshare" in normalized:
        return "AKShare 聚合行情"
    return "FinMate 行情服务"


def _validate_model_answer(
    content: str,
    question: str,
    deterministic_answer: str,
    evidence: list[AgentEvidence],
) -> tuple[bool, str]:
    if not _asks_for_source(question):
        forbidden = (
            "演示快照",
            "历史模拟",
            "非今日实盘",
            "当前快照",
            "数据状态",
            "内部校验",
        )
        if any(item in content for item in forbidden):
            return False, "包含不应展示的内部数据措辞，采用工具结论"

    if not evidence:
        return True, "通用知识回答"

    grounded_text = " ".join(
        [question, deterministic_answer]
        + [f"{item.evidence_id} {item.value}" for item in evidence]
    )
    grounded_numbers = {_normalize_number(item) for item in _extract_numbers(grounded_text)}
    answer_numbers = {_normalize_number(item) for item in _extract_numbers(content)}
    if not answer_numbers.issubset(grounded_numbers):
        return False, "出现工具证据之外的数字，采用工具结论"
    return True, "事实与披露复核通过"


def _extract_numbers(value: str) -> list[str]:
    return re.findall(r"(?<![A-Za-z])[-+]?\d+(?:\.\d+)?%?", value)


def _normalize_number(value: str) -> str:
    suffix = "%" if value.endswith("%") else ""
    number = value.removesuffix("%").lstrip("+")
    try:
        normalized = f"{float(number):.8f}".rstrip("0").rstrip(".")
    except ValueError:
        normalized = number
    return f"{normalized}{suffix}"
