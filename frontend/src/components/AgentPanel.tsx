import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, CircleDot, MessageCircle, Send } from "lucide-react";

import { ApiError, getAgentStatus, getDailyQuota, queryAgent } from "../api";
import { getClientIdentity } from "../identity";
import type { AgentAnswer, AgentStatus } from "../types";

const examples = ["今天市场怎么样？", "宁德时代表现如何？", "结合我的画像，10 万元如何配置？"];

interface Props {
  onConversation?: (question: string, answer: AgentAnswer) => void;
}

export function AgentPanel({ onConversation }: Props) {
  const [{ clientId, conversationId }] = useState(getClientIdentity);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AgentAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    void getAgentStatus().then((value) => { if (active) setStatus(value); })
      .catch(() => { if (active) setStatusError(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void getDailyQuota(clientId)
      .then((value) => { if (active) setQuotaRemaining(value.agent_remaining); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [clientId]);

  const modelName = (model: string | null | undefined) => model?.toLowerCase().includes("deepseek")
    ? "DeepSeek" : model?.toLowerCase().includes("qwen") ? "Qwen" : model?.split("/").pop() ?? "大模型";
  const modelFailed = Boolean(answer && answer.answer_mode !== "model" && answer.trace.some((step) => step.node === "refine_with_model"));
  const statusLabel = loading ? "模型分析中" : answer?.answer_mode === "model"
    ? `${modelName(answer.model)} · 已响应` : modelFailed ? "模型暂不可用"
      : status?.configured ? `${modelName(status.model)} · 已配置`
        : status ? "未配置模型" : statusError ? "状态获取失败" : "检查模型配置";

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const normalized = question.trim();
    if (normalized.length < 2 || loading || quotaRemaining === 0) return;
    setLoading(true);
    setError(null);
    try {
      const result = await queryAgent(normalized, clientId, conversationId);
      setAnswer(result);
      if (result.daily_remaining != null) setQuotaRemaining(result.daily_remaining);
      onConversation?.(normalized, result);
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "daily_agent_limit") setQuotaRemaining(0);
      setError(reason instanceof Error ? reason.message : "分析请求失败");
    } finally {
      setLoading(false);
    }
  };

  const runExample = (value: string) => {
    setQuestion(value);
    setAnswer(null);
  };

  return (
    <section className="agent-workspace" id="analysis">
      <div className="agent-heading">
        <div className="agent-title">
          <span className="agent-icon"><MessageCircle size={18} /></span>
          <div>
            <h2>HeyFinmate</h2>
            <p>A 股行情解读与金融问答</p>
          </div>
        </div>
        <span className={`baseline-label${answer?.answer_mode === "model" ? " baseline-label--model" : modelFailed ? " baseline-label--error" : ""}`} role="status" title={answer?.model ?? status?.model ?? undefined}>
          {statusLabel}
        </span>
      </div>

      <form className="agent-form" onSubmit={(event) => void submit(event)}>
        <label>
          <span className="sr-only">向 FinMate 提问</span>
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="问问 FinMate，例如：宁德时代表现如何？"
            maxLength={500}
          />
        </label>
        <button type="submit" disabled={question.trim().length < 2 || loading || quotaRemaining === 0}>
          <Send size={16} />
          {loading ? "分析中" : "分析"}
        </button>
      </form>
      <p className="quota-note">
        每天最多 20 次 FinMate 对话
        {quotaRemaining != null && <> · 今日剩余 {quotaRemaining} 次</>}
      </p>

      <div className="example-row" aria-label="示例问题">
        {examples.map((example) => (
          <button type="button" key={example} onClick={() => runExample(example)}>
            {example}
          </button>
        ))}
      </div>

      {error && <p className="agent-error" role="alert">{error}</p>}
      {modelFailed && <p className="agent-error" role="alert">大模型本次未能响应，下面保留行情事实回答，可重新提交。</p>}

      {answer && (
        <div className="agent-result">
          <div className="answer-column">
            <div className="answer-meta">
              <span>{intentLabel(answer.intent)}</span>
              <span>{answer.answer_mode === "model" ? "模型增强" : "确定性回答"}</span>
              {answer.model && <span>{answer.model}</span>}
              {answer.resolved_entity && <span>{answer.resolved_entity}</span>}
            </div>
            <p className="answer-text">{answer.answer}</p>

            <h3>事实证据</h3>
            <div className="evidence-list">
              {answer.evidence.length ? answer.evidence.map((item) => (
                <div className="evidence-row" key={item.evidence_id}>
                  <CheckCircle2 size={16} />
                  <div>
                    <span>{item.title}</span>
                    <strong>{item.value}</strong>
                  </div>
                  <code>{item.evidence_id}</code>
                </div>
              )) : <span className="empty-evidence">当前回答没有引用市场事实</span>}
            </div>
          </div>

          <aside className="trace-column" aria-label="Agent 执行路径">
            <h3>执行路径</h3>
            <ol>
              {answer.trace.map((step) => (
                <li key={`${step.node}-${step.duration_ms}`}>
                  <CircleDot size={14} />
                  <div>
                    <strong>{step.label}</strong>
                    <span>{step.summary}</span>
                    <code>{step.node} · {step.duration_ms.toFixed(2)} ms</code>
                  </div>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      )}
    </section>
  );
}

function intentLabel(intent: AgentAnswer["intent"]): string {
  if (intent === "market_summary") return "市场总览";
  if (intent === "market_news") return "市场新闻 RAG";
  if (intent === "stock_snapshot") return "个股行情";
  if (intent === "portfolio_allocation") return "资产配置";
  return "金融问答";
}
