import type { VerifyInboxItem } from "../../domain/verifyInbox";
import { verifyTotals } from "../../domain/verifyInbox";

/**
 * 待验证清单（C05）：把全库标了 `❓` 的断言摊在笔记页顶部。
 *
 * 为什么是用户自己标：判断一句话「是不是还没核实」需要语义理解，不接模型只能靠猜。
 * 猜错两种都很难受——把用户写的事实标成可疑，或者漏掉真正没核实的断言。
 * 所以这里只汇总**用户显式写的标记**，不替他判断内容真假。
 */
export function VerifyInbox({ items, onOpen, onVerified }: {
  items: readonly VerifyInboxItem[];
  /** 跳到那篇笔记（并定位到那一行）。 */
  onOpen: (item: VerifyInboxItem) => void;
  /** 标为已核实；不传就只有查看。 */
  onVerified?: (item: VerifyInboxItem) => void;
}): React.ReactElement | null {
  if (items.length === 0) return null;
  const totals = verifyTotals(items);
  // 一次最多列 8 条：这是提醒不是工作队列，列太长反而没人看。
  const shown = items.slice(0, 8);
  const rest = items.length - shown.length;
  return (
    <details className="nv-verify" aria-label="待验证清单">
      <summary>{`待验证：${totals.items} 条断言（涉及 ${totals.notes} 篇笔记）`}</summary>
      <ul className="nv-verify-list">
        {shown.map((item) => (
          <li key={`${item.noteId}-${item.line}`}>
            <button
              type="button"
              className="nv-verify-open"
              aria-label={`打开 ${item.noteTitle} 第 ${item.line + 1} 行`}
              onClick={() => onOpen(item)}
            >
              {`《${item.noteTitle}》`}
            </button>
            <span className="nv-verify-text">{item.text}</span>
            {onVerified ? (
              <button
                type="button"
                className="nv-verify-done"
                aria-label={`标记已核实：${item.text}`}
                title="把这一行的 ❓ 去掉；正文其余不动"
                onClick={() => onVerified(item)}
              >
                已核实
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {rest > 0 ? <p className="nv-verify-rest">{`还有 ${rest} 条未列出`}</p> : null}
    </details>
  );
}
