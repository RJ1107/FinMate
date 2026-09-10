import { CheckCircle2, ChevronDown, Pencil, Save, ShieldCheck, UserRound } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

import { ApiError, getDailyQuota } from "../api";
import type { DailyQuotaStatus } from "../types";
import type { UserProfileData } from "../userProfile";

interface Props {
  clientId: string;
  profile: UserProfileData;
  onChange: (profile: UserProfileData) => Promise<DailyQuotaStatus>;
}

const FIELDS = [
  { key: "income", label: "年收入区间", options: ["未填写", "10 万以下", "10-30 万", "30-50 万", "50 万以上"] },
  { key: "experience", label: "投资经验", options: ["未填写", "1 年以内", "1-3 年", "3-5 年", "5 年以上"] },
  { key: "risk", label: "风险承受能力", options: ["保守", "稳健", "均衡", "积极", "进取"] },
  { key: "drawdown", label: "可承受最大回撤", options: ["5% 以内", "约 10%", "约 20%", "30% 以上"] },
  { key: "horizon", label: "投资期限", options: ["1 年以内", "1-3 年", "3-5 年", "5 年以上"] },
  { key: "goal", label: "主要目标", options: ["资产保值", "稳健增值", "长期成长", "高波动机会"] },
  { key: "liquidity", label: "资金流动性需求", options: ["较高", "适中", "较低"] },
] as const;

export function UserProfile({ clientId, profile, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => { if (!editing) setDraft(profile); }, [editing, profile]);

  useEffect(() => {
    let active = true;
    void getDailyQuota(clientId)
      .then((value) => { if (active) setQuotaRemaining(value.profile_remaining); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [clientId]);

  const change = (key: keyof UserProfileData, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (saving || quotaRemaining === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const quota = await onChange({ ...draft, updatedAt: new Date().toISOString() });
      setQuotaRemaining(quota.profile_remaining);
      setEditing(false);
      setSaved(true);
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "daily_profile_limit") setQuotaRemaining(0);
      setSaveError(reason instanceof Error ? reason.message : "用户画像保存失败");
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="user-profile" id="profile">
      <div className="profile-heading">
        <div className="profile-title">
          <span><UserRound size={19} /></span>
          <div><h2>用户画像</h2><p>让 FinMate 更了解你的投资背景与关注方向</p></div>
        </div>
        <div className="profile-heading-actions">
          {saved && <span className="profile-saved" role="status"><CheckCircle2 size={14} />已更新用户画像</span>}
          <div className="profile-local"><ShieldCheck size={14} />本机保存</div>
          <button className="profile-edit-button" type="button" disabled={quotaRemaining === 0 && !editing} aria-expanded={editing} onClick={() => { setEditing((value) => !value); setSaved(false); setSaveError(null); }}>
            {editing ? <ChevronDown size={15} /> : <Pencil size={14} />}{editing ? "收起编辑" : "修改用户画像"}
          </button>
        </div>
      </div>
      <p className="quota-note">
        每天最多修改 2 次用户画像
        {quotaRemaining != null && <> · 今日剩余 {quotaRemaining} 次</>}
      </p>
      {saveError && <p className="profile-save-error" role="alert">{saveError}</p>}

      {!editing ? (
        <div className="profile-summary" aria-label="用户画像摘要">
          <span>{profile.risk}型</span><span>{profile.horizon}</span><span>{profile.goal}</span>
          {profile.interests.slice(0, 4).map((topic) => <span key={topic}>{topic}</span>)}
          {!profile.updatedAt && <small>尚未保存完整画像</small>}
        </div>
      ) : <form className="profile-editor" onSubmit={(event) => void submit(event)}>
      <div className="profile-grid">
        {FIELDS.map((field) => (
          <fieldset key={field.key}>
            <legend>{field.label}</legend>
            <div className="profile-options">
              {field.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={draft[field.key] === option}
                  onClick={() => change(field.key, option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="profile-bottom">
        <label>
          <span>补充说明</span>
          <small>可补充资金用途、明确禁忌、偏好行业、持仓周期或你希望 FinMate 记住的背景。</small>
          <textarea
            value={draft.supplement}
            onChange={(event) => change("supplement", event.target.value)}
            placeholder="例如：更关注长期基本面，不接受高杠杆，希望优先解释风险与估值。"
            maxLength={500}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <small>按 Enter 保存，Shift + Enter 换行</small>
          <button className="profile-submit" type="submit" disabled={saving || quotaRemaining === 0}><Save size={15} />{saving ? "保存中" : "保存用户画像"}</button>
        </label>
        <aside>
          <span>近期关注</span>
          <div className="interest-list">
            {profile.interests.length
              ? profile.interests.map((topic) => <i key={topic}>{topic}</i>)
              : <small>与 HeyFinmate 对话后，明确提到的行业主题会出现在这里。</small>}
          </div>
          <p><Save size={13} />结构化信息由你主动填写；对话只更新明确出现的关注主题。</p>
        </aside>
      </div>
      </form>}
    </section>
  );
}
