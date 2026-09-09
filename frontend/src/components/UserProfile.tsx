import { Save, ShieldCheck, UserRound } from "lucide-react";

import type { UserProfileData } from "../userProfile";

interface Props {
  profile: UserProfileData;
  onChange: (profile: UserProfileData) => void;
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

export function UserProfile({ profile, onChange }: Props) {
  const change = (key: keyof UserProfileData, value: string) => {
    onChange({ ...profile, [key]: value, updatedAt: new Date().toISOString() });
  };
  return (
    <section className="user-profile" id="profile">
      <div className="profile-heading">
        <div className="profile-title">
          <span><UserRound size={19} /></span>
          <div><h2>用户画像</h2><p>让 FinMate 更了解你的投资背景与关注方向</p></div>
        </div>
        <div className="profile-local"><ShieldCheck size={14} />仅保存在当前浏览器</div>
      </div>

      <div className="profile-grid">
        {FIELDS.map((field) => (
          <fieldset key={field.key}>
            <legend>{field.label}</legend>
            <div className="profile-options">
              {field.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={profile[field.key] === option}
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
            value={profile.supplement}
            onChange={(event) => change("supplement", event.target.value)}
            placeholder="例如：更关注长期基本面，不接受高杠杆，希望优先解释风险与估值。"
            maxLength={500}
          />
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
    </section>
  );
}
