import { useEffect, useRef, useState } from "react";
import { goalReviewSnapshot, inShell, projectList, projectMemberIndex, reviewHistoryPeriod, type Goal, type GoalEvidenceItem, type RawMaterial } from "../../shell/store";
import type { KnowledgeCard } from "../../domain/card";
import type { Note } from "../../domain/note";
import { projectFactMembership, periodLabel, periodStart, reviewFacts, reviewToMarkdown, type ReviewFacts as Facts } from "../../domain/reviewFacts";
import type { ReviewHistorySnapshot } from "../../domain/reviewHistory";
import { completionURL, requiresKey } from "../../domain/ingest";
import { defaultSettings, type AiSettings } from "../../domain/settings";
import { generateReviewSuggestions, reviewSuggestionSignature, reviewSuggestionSources, type ReviewSuggestion, type ReviewSuggestionSourceBundle } from "../../domain/reviewSuggestions";
import { indexNoteProjects, readReviewSchedule } from "../../domain/reviewReminder";
import { activeGoals, readNotes, readWorkspace } from "./repository";
import {
  isDueButQuiet,
  markReminded,
  nextReminderAt,
  shouldRemindNow,
  type ReviewReminder,
  type ReviewSchedule,
} from "../../domain/reviewReminder";
import { Icon } from "./Icon";

