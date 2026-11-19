import type { DueTodoItem } from "../../domain/dueInbox";
import { dueTotals } from "../../domain/dueInbox";

/**
 * 到期待办汇总（B10）：把全库的「逾期 / 今天到期」摊在笔记页顶部。
 *
 * 这是**应用内**提醒，不是系统通知：打开工作台就能看见，不需要后台常驻与权限。
 *
 * 每条给了三个就地动作：完成、推迟三天、改到指定日期。看到「逾期 5 件」时用户的第一念头
 * 通常就是这几个；让他点开那篇、翻到那一行、手动改——那才是真正的摩擦。
 */
export function DueInbox({ items, ignored = [], onOpen, onDone, onSnooze, onReschedule, onIgnore, onUnignore }: {
  items: readonly DueTodoItem[];
  onOpen: (noteId: string) => void;
  /** 完成这一条；不传就只有查看。 */
  onDone?: (item: DueTodoItem) => void;
  /** 推迟三天；不传就只有查看。 */
  onSnooze?: (item: DueTodoItem) => void;
  /** 改到指定日期（ISO `YYYY-MM-DD`）；不传就没有日期输入。 */
  onReschedule?: (item: DueTodoItem, date: string) => void;
  /** 已被忽略的那些（折叠区里列出来，可撤销）。 */
  ignored?: readonly DueTodoItem[];
  /** 忽略这一条：不改正文，只是不再在这里提醒。 */
  onIgnore?: (item: DueTodoItem) => void;
  /** 撤销忽略；不传就没有撤销入口。 */
  onUnignore?: (item: DueTodoItem) => void;
}): React.ReactElement | null {
  const totals = dueTotals(items);
  // 将来的不占版面：那是计划，不是今天要处理的事。
  const shown = items.filter((item) => item.state !== "upcoming").slice(0, 8);
  // 全部被忽略时**不留空壳**：标题写着「逾期 3 件」却一条都列不出来，比不显示更糟。
  if (shown.length === 0 && ignored.length === 0) return null;
  const parts = [
    totals.overdue > 0 ? `逾期 ${totals.overdue} 件` : "",
    totals.today > 0 ? `今天到期 ${totals.today} 件` : "",
  ].filter(Boolean);
  return (
    <details className="nv-due-inbox" aria-label="到期待办">
      <summary>{`待办到期：${parts.join(" · ")}`}</summary>
      <ul className="nv-due-inbox-list">
        {shown.map((item) => (
          <li key={`${item.noteId}-${item.line}`} className={`nv-due-item nv-due-${item.state}`}>
            <button
              type="button"
              className="nv-due-open"
              aria-label={`打开 ${item.noteTitle}`}
              onClick={() => onOpen(item.noteId)}
            >
              {item.state === "overdue" ? "逾期" : "今天"}
            </button>
            {` · ${item.text} · 《${item.noteTitle}》 · ${item.due}`}
            {onDone ? (
              <button
                type="button"
                className="nv-due-action"
                aria-label={`完成 ${item.text}`}
                onClick={() => onDone(item)}
              >
                完成
              </button>
            ) : null}
            {onIgnore ? (
              <button
                type="button"
                className="nv-due-action"
                aria-label={`忽略 ${item.text}`}
                title="不再在这里提醒；截止日期不动，正文也不改"
                onClick={() => onIgnore(item)}
              >
                忽略
              </button>
            ) : null}
            {onSnooze ? (
              <button
                type="button"
                className="nv-due-action"
                aria-label={`推迟 ${item.text}`}
                title="往后推三天（从原截止日与今天里较晚的那个起算）"
                onClick={() => onSnooze(item)}
              >
                推迟三天
              </button>
            ) : null}
            {onReschedule ? (
              // 日期输入用原生 type="date"：系统日历、键盘输入、无障碍都现成，
              // 自己造一个三段输入框只会做出更难用的东西。
              <input
                type="date"
                className="nv-due-date"
                aria-label={`改 ${item.text} 的截止日期`}
                title="改到指定日期（直接写进正文那一行）"
                value={item.due}
                onChange={(e) => { if (e.target.value) onReschedule(item, e.target.value); }}
              />
            ) : null}
          </li>
        ))}
      </ul>
      {ignored.length > 0 ? (
        <details className="nv-due-ignored" aria-label="已忽略的到期提醒">
          <summary>{`已忽略 ${ignored.length} 条`}</summary>
          <ul className="nv-due-inbox-list">
            {ignored.slice(0, 8).map((item) => (
              <li key={`ignored-${item.noteId}-${item.due}-${item.text}`} className="nv-due-item">
                {`${item.text} · 《${item.noteTitle}》 · ${item.due}`}
                {onUnignore ? (
                  <button
                    type="button"
                    className="nv-due-action"
                    aria-label={`恢复提醒 ${item.text}`}
                    onClick={() => onUnignore(item)}
                  >
                    恢复提醒
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="ws-hint">忽略只影响这里的提醒，截止日期与正文都没改。</p>
        </details>
      ) : null}
    </details>
  );
}
