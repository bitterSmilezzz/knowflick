import type { DueTodoItem } from "../../domain/dueInbox";
import { dueTotals } from "../../domain/dueInbox";

/**
 * 到期待办汇总（B10）：把全库的「逾期 / 今天到期」摊在笔记页顶部。
 *
 * 这是**应用内**提醒，不是系统通知：打开工作台就能看见，不需要后台常驻与权限。
 * 点一条跳到那篇笔记。
 */
export function DueInbox({ items, onOpen }: {
  items: readonly DueTodoItem[];
  onOpen: (noteId: string) => void;
}): React.ReactElement | null {
  const totals = dueTotals(items);
  // 将来的不占版面：那是计划，不是今天要处理的事。
  const shown = items.filter((item) => item.state !== "upcoming").slice(0, 8);
  if (shown.length === 0) return null;
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
          </li>
        ))}
      </ul>
    </details>
  );
}
