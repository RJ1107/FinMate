from dataclasses import dataclass
from typing import Protocol

from openai import APIError, OpenAI

from app.domain.agent import AgentEvidence


@dataclass(frozen=True)
class RefinedAnswer:
    content: str
    model: str


class AnswerRefinementError(RuntimeError):
    pass


class AnswerRefiner(Protocol):
    def refine(
        self,
        question: str,
        draft: str,
        evidence: list[AgentEvidence],
    ) -> RefinedAnswer: ...


class OpenRouterAnswerRefiner:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        fallback_model: str,
        http_referer: str,
        app_title: str,
    ) -> None:
        self.model = model
        self.fallback_model = fallback_model
        self.client = OpenAI(
            api_key=api_key,
            base_url=base_url,
            default_headers={
                "HTTP-Referer": http_referer,
                "X-OpenRouter-Title": app_title,
            },
            max_retries=1,
            timeout=12.0,
        )

    def refine(
        self,
        question: str,
        draft: str,
        evidence: list[AgentEvidence],
    ) -> RefinedAnswer:
        facts = "\n".join(
            f"[{item.evidence_id}] {item.title}: {item.value}" for item in evidence
        )
        try:
            completion = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "你是 FinMate 的 A 股研究助手。先直接回答用户，再给简洁而有信息量的分析。"
                            "证券价格、涨跌幅、成交额、日期和新闻等时效性事实只能使用提供的工具证据，"
                            "不得凭记忆补数字；可以自由解释金融概念、分析驱动因素并讨论有前提的情景。"
                            "把事实、推断和观点区分清楚，不承诺收益，也不要用空泛的合规话术回避正常问题。"
                            "除非用户主动询问数据来源，否则绝不披露数据源、缓存、快照、demo、模拟数据、"
                            "内部工具或校验过程，也不要说‘演示快照’‘历史模拟’‘非今日实盘’。"
                            "若草稿包含用户画像、持仓或资产配置，必须以‘结合您的用户画像’开头，"
                            "保留草稿中的资产类别、比例和金额，并给出分批执行与风险控制建议，"
                            "不要退回要求股票代码，也不要把具体方案改成空泛提醒。"
                            "有事实证据时可用方括号编号引用；通用知识回答不需要伪造引用。"
                            "控制在 300 个汉字以内。"
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"问题：{question}\n"
                            f"确定性草稿：{draft}\n"
                            f"事实证据：\n{facts}\n"
                            "请保留工具事实的数值与时间含义，用自然中文组织答案。"
                        ),
                    },
                ],
                max_tokens=420,
                temperature=0.3,
                extra_body={
                    "models": [self.fallback_model],
                    "reasoning": {"effort": "none", "exclude": True},
                },
            )
        except APIError as exc:
            raise AnswerRefinementError("OpenRouter request failed") from exc
        message = completion.choices[0].message.content
        if not message or not message.strip():
            raise AnswerRefinementError("OpenRouter returned an empty answer")
        return RefinedAnswer(content=message.strip(), model=completion.model)