/** 复盘视图（R4/D03）：分开展示周期事实、目标现状、缺记录方面与 AI 建议；导出只包含事实。 */
export function ReviewFactsView({ dir, materials, cards, notes, goals, projects = [], projectIndexStatus = "ready", projectFactsStatus, projectNoteIds, projectMaterialIds, projectCardIds, schedule, settings = defaultSettings, apiKey = "", reminders, onScheduleChange, onEnableSystemNotifications, onOpenMaterial, onOpenCard, onOpenNote }: {
  dir: string;
  materials: RawMaterial[];
  cards: KnowledgeCard[];
  /** null 表示笔记仓储还没有完成读取。 */
  notes?: Note[] | null;
  goals: Goal[];
  /** 可选的项目（供范围选择用）。 */
  projects?: Array<{ id: string; name: string }>;
  projectIndexStatus?: "loading" | "ready" | "error" | "unavailable";
  /** 项目成员和笔记均已读取后，才能确认项目范围内的笔记/素材/卡片事实。 */
  projectFactsStatus?: "loading" | "ready" | "error" | "unavailable";
  projectNoteIds?: ReadonlySet<string> | null;
  projectMaterialIds?: ReadonlySet<string> | null;
  projectCardIds?: ReadonlySet<string> | null;
  settings?: AiSettings;
  apiKey?: string;
  /** 主动回顾的提醒计划（R4/D09）。 */
  schedule: ReviewSchedule;
  /** 与后台提醒共用同一份可处理事项清单。 */
  reminders: ReviewReminder[];
  onScheduleChange: (next: ReviewSchedule) => void | Promise<boolean>;
  /** 用户显式开启系统通知时才会检查或请求系统权限。 */
  onEnableSystemNotifications: () => Promise<boolean>;
  onOpenMaterial: (id: string) => void;
  onOpenCard: (id: string) => void;
  onOpenNote: (id: string) => void;
}) {
  const [kind, setKind] = useState<"day" | "week" | "month">("week");
  const [now, setNow] = useState(() => Date.now());
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState("");
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const [evidence, setEvidence] = useState<{ key: string; state: "loading" | "ready" | "error"; goals: Goal[]; items: GoalEvidenceItem[] }>({ key: "", state: "loading", goals: [], items: [] });
  const [evidenceRetry, setEvidenceRetry] = useState(0);
  const shell = inShell();
  const effectiveProjectFactsStatus = projectFactsStatus ?? (schedule.projectScope.length > 0 ? "unavailable" : "ready");
  const evidenceKey = JSON.stringify([dir, kind, now]);
  useEffect(() => {
    if (!shell) return;
    let active = true;
    setEvidence({ key: evidenceKey, state: "loading", goals: [], items: [] });
    void goalReviewSnapshot(periodStart(kind, now), now, dir).then((snapshot) => {
      if (active) setEvidence({ key: evidenceKey, state: "ready", goals: snapshot.goals, items: snapshot.evidence });
    }).catch(() => {
      if (active) setEvidence({ key: evidenceKey, state: "error", goals: [], items: [] });
    });
    return () => { active = false; };
  }, [dir, kind, now, shell, evidenceKey, goals, evidenceRetry]);
  const evidenceReady = shell && evidence.key === evidenceKey && evidence.state === "ready";
  const historyKey = JSON.stringify([dir, periodStart(kind, now), now]);
  const [history, setHistory] = useState<{ key: string; state: "loading" | "ready" | "error" | "unavailable"; snapshot: ReviewHistorySnapshot | null }>({ key: "", state: "loading", snapshot: null });
  const [historyRetry, setHistoryRetry] = useState(0);
  useEffect(() => {
    if (!shell) {
      setHistory({ key: historyKey, state: "unavailable", snapshot: null });
      return;
    }
    let active = true;
    setHistory({ key: historyKey, state: "loading", snapshot: null });
    void reviewHistoryPeriod(periodStart(kind, now), now, dir).then((snapshot) => {
      if (active) setHistory({ key: historyKey, state: "ready", snapshot });
    }).catch(() => {
      if (active) setHistory({ key: historyKey, state: "error", snapshot: null });
    });
    return () => { active = false; };
  }, [dir, kind, now, shell, historyKey, historyRetry]);
  const historyReady = history.key === historyKey && history.state === "ready";
  const facts: Facts = reviewFacts({
    materials,
    notes,
    cards,
    goals: evidenceReady ? evidence.goals : goals,
    now,
    goalEvidence: evidenceReady ? evidence.items : null,
    reviewHistory: historyReady ? history.snapshot : null,
    projectScope: schedule.projectScope,
    projectNoteIds,
    projectMaterialIds,
    projectCardIds,
  }, kind);
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
  const updateSystemNotifications = async (enabled: boolean) => {
    setNotificationMessage("");
    if (!enabled) {
      const saved = await onScheduleChange({ ...schedule, systemNotificationsEnabled: false });
      setNotificationMessage(saved === false ? "系统通知关闭设置未能保存，请稍后重试。" : "系统通知已关闭。");
      return;
    }
    setNotificationBusy(true);
    try {
      const granted = await onEnableSystemNotifications();
      if (!granted) {
        setNotificationMessage("未获得系统通知权限，设置保持关闭。可在系统设置中开启 KnowFlick 通知后重试。");
        return;
      }
      const saved = await onScheduleChange({ ...schedule, systemNotificationsEnabled: true });
      if (saved === false) {
        setNotificationMessage("系统通知权限已授权，但设置保存失败；通知保持关闭。请稍后重试。");
        return;
      }
      setNotificationMessage("系统通知已启用；系统设置仍可随时关闭通知权限。");
    } catch {
      setNotificationMessage("无法检查系统通知权限，设置保持关闭。请稍后重试。");
    } finally {
      setNotificationBusy(false);
    }
  };

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
          <div className="rv-fact" data-fact="notes"><strong>{facts.noteFactsAvailable ? facts.newNotes.length : "—"}</strong><span>新建或更新笔记</span></div>
          <div className="rv-fact" data-fact="materials"><strong>{facts.projectFactsAvailable ? facts.newMaterials.length : "—"}</strong><span>新收集素材</span></div>
          <div className="rv-fact" data-fact="cards"><strong>{facts.projectFactsAvailable ? facts.newCards.length : "—"}</strong><span>新转出知识卡</span></div>
          <div className="rv-fact" data-fact="reviews"><strong>{historyReady ? facts.reviewEvents.length : "—"}</strong><span>{schedule.projectScope.length ? "所选项目内逐次复习事件" : "逐次复习事件"}</span></div>
          <div className="rv-fact" data-fact="reviewed-cards"><strong>{facts.reviewedCardCount ?? "—"}</strong><span>{schedule.projectScope.length ? "所选项目内最近复习时间在本周期的卡" : "最近复习时间在本周期的卡"}</span></div>
        </div>
        {!facts.noteFactsAvailable && schedule.projectScope.length === 0 ? (
          <p className="ws-hint" role="status">正在读取笔记；笔记事实计数暂不显示。</p>
        ) : null}
        {schedule.projectScope.length > 0 && (!facts.projectFactsAvailable || !facts.noteFactsAvailable) ? (
          <p className="ws-hint" role="status">
            {effectiveProjectFactsStatus === "loading" ? "正在读取项目成员与笔记归属；项目事实计数暂不显示。"
              : effectiveProjectFactsStatus === "error" ? "项目归属读取失败，无法确认所选项目的笔记、素材和卡片；可重新打开复盘重试。"
                : effectiveProjectFactsStatus === "unavailable" ? "所选项目已封存、删除或不可用，项目事实计数暂不显示。"
                  : "所选项目的笔记、素材和卡片归属暂不可用，相关计数未计算。"}
          </p>
        ) : null}
        {!shell ? <p className="ws-hint">浏览器体验不保存逐次复习事件；这里显示的卡片累计状态不能代表周期次数。</p>
          : history.state === "error" && history.key === historyKey ? <p className="nv-error" role="alert">复习历史读取失败，暂不显示周期次数。 <button type="button" onClick={() => setHistoryRetry((value) => value + 1)}>重新读取</button></p>
            : !historyReady ? <p className="ws-hint" role="status">正在读取逐次复习历史。</p>
              : !facts.reviewHistoryComplete ? <p className="ws-hint">逐次事件从 {new Date(history.snapshot!.coverageStartedAt).toLocaleDateString("zh-CN")} 开始记录；本周期仅显示已记录事件，历史不完整。</p>
                : schedule.projectScope.length > 0 && !facts.projectReviewHistoryComplete ? <p className="ws-hint">有复习事件的项目归属未能确认，所选项目的次数可能偏少。</p>
                  : null}
        {facts.reviewEvents.length > 0 ? (
          <details className="rv-detail">
            <summary>逐次复习记录</summary>
            <ul>{facts.reviewEvents.map((event) => {
              const card = cards.find((item) => item.id === event.cardId);
              return <li key={event.id}>
                {card ? <button type="button" className="rv-source-link" onClick={() => onOpenCard(card.id)}>{card.headline}</button> : `已删除或不可用的卡片（${event.cardId}）`}
                {` · ${event.rating} · ${new Date(event.reviewedAt).toLocaleString("zh-CN")}`}
              </li>;
            })}</ul>
          </details>
        ) : null}
        {facts.noteFactsAvailable && facts.newNotes.length > 0 ? (
          <details className="rv-detail" open>
            <summary>本周期新建或更新的笔记</summary>
            <ul>{facts.newNotes.map((note) => (
              <li key={note.id}>
                <button type="button" className="rv-source-link" onClick={() => onOpenNote(note.id)}>{note.title || "无标题"}</button>
                {` · ${note.activity === "created" ? "新建" : "更新"} · ${new Date(note.at).toLocaleString("zh-CN")}`}
              </li>
            ))}</ul>
          </details>
        ) : null}
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

      <ReviewSuggestions
        dir={dir}
        kind={kind}
        facts={facts}
        materials={materials}
        cards={cards}
        notes={notes ?? null}
        projectScope={schedule.projectScope}
        projects={projects}
        projectIndexStatus={projectIndexStatus}
        projectFactsStatus={effectiveProjectFactsStatus}
        settings={settings}
        apiKey={apiKey}
        onOpenMaterial={onOpenMaterial}
        onOpenCard={onOpenCard}
        onOpenNote={onOpenNote}
      />

      <section className="rv-section" aria-label="目标现状">
        <h2>目标现状</h2>
        <p className="ws-hint">周期内存在的目标；证据按关联时间统计，不代表完成进度。</p>
        {!shell ? <p className="ws-hint">目标周期明细需要桌面客户端；这里只显示已取得的活跃目标。</p> : evidence.key === evidenceKey && evidence.state === "error" ? (
          <p className="nv-error" role="alert">目标周期明细读取失败；这里只显示已取得的活跃目标。 <button type="button" onClick={() => setEvidenceRetry((n) => n + 1)}>重新读取</button></p>
        ) : !evidenceReady ? <p className="ws-hint" role="status">正在读取目标周期明细；暂时只显示已取得的活跃目标。</p> : null}
        {facts.goals.length === 0 ? (
          <p className="ws-hint">{evidenceReady ? "（本周期没有目标——可在「目标」中新建）" : "（无可显示的活跃目标）"}</p>
        ) : (
          <ul className="rv-goals">
            {facts.goals.map((g) => (
              <li key={g.id}>
                {g.title} — 关联证据 {g.evidenceCount} 条{g.achieved ? "（已达成）" : g.abandoned ? "（已放弃）" : ""}
                {g.periodEvidence !== null ? g.periodEvidence.length === 0 ? (
                  <p className="ws-hint">本周期没有新增关联证据。</p>
                ) : (
                  <ul>{g.periodEvidence.map((e) => <li key={`${e.kind}:${e.evidenceId}`}>
                    {e.kind === "note" ? "笔记" : "素材"}：{e.title === null ? "原件已删除或不可用" : (
                      <button type="button" className="rv-source-link" onClick={() => e.kind === "note" ? onOpenNote(e.evidenceId) : onOpenMaterial(e.evidenceId)}>{e.title || "无标题"}</button>
                    )} · 关联于 {new Date(e.linkedAt).toLocaleString("zh-CN")}
                  </li>)}</ul>
                ) : null}
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
          <p className="ws-hint">到期时这里会出现页内回顾入口；桌面系统通知需要在下方单独开启。</p>
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
        <div className="rv-notification-controls">
          <label className="rv-reminder-pause">
            <input
              type="checkbox"
              aria-label="启用系统通知"
              checked={schedule.systemNotificationsEnabled}
              disabled={!shell || notificationBusy}
              onChange={(e) => void updateSystemNotifications(e.target.checked)}
            />
            系统通知
          </label>
          <span className="ws-hint">
            {shell
              ? "桌面客户端在后台运行时，有可处理事项才会按所选频率通知；完全退出应用时不会发送。"
              : "系统通知仅在桌面客户端可用；浏览器会显示页内回顾状态。"}
          </span>
          {notificationMessage ? <p className="ws-hint" role="status">{notificationMessage}</p> : null}
        </div>

        {/* 项目范围：只列范围内的项目事项；不选 = 全部。 */}
        {projects.length > 0 || schedule.projectScope.length > 0 ? (
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
              {schedule.projectScope.filter((id) => !projects.some((p) => p.id === id)).map((id) => (
                <label key={id}>
                  <input type="checkbox" aria-label={`移除不可用项目 ${id}`} checked
                    onChange={() => onScheduleChange({ ...schedule, projectScope: schedule.projectScope.filter((item) => item !== id) })} />
                  不可用项目（{id}）
                </label>
              ))}
            </div>
            <p className="ws-hint">
              限定项目后，只列属于这些项目的事项；收件箱堆积这类全局事项不会出现在范围内。
            </p>
            {schedule.projectScope.some((id) => !projects.some((p) => p.id === id)) ? (
              <p className="ws-hint">已选项目可能已封存、删除或暂时无法读取；范围会保留，直到你更改选择。</p>
            ) : null}
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
        {projectIndexStatus !== "ready" ? (
          <p className="ws-hint" role="status">{projectIndexStatus === "loading" ? "正在读取项目归属；项目提醒可能暂不完整。" : projectIndexStatus === "unavailable" ? "项目归属需要桌面客户端，项目提醒可能不完整。" : "项目归属读取失败，项目提醒可能不完整；可重新打开复盘重试。"}</p>
        ) : null}
        {reminders.length === 0 ? (
          <p className="ws-hint">{projectIndexStatus === "ready" ? "没有需要你动手的事——没有记录不是失败，所以这里不会提醒你。" : "当前没有可显示的事项。"}</p>
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

interface ReviewSuggestionSnapshot {
  baseSignature: string;
  facts: Facts;
  materials: RawMaterial[];
  cards: KnowledgeCard[];
  notes: Note[] | null;
  bundle: ReviewSuggestionSourceBundle;
  scopeIds: string[];
  scopeLabel: string;
  signature: string;
}

interface SuggestionConsent {
  signature: string;
  providerId: string;
  baseURL: string;
  model: string;
  enableAI: boolean;
  apiKey: string;
}

function sameScope(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join("\u0000") === [...right].sort().join("\u0000");
}

function modelConfigMatches(consent: SuggestionConsent, settings: AiSettings, apiKey: string): boolean {
  return consent.providerId === settings.providerId && consent.baseURL === settings.baseURL &&
    consent.model === settings.model && consent.enableAI === settings.enableAI && consent.apiKey === apiKey;
}

function projectScopeLabel(scopeIds: readonly string[], projects: ReadonlyArray<{ id: string; name: string }>): string {
  if (scopeIds.length === 0) return "不限项目（全部）";
  const names = new Map(projects.map((project) => [project.id, project.name]));
  return scopeIds.map((id) => names.get(id) ?? `不可用项目（${id}）`).join("、");
}

function modelEndpointStatus(baseURL: string): { valid: boolean; requiresKey: boolean } {
  try {
    completionURL(baseURL);
    return { valid: true, requiresKey: requiresKey(baseURL) };
  } catch {
    return { valid: false, requiresKey: false };
  }
}

function ReviewSuggestions({ dir, kind, facts, materials, cards, notes, projectScope, projects, projectIndexStatus, projectFactsStatus, settings, apiKey, onOpenMaterial, onOpenCard, onOpenNote }: {
  dir: string;
  kind: "day" | "week" | "month";
  facts: Facts;
  materials: RawMaterial[];
  cards: KnowledgeCard[];
  notes: Note[] | null;
  projectScope: string[];
  projects: Array<{ id: string; name: string }>;
  projectIndexStatus: "loading" | "ready" | "error" | "unavailable";
  projectFactsStatus: "loading" | "ready" | "error" | "unavailable";
  settings: AiSettings;
  apiKey: string;
  onOpenMaterial: (id: string) => void;
  onOpenCard: (id: string) => void;
  onOpenNote: (id: string) => void;
}) {
  const shell = inShell();
  const baseBundle = reviewSuggestionSources(facts, materials, cards, notes ?? []);
  const baseScopeLabel = projectScopeLabel(projectScope, projects);
  const baseSignature = JSON.stringify([
    reviewSuggestionSignature(facts, projectScope, baseBundle),
    baseScopeLabel,
  ]);
  const [refreshed, setRefreshed] = useState<ReviewSuggestionSnapshot | null>(null);
  const snapshot = refreshed?.baseSignature === baseSignature ? refreshed : {
    baseSignature,
    facts,
    materials,
    cards,
    notes,
    bundle: baseBundle,
    scopeIds: projectScope,
    scopeLabel: baseScopeLabel,
    signature: baseSignature,
  };
  const [consent, setConsent] = useState<SuggestionConsent | null>(null);
  const [result, setResult] = useState<{ signature: string; config: SuggestionConsent; suggestions: ReviewSuggestion[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "status" | "error"; text: string } | null>(null);
  const contextRevision = useRef(0);
  const consentMatches = consent?.signature === snapshot.signature && modelConfigMatches(consent, settings, apiKey);
  const resultMatches = result?.signature === snapshot.signature && modelConfigMatches(result.config, settings, apiKey);
  const endpointStatus = modelEndpointStatus(settings.baseURL);
  const modelReady = settings.enableAI && endpointStatus.valid && settings.model.trim().length > 0 && (!endpointStatus.requiresKey || apiKey.trim().length > 0);
  const projectScopeReady = snapshot.scopeIds.length === 0 ||
    (shell && projectIndexStatus === "ready" && projectFactsStatus === "ready");
  const canRequest = modelReady && projectScopeReady && snapshot.bundle.sources.length > 0;

  useEffect(() => {
    contextRevision.current++;
    setConsent(null);
    setResult(null);
    if (refreshed?.baseSignature !== baseSignature) setMessage(null);
  }, [snapshot.signature, baseSignature, settings.providerId, settings.baseURL, settings.model, settings.enableAI, apiKey, refreshed?.baseSignature]);

  const saveFreshPreview = (freshFacts: Facts, freshMaterials: RawMaterial[], freshCards: KnowledgeCard[], freshNotes: Note[], freshProjects: Array<{ id: string; name: string }>, scopeIds: string[], staleSignature: string) => {
    const bundle = reviewSuggestionSources(freshFacts, freshMaterials, freshCards, freshNotes);
    const scopeLabel = projectScopeLabel(scopeIds, freshProjects);
    const signature = JSON.stringify([reviewSuggestionSignature(freshFacts, scopeIds, bundle), scopeLabel]);
    setRefreshed({
      baseSignature: staleSignature,
      facts: freshFacts,
      materials: freshMaterials,
      cards: freshCards,
      notes: freshNotes,
      bundle,
      scopeIds,
      scopeLabel,
      signature,
    });
    setConsent(null);
    setResult(null);
    setMessage({ kind: "status", text: "发送前发现复盘记录或归属已变化，已刷新下方预览；请重新核对并勾选同意后再生成。" });
  };

  const generate = async () => {
    if (!consentMatches || !canRequest || busy) return;
    const requestRevision = contextRevision.current;
    setBusy(true);
    setMessage({ kind: "status", text: "正在重新读取当前记录与项目归属……" });
    try {
      const fresh = await readWorkspace();
      if (fresh.dir !== dir) throw new Error("当前知识库已切换，请重新打开复盘并核对范围");
      if (!modelConfigMatches(consent!, fresh.file.settings, fresh.apiKey)) {
        throw new Error("AI 模型设置或密钥已变化，本次没有发送。请检查设置后重新确认。");
      }
      const freshScope = readReviewSchedule(fresh.file.raw).projectScope;
      if (!sameScope(freshScope, snapshot.scopeIds)) {
        throw new Error("复盘项目范围在确认后已变化，本次没有发送。请重新打开复盘并核对范围。");
      }
      const freshNotesState = await readNotes(fresh.dir);
      let freshProjects: Array<{ id: string; name: string }> = [];
      let projectNoteIds: ReadonlySet<string> | null = null;
      let projectMaterialIds: ReadonlySet<string> | null = null;
      let projectCardIds: ReadonlySet<string> | null = null;
      if (snapshot.scopeIds.length > 0) {
        if (!shell) throw new Error("浏览器暂不支持项目复盘范围，已停止发送");
        const [listedProjects, memberPairs] = await Promise.all([projectList(false, fresh.dir), projectMemberIndex(fresh.dir)]);
        freshProjects = listedProjects;
        if (!snapshot.scopeIds.every((id) => listedProjects.some((project) => project.id === id))) {
          throw new Error("所选项目已封存、删除或不可用，本次没有发送");
        }
        const membership = projectFactMembership(snapshot.scopeIds, freshNotesState.notes, fresh.cards, indexNoteProjects(memberPairs));
        projectNoteIds = membership.noteIds;
        projectMaterialIds = membership.materialIds;
        projectCardIds = membership.cardIds;
      } else {
        freshProjects = projects;
      }

      const cutoff = snapshot.facts.period.to;
      const from = periodStart(kind, cutoff);
      let goalSnapshot: { goals: Goal[]; evidence: GoalEvidenceItem[] } | null = null;
      let historySnapshot: ReviewHistorySnapshot | null = null;
      let freshGoals: Goal[] = [];
      if (shell) {
        [goalSnapshot, historySnapshot] = await Promise.all([
          goalReviewSnapshot(from, cutoff, fresh.dir),
          reviewHistoryPeriod(from, cutoff, fresh.dir),
        ]);
      } else {
        freshGoals = await activeGoals(fresh.dir);
      }
      const freshFacts = reviewFacts({
        materials: fresh.materials,
        notes: freshNotesState.notes,
        cards: fresh.cards,
        goals: goalSnapshot?.goals ?? freshGoals,
        goalEvidence: goalSnapshot?.evidence ?? null,
        reviewHistory: historySnapshot,
        projectScope: snapshot.scopeIds,
        projectNoteIds,
        projectMaterialIds,
        projectCardIds,
        now: cutoff,
      }, kind);

      if (requestRevision !== contextRevision.current) throw new Error("复盘周期、范围或模型设置已变化，本次没有发送");
      const freshBundle = reviewSuggestionSources(freshFacts, fresh.materials, fresh.cards, freshNotesState.notes);
      const freshLabel = projectScopeLabel(snapshot.scopeIds, freshProjects.length ? freshProjects : projects);
      const freshSignature = JSON.stringify([reviewSuggestionSignature(freshFacts, snapshot.scopeIds, freshBundle), freshLabel]);
      if (freshSignature !== snapshot.signature) {
        saveFreshPreview(freshFacts, fresh.materials, fresh.cards, freshNotesState.notes, freshProjects.length ? freshProjects : projects, snapshot.scopeIds, baseSignature);
        return;
      }

      setMessage({ kind: "status", text: `已确认 ${freshBundle.sources.length} 条来源，正在请求 ${fresh.file.settings.model}……` });
      const suggestions = await generateReviewSuggestions(freshFacts, freshLabel, freshBundle, fresh.file.settings, fresh.apiKey);
      if (requestRevision !== contextRevision.current) throw new Error("复盘上下文在模型生成期间发生变化，结果已丢弃");
      setResult({ signature: snapshot.signature, config: consent!, suggestions });
      setMessage({ kind: "status", text: suggestions.length ? "建议已生成；仅保存在当前页面，没有写入目标或笔记。" : "模型没有找到证据充分的建议；没有内容被写入。" });
    } catch (error) {
      setMessage({ kind: "error", text: `生成建议失败：${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const sourceLabel = (sourceId: string) => {
    const source = snapshot.bundle.sources.find((item) => item.id === sourceId);
    if (!source) return sourceId;
    const label = `${source.title} · ${new Date(source.at).toLocaleString("zh-CN")}`;
    if (source.kind === "note") return <button type="button" className="rv-source-link" onClick={() => onOpenNote(source.targetId)}>{label}</button>;
    if (source.kind === "material") return <button type="button" className="rv-source-link" onClick={() => onOpenMaterial(source.targetId)}>{label}</button>;
    if (source.kind === "card" || source.kind === "review") return <button type="button" className="rv-source-link" onClick={() => onOpenCard(source.targetId)}>{label}</button>;
    return <span>{label}</span>;
  };

  return (
    <section className="rv-section rv-ai-suggestions" aria-label="AI 建议" aria-busy={busy}>
      <h2>AI 建议</h2>
      <p className="ws-hint">建议与上方记录事实分开显示，必须有本周期来源支持；不会自动修改或保存目标、笔记、画像。</p>
      <p className="ws-hint">周期：{snapshot.facts.period.label}（截至 {new Date(snapshot.facts.period.to).toLocaleString("zh-CN")}） · 范围：{snapshot.scopeLabel} · 模型：{settings.model.trim() || "未配置"}</p>
      {snapshot.bundle.sources.length === 0 ? (
        <p className="ws-hint">当前没有可引用的已读取记录，因此不会调用模型。</p>
      ) : (
        <>
          <p className="ws-hint">请求预览：{snapshot.bundle.sources.length} 条来源{snapshot.bundle.omittedCount ? `，另有 ${snapshot.bundle.omittedCount} 条较早来源未发送` : ""}。还会发送周期计数、资料可用状态、目标现状和缺记录清单；不可用不代表数量为零。</p>
          <details className="rv-ai-preview">
            <summary>查看会发送给模型的来源标题与摘要</summary>
            <ul>{snapshot.bundle.sources.map((source) => (
              <li key={source.id}>
                <span>{source.kind === "review" ? "复习事件" : source.kind === "goal" ? "目标" : source.kind === "note" ? "笔记" : source.kind === "material" ? "素材" : "知识卡"}：{sourceLabel(source.id)}</span>
                <p>{source.excerpt || "（无正文摘录）"}</p>
              </li>
            ))}</ul>
          </details>
          <label className="rv-ai-consent">
            <input
              type="checkbox"
              checked={!!consentMatches}
              disabled={!modelReady || !projectScopeReady || busy}
              onChange={(event) => {
                if (event.target.checked) {
                  setConsent({ signature: snapshot.signature, providerId: settings.providerId, baseURL: settings.baseURL, model: settings.model, enableAI: settings.enableAI, apiKey });
                } else {
                  setConsent(null);
                  setResult(null);
                }
              }}
            />
            <span>我同意将上方预览的来源标题、摘要、时间，以及本周期计数、资料可用情况、目标状态和缺记录清单发送给当前配置的模型“{settings.model || "未配置"}”。API 密钥只用于连接服务。本次结果仅在页面显示；关闭页面即丢弃，不会保存或修改知识库。</span>
          </label>
          {!settings.enableAI ? <p className="ws-hint">AI 功能未开启，请先到设置开启。</p>
            : !settings.model.trim() ? <p className="ws-hint">请先在设置中配置模型名称。</p>
              : !endpointStatus.valid ? <p className="ws-hint">请先在设置中配置有效的 AI API 地址。</p>
                : endpointStatus.requiresKey && !apiKey.trim() ? <p className="ws-hint">当前服务需要 API 密钥，请先到设置配置。</p>
                  : !projectScopeReady ? <p className="ws-hint">所选项目资料尚未完整读取，暂不能请求 AI 建议。</p> : null}
          <button type="button" className="ws-bordered" disabled={!consentMatches || !canRequest || busy} onClick={() => void generate()}>
            {busy ? "正在生成…" : "生成建议"}
          </button>
        </>
      )}
      {message ? <p className={message.kind === "error" ? "nv-error" : "ws-hint"} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p> : null}
      {resultMatches && result!.suggestions.length > 0 ? (
        <ul className="rv-ai-results">{result!.suggestions.map((suggestion, index) => (
          <li key={`${suggestion.text}:${index}`}>
            <p>{suggestion.text}</p>
            <div>依据：{suggestion.evidenceIds.map((id, sourceIndex) => <span key={id}>{sourceIndex > 0 ? "；" : ""}{sourceLabel(id)}</span>)}</div>
          </li>
        ))}</ul>
      ) : null}
    </section>
  );
}
