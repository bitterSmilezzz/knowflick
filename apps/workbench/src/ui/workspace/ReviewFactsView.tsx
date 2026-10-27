import { useEffect, useMemo, useState } from "react";
import type { Goal, RawMaterial } from "../../shell/store";
import type { KnowledgeCard } from "../../domain/card";
import { periodLabel, reviewFacts, reviewToMarkdown, type ReviewFacts as Facts } from "../../domain/reviewFacts";
import {
  isDueButQuiet,
  markReminded,
  nextReminderAt,
  reviewReminders,
  shouldRemindNow,
  type ReviewSchedule,
} from "../../domain/reviewReminder";
import { Icon } from "./Icon";

/** 复盘视图（R4/D03）：渲染 reviewFacts 的**事实**——记录了什么、目标现状、
 *  没有记录的方面。不产建议（事实与建议分离是路线图口径）；导出走 Markdown。 */
export function ReviewFactsView({ materials, cards, goals, notes = [], filedNoteIds, noteProject, projects = [], schedule, onScheduleChange, staleReferences = [], onOpenMaterial, onOpenCard }: {
  materials: RawMaterial[];
  cards: KnowledgeCard[];
  goals: Goal[];
  notes?: Array<{ id: string; title: string; bodyMd: string; notebook: string | null; isDeleted: boolean }>;
  filedNoteIds?: ReadonlySet<string>;
  /** 笔记 → 项目归属；限定项目范围时据此判断提醒属于哪个项目。 */
  noteProject?: ReadonlyMap<string, string>;
  /** 可选的项目（供范围选择用）。 */
  projects?: Array<{ id: string; name: string }>;
  /** 主动回顾的提醒计划（R4/D09）。 */
  schedule: ReviewSchedule;
  onScheduleChange: (next: ReviewSchedule) => void;
  /** 过期/失效的引用（由 noteReference 判定）。 */
  staleReferences?: Array<{ noteId: string; title: string; status: "changed" | "missing" }>;
  onOpenMaterial: (id: string) => void;
  onOpenCard: (id: string) => void;
}) {
  const [kind, setKind] = useState<"day" | "week" | "month">("week");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const facts: Facts = reviewFacts({ materials, cards, goals, now }, kind);
  const due = shouldRemindNow(schedule, now);
  /** 已到期但正处在安静时段——不是「没生效」，是「这个时刻不方便出声」。 */
  const dueButQuiet = isDueButQuiet(schedule, now);
  /**
   * 回顾完成 → 写回上次提醒时间。
   *
   * 不写回的话 `isDue` 永远成立，「到点了」这句话就变成每次进页面都说的噪音。
   * 点一下才推进是刻意的：只有用户真的回顾过，这轮才算数。
   */
  const acknowledge = () => onScheduleChange(markReminded(schedule, Date.now()));
  const reminders = useMemo(
    () =>
      reviewReminders({
        goals,
        notes,
        filedNoteIds,
        materials,
        staleReferences,
        projectScope: schedule.projectScope,
        noteProject,
      }),
    [goals, notes, filedNoteIds, materials, staleReferences, schedule.projectScope, noteProject]
  );

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
          <div className="rv-fact" data-fact="reviews"><strong>{facts.reviewedCardCount}</strong><span>最近一次复习在本周期的卡</span></div>
        </div>
        <p className="ws-hint">未记录逐次复习历史，无法统计本周期的复习次数。</p>
        {facts.newMaterials.length > 0 ? (
          <details className="rv-detail" open>
            <summary>新收集素材</summary>
            <ul>{facts.newMaterials.map((m) => <li key={m.id}><button type="button" className="rv-source-link" onClick={() => onOpenMaterial(m.id)}>{m.title}</button></li>)}</ul>
          </details>
        ) : null}
        {facts.newCards.length > 0 ? (
          <details className="rv-detail">
            <summary>新转出知识卡</summary>
            <ul>{facts.newCards.map((c) => <li key={c.id}><button type="button" className="rv-source-link" onClick={() => onOpenCard(c.id)}>{c.headline}</button></li>)}</ul>
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

      {/* 主动回顾（R4/D09）：频率、安静时段、暂停与退订；只提醒可处理的事。 */}
      <section className="rv-section" aria-label="主动回顾">
        <h2>主动回顾</h2>
        {due ? (
          <div className="rv-due" role="status" data-due>
            <span>到回顾的时间了。</span>
            <button type="button" className="ws-bordered" onClick={acknowledge} aria-label="我现在回顾">
              我现在回顾
            </button>
            <span className="ws-hint">点一下就算这次回顾完成，下一轮按频率重新计时。</span>
          </div>
        ) : dueButQuiet ? (
          <div className="rv-due rv-due-quiet" role="status" data-due-quiet>
            <span>已到回顾时间，但现在在安静时段里，先不打扰你。</span>
            <span className="ws-hint">
              下次开口约在 {nextReminderAt(schedule, now) ? new Date(nextReminderAt(schedule, now)!).toLocaleString("zh-CN") : "—"}。
            </span>
          </div>
        ) : (
          <p className="ws-hint">到期时这里会出现回顾入口——不会自己弹窗打断你。</p>
        )}
        <div className="rv-reminder-controls">
          <label>
            频率
            <select
              aria-label="回顾频率"
              value={schedule.frequency}
              onChange={(e) =>
                onScheduleChange({ ...schedule, frequency: e.target.value as ReviewSchedule["frequency"] })
              }
            >
              <option value="off">关闭（退订）</option>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
            </select>
          </label>
          <label className="rv-reminder-pause">
            <input
              type="checkbox"
              aria-label="暂停主动回顾"
              checked={schedule.paused}
              onChange={(e) => onScheduleChange({ ...schedule, paused: e.target.checked })}
            />
            暂停
          </label>
          <label>
            安静时段
            <select
              aria-label="安静时段开始"
              value={schedule.quietHours ? schedule.quietHours.start : -1}
              onChange={(e) => {
                const start = Number(e.target.value);
                if (start < 0) { onScheduleChange({ ...schedule, quietHours: null }); return; }
                onScheduleChange({ ...schedule, quietHours: { start, end: schedule.quietHours?.end ?? 8 } });
              }}
            >
              <option value={-1}>不设</option>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}:00 起</option>
              ))}
            </select>
            <select
              aria-label="安静时段结束"
              value={schedule.quietHours ? schedule.quietHours.end : -1}
              disabled={!schedule.quietHours}
              onChange={(e) => {
                const end = Number(e.target.value);
                if (end < 0 || !schedule.quietHours) return;
                onScheduleChange({ ...schedule, quietHours: { start: schedule.quietHours.start, end } });
              }}
            >
              <option value={-1}>不设</option>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}:00 止</option>
              ))}
            </select>
          </label>
        </div>

        {/* 项目范围：只列范围内的项目事项；不选 = 全部。 */}
        {projects.length > 0 ? (
          <div className="rv-project-scope">
            <span className="rv-project-scope-label">项目范围</span>
            <div className="rv-project-scope-list" role="group" aria-label="回顾项目范围">
              <label>
                <input
                  type="checkbox"
                  aria-label="不限项目（全部）"
                  checked={schedule.projectScope.length === 0}
                  onChange={(e) => {
                    if (e.target.checked) onScheduleChange({ ...schedule, projectScope: [] });
                  }}
                />
                不限（全部）
              </label>
              {projects.map((p) => {
                const checked = schedule.projectScope.includes(p.id);
                return (
                  <label key={p.id}>
                    <input
                      type="checkbox"
                      aria-label={`限定到项目「${p.name}」`}
                      checked={checked}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...schedule.projectScope, p.id]
                          : schedule.projectScope.filter((id) => id !== p.id);
                        // 取消最后一个 = 回到「不限」，避免出现「选了但没项目」的空范围。
                        onScheduleChange({ ...schedule, projectScope: next.length === 0 ? [] : next });
                      }}
                    />
                    {p.name}
                  </label>
                );
              })}
            </div>
            <p className="ws-hint">
              限定项目后，只列属于这些项目的事项；收件箱堆积这类全局事项不会出现在范围内。
            </p>
          </div>
        ) : null}

        <p className="ws-hint" role="status">
          {schedule.frequency === "off"
            ? "已退订——不会主动提醒你。"
            : schedule.paused
              ? "已暂停——不会主动提醒你。"
              : due
                ? "到回顾的时间了——回顾完成后点「我现在回顾」推进下一轮。"
                : dueButQuiet
                  ? "已到回顾时间，但在安静时段里——等安静时段结束再提醒你。"
                  : `安静时段或未到周期——下次约在 ${nextReminderAt(schedule, now) ? new Date(nextReminderAt(schedule, now)!).toLocaleString("zh-CN") : "—"}。`}
        </p>

        <h3>可处理事项（{reminders.length}）</h3>
        {reminders.length === 0 ? (
          <p className="ws-hint">没有需要你动手的事——没有记录不是失败，所以这里不会提醒你。</p>
        ) : (
          <ul className="rv-reminders" data-reminders>
            {reminders.map((r, i) => (
              <li key={`${r.kind}-${r.targetId ?? i}`}>
                <strong>{r.title}</strong>
                <span>{r.action}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="ws-hint">
          上次回顾：{schedule.lastRemindedAt > 0
            ? new Date(schedule.lastRemindedAt).toLocaleString("zh-CN")
            : "还没回顾过"}
        </p>
      </section>
    </div>
  );
}
