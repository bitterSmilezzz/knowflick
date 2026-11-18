import type { ReferenceIssue } from "../../domain/referenceAudit";

/**
 * 引用体检面板（C05 的第一块）：把库里所有失效/过期引用摊在一处。
 *
 * 抽成组件 + 单独测试：这条链路（扫描结果 → 列表渲染 → 点开原笔记）放在笔记页里测要先铺
 * 一堆会话与列表状态，测出来多半是「环境不对」而不是「功能不对」（B04 那次已经踩过）。
 */
export function ReferenceAuditPanel({ issues, onOpen }: {
  issues: readonly ReferenceIssue[];
  onOpen: (noteId: string) => void;
}): React.ReactElement | null {
  if (issues.length === 0) return null;
  const missing = issues.filter((i) => i.status === "missing").length;
  const changed = issues.length - missing;
  return (
    <details className="nv-audit" aria-label="引用体检">
      <summary>{`引用体检：${issues.length} 处待复核（失效 ${missing} / 过期 ${changed}）`}</summary>
      <ul className="nv-audit-list">
        {issues.map((issue, index) => (
          <li key={`${issue.noteId}-${issue.targetId}-${index}`}>
            <button
              type="button"
              className="nv-audit-open"
              aria-label={`打开 ${issue.noteTitle}`}
              onClick={() => onOpen(issue.noteId)}
            >
              {`《${issue.noteTitle}》`}
            </button>
            <span className="nv-audit-target">
              {issue.status === "missing"
                ? `→ 《${issue.targetTitle}》已不在库里，这条引用已失效`
                : `→ 《${issue.targetTitle}》的内容改过了，这条引用可能过期`}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
