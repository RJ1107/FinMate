from app.agents.market_fact import MarketFactAgent
from app.domain.agent import AgentIntent
from app.services.llm import AnswerRefinementError, RefinedAnswer
from app.services.market import MarketService
from tests.test_market_service import OnDemandProvider


def make_agent() -> MarketFactAgent:
    return MarketFactAgent(MarketService(provider_name="demo"))


class FakeRefiner:
    def refine(self, question, draft, evidence) -> RefinedAnswer:
        assert question
        assert draft
        assert evidence
        return RefinedAnswer(
            content="模型增强回答 [MKT-001]。不构成投资建议。",
            model="qwen/test-model",
        )


class FailingRefiner:
    def refine(self, question, draft, evidence) -> RefinedAnswer:
        raise AnswerRefinementError("simulated failure")


def test_market_summary_uses_deterministic_evidence() -> None:
    answer = make_agent().ask("今天市场怎么样？")

    assert answer.intent == AgentIntent.MARKET_SUMMARY
    assert "上涨 3298 家" in answer.answer
    assert len(answer.evidence) == 3
    assert [step.node for step in answer.trace] == [
        "load_market",
        "route_intent",
        "compose_market",
        "verify_evidence",
    ]


def test_limit_question_answers_the_requested_market_fact() -> None:
    answer = make_agent().ask("今天涨停和跌停有多少？")

    assert answer.intent == AgentIntent.MARKET_SUMMARY
    assert "涨停 67 家，跌停 12 家" in answer.answer
    assert len(answer.evidence) == 2
    assert answer.evidence[0].title == "样本涨跌停家数"


def test_model_refines_deterministic_answer_and_keeps_evidence() -> None:
    agent = MarketFactAgent(MarketService(provider_name="demo"), FakeRefiner())

    answer = agent.ask("今天市场怎么样？")

    assert answer.answer_mode == "model"
    assert answer.model == "qwen/test-model"
    assert answer.answer.startswith("模型增强回答")
    assert len(answer.evidence) == 3
    assert answer.trace[-1].node == "refine_with_model"


def test_model_failure_falls_back_to_deterministic_answer() -> None:
    agent = MarketFactAgent(MarketService(provider_name="demo"), FailingRefiner())

    answer = agent.ask("今天市场怎么样？")

    assert answer.answer_mode == "deterministic"
    assert answer.model is None
    assert "只观察样本中整体" in answer.answer
    assert answer.trace[-1].summary == "调用失败，保留确定性结论"


def test_stock_question_resolves_name_and_calculates_comparison() -> None:
    answer = make_agent().ask("宁德时代表现如何？")

    assert answer.intent == AgentIntent.STOCK_SNAPSHOT
    assert answer.resolved_entity == "宁德时代 (300750)"
    assert "强于新能源板块" in answer.answer
    assert len(answer.evidence) == 2
    assert "resolve_entity" in [step.node for step in answer.trace]


def test_unknown_question_states_current_boundary() -> None:
    answer = make_agent().ask("帮我预测下个月的价格")

    assert answer.intent == AgentIntent.UNKNOWN
    assert answer.confidence == 0.6
    assert "通用金融知识" in answer.answer


def test_financial_concept_reaches_model_without_invented_market_evidence() -> None:
    class ConceptRefiner:
        def refine(self, question, draft, evidence):
            assert question == "什么是市盈率？"
            assert "内部校验时间" in draft
            assert "demo" not in draft
            assert evidence == []
            return RefinedAnswer(content="市盈率是股价与每股收益之比。", model="qwen/test")

    answer = MarketFactAgent(MarketService(provider_name="demo"), ConceptRefiner()).ask("什么是市盈率？")
    assert answer.answer_mode == "model"
    assert answer.evidence == []
    assert answer.answer.startswith("市盈率")


def test_arbitrary_stock_yesterday_question_uses_historical_tool() -> None:
    service = MarketService(provider_name="demo")
    service.stock_provider = OnDemandProvider()
    answer = MarketFactAgent(service).ask("兆易创新昨天如何？")

    assert answer.intent == AgentIntent.STOCK_SNAPSHOT
    assert answer.resolved_entity == "兆易创新 (603986)"
    assert "2026-09-07" in answer.answer
    assert answer.evidence[0].evidence_id == "HIST-001"
    assert answer.evidence[0].source == "test-history"


def test_known_stock_close_query_calls_live_quote_tool() -> None:
    from datetime import UTC, datetime

    from app.domain.models import QuoteBatch, StockQuote

    class YunnanBaiyaoProvider(OnDemandProvider):
        def quotes(self, symbols: list[str]):
            self.quote_calls += 1
            symbol = symbols[0]
            return QuoteBatch(
                quotes=[StockQuote(
                    symbol=symbol,
                    name="云南白药" if symbol == "000538" else "中芯国际",
                    sector="医药生物",
                    price=61.27 if symbol == "000538" else 100.0,
                    change_percent=1.14,
                    turnover_million_cny=812.4,
                    market_cap_billion_cny=1092.3,
                )],
                source="test-live",
                observed_at=datetime.now(UTC),
            )

    service = MarketService(provider_name="demo")
    provider = YunnanBaiyaoProvider()
    service.stock_provider = provider
    answer = MarketFactAgent(service, use_live_market_overlay=True).ask("云南白药今天收盘价多少？")

    assert "最新收盘价 61.27 元" in answer.answer
    assert provider.quote_calls == 2
    assert [step.node for step in answer.trace] == [
        "load_market", "route_intent", "plan_tools", "resolve_entity", "compose_stock", "verify_evidence",
    ]


def test_model_output_with_ungrounded_price_falls_back_to_tool_answer() -> None:
    class InventingRefiner:
        def refine(self, question, draft, evidence):
            return RefinedAnswer(content="云南白药最新收盘价 999.99 元。", model="qwen/test")

    agent = MarketFactAgent(MarketService(provider_name="demo"), InventingRefiner())
    answer = agent.ask("云南白药收盘价多少？")

    assert answer.answer_mode == "deterministic"
    assert "999.99" not in answer.answer
    assert answer.trace[-1].label == "模型输出复核"
