import { useState } from "react";
import type { Goal, RawMaterial } from "../../shell/store";
import type { KnowledgeCard } from "../../domain/card";
import { periodLabel, reviewFacts, reviewToMarkdown, type ReviewFacts as Facts } from "../../domain/reviewFacts";
import { Icon } from "./Icon";

/** 复盘视图（R4/D03）：渲染 reviewFacts 的**事实**——记录了什么、目标现状、
 *  没有记录的方面。不产建议（事实与建议分离是路线图口径）；导出走 Markdown。 */
export function ReviewFactsView({ materials, cards, goals }: {
  materials: RawMaterial[];
  cards: KnowledgeCard[];
  goals: Goal[];
}) {
  const [kind, setKind] = useState<"day" | "week" | "month">("week");
  const [now, setNow] = useState(() => Date.now());
  const facts: Facts = reviewFacts({ materials, cards, goals, now }, kind);

  const download = () => {
    const md = reviewToMarkdown(facts);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `knowflick-review-${kind}-${new Date(facts.period.to).toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rv-root" aria-label="复盘">
      <div className="rv-head">
        <h1>复盘 · {periodLabel(kind, now)}</h1>
        <div className="rv-kind" role="group" aria-label="复盘周期">
          {(["day", "week", "month"] as const).map((k) => (
            <button
              key={k}
              aria-pressed={kind === k}
              onClick={() => { setKind(k); setNow(Date.now()); }}
            >
              {k === "day" ? "今日" : k === "week" ? "本周" : "本月"}
            </button>
          ))}
        </div>
        <button className="ws-bordered" type="button" onClick={download} aria-label="导出复盘 Markdown">
          <Icon name="download" size={14} /> 导出复盘
        </button>
      </div>

      <p className="ws-hint" style={{ margin: 0 }}>
        这里只列记录事实与如实缺席，不做评价——「没有记录」不是失败。
      </p>

      <section className="rv-section" aria-label="记录事实">
        <h2>记录事实</h2>
        <div className="rv-facts-grid">
          <div className="rv-fact" data-fact="materials"><strong>{facts.newMaterials.length}</strong><span>新收集素材</span></div>
          <div className="rv-fact" data-fact="cards"><strong>{facts.newCards.length}</strong><span>新转出知识卡</span></div>
          <div className="rv-fact" data-fact="reviews"><strong>{facts.reviewedCardCount}</strong><span>复习过的卡</span></div>
          <div className="rv-fact" data-fact="actions"><strong>{facts.reviewActions}</strong><span>复习动作</span></div>
        </div>
        {facts.newMaterials.length > 0 ? (
          <details className="rv-detail" open>
            <summary>新收集素材</summary>
            <ul>{facts.newMaterials.map((m) => <li key={m.id}>{m.title}</li>)}</ul>
          </details>
        ) : null}
        {facts.newCards.length > 0 ? (
          <details className="rv-detail">
            <summary>新转出知识卡</summary>
            <ul>{facts.newCards.map((c) => <li key={c.id}>{c.headline}</li>)}</ul>
          </details>
        ) : null}
      </section>

      <section className="rv-section" aria-label="目标现状">
        <h2>目标现状</h2>
        {facts.goals.length === 0 ? (
          <p className="ws-hint">（无目标——在笔记或素材详情里可以创建）</p>
        ) : (
          <ul className="rv-goals">
            {facts.goals.map((g) => (
              <li key={g.id}>
                {g.title} — 关联证据 {g.evidenceCount} 条{g.achieved ? "（已达成）" : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rv-section" aria-label="没有记录的方面">
        <h2>没有记录的方面</h2>
        {facts.gaps.length === 0 ? (
          <p className="ws-hint">本周期各方面都有记录。</p>
        ) : (
          <ul className="rv-gaps">{facts.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
        )}
        <p className="ws-hint">没有记录只是没有记录——不是失败，也不据此评价。</p>
      </section>
    </div>
  );
}
