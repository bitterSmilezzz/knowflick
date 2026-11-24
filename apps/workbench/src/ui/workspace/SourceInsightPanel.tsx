import { useMemo } from "react";
import { Icon } from "./Icon";
import { sourceInsights } from "../../domain/insights";
import type { RawMaterial } from "../../shell/store";
import type { KnowledgeCard } from "../../domain/card";

/**
 * 「你的来源贡献」面板：把知识库里学到的偏好讲清楚。
 *
 * 只列用户明确做过的事（转成卡片 / 收藏 / 复习 / 忽略），并给出可核对的说明；
 * 没有可展示的来源时显示「还没有足够信号」而不是空白。
 */
export function SourceInsightPanel({ materials, cards, enabled, onToggle }: {
  materials: RawMaterial[];
  cards: KnowledgeCard[];
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const insights = useMemo(() => sourceInsights({ materials, cards }), [materials, cards]);
  const shown = insights.ranked.filter(profile => profile.itemCount > 0);
  // Scores are normalised per kind, so a mail account and a single sender can
  // both read 100%. Show the kind so the two are not mistaken for equals, and
  // put senders first: they are the finer-grained, more actionable signal.
  const KIND_LABEL: Record<string, string> = {
    mailAccount: "邮箱账号", mailSender: "发件人", subscription: "订阅", host: "站点", local: "本地",
  };
  const top = [...shown]
    .sort((a, b) => (a.kind === "mailSender" ? 0 : 1) - (b.kind === "mailSender" ? 0 : 1) || b.score - a.score)
    .slice(0, 6);

  return <section className="ws-insight-panel" aria-label="来源贡献">
    <div className="ws-insight-head">
      <div>
        <h2>你的来源贡献</h2>
        <p className="ws-hint">按你实际做过的事排序：转成知识卡最重，其次是收藏与复习；忽略会降权。超过 90 天的记录不再计入。</p>
      </div>
      <label className="ws-switch-label">
        <input
          type="checkbox"
          role="switch"
          aria-label="按使用习惯个性化"
          aria-checked={enabled}
          className="ws-switch-input"
          checked={enabled}
          onChange={event => onToggle(event.target.checked)}
        />
        <span className="ws-switch-slider" />
      </label>
    </div>
    {!enabled ? (
      <p className="ws-hint" role="status">个性化已关闭：邮箱与来源列表按时间排列，不做偏好排序。</p>
    ) : top.length === 0 ? (
      <p className="ws-hint" role="status">还没有足够信号。把读到的内容转成知识卡或收藏起来，这里会显示你更常用的来源。</p>
    ) : (
      <ul className="ws-insight-list">
        {top.map(profile => <li key={profile.key} data-insight-source={profile.key}>
          <div className="ws-insight-item">
            <strong><Icon name={profile.kind === "mailSender" ? "mail" : profile.kind === "host" ? "external" : "layers"} size={13} />{profile.label}<em className="ws-insight-kind">{KIND_LABEL[profile.kind] ?? profile.kind}</em></strong>
            <span className="ws-hint">{profile.reason}</span>
            <div className="ws-insight-bar" aria-hidden="true"><i style={{ width: `${Math.round(profile.score * 100)}%` }} /></div>
          </div>
          <span className="ws-insight-score" aria-label={`权重 ${Math.round(profile.score * 100)}%`}>{Math.round(profile.score * 100)}%</span>
        </li>)}
      </ul>
    )}
  </section>;
}
