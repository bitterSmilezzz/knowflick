import type { ReferenceIssue } from "../../domain/referenceAudit";
import { issueKey } from "../../domain/referenceIgnore";

/**
 * 引用体检面板（C05）：把库里所有失效/过期引用摊在一处。
 *
 * 抽成组件 + 单独测试：这条链路（扫描结果 → 列表渲染 → 点开原笔记）放在笔记页里测要先铺
 * 一堆会话与列表状态，测出来多半是「环境不对」而不是「功能不对」（B04 那次已经踩过）。
 *
 * 「忽略这条」与「删除这条引用」是**两件不同的事**，别混：
 * - 忽略 = 我知道，但我不打算动（本机界面决定，不改正文）；
 * - 删除 = 把正文里那两行真的删掉（走修订，可回退）。
 */
export function ReferenceAuditPanel({ issues, ignored = [], onOpen, onRemove, onIgnore, onUnignore }: {
  /** 要处理的问题（已剔除忽略的）。 */
  issues: readonly ReferenceIssue[];
  /** 被忽略的问题：收在折叠区里，随时能撤销。 */
  ignored?: readonly ReferenceIssue[];
  onOpen: (noteId: string) => void;
  /** 就地删掉这条引用；不传就只有查看。 */
  onRemove?: (issue: ReferenceIssue) => void;
  /** 忽略这条；不传就不显示忽略按钮。 */
  onIgnore?: (issue: ReferenceIssue) => void;
  /** 撤销忽略。 */
  onUnignore?: (issue: ReferenceIssue) => void;
}): React.ReactElement | null {
  if (issues.length === 0 && ignored.length === 0) return null;
  const missing = issues.filter((i) => i.status === "missing").length;
  const changed = issues.length - missing;
  const head = issues.length === 0
    ? `引用体检：全部 ${ignored.length} 处已忽略`
    : `引用体检：${issues.length} 处待复核（失效 ${missing} / 过期 ${changed}）`
      + (ignored.length > 0 ? `，另有 ${ignored.length} 处已忽略` : "");
  return (
    <details className="nv-audit" aria-label="引用体检">
      <summary>{head}</summary>
      {issues.length > 0 ? (
        <ul className="nv-audit-list">
          {issues.map((issue) => (
            <li key={issueKey(issue)}>
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
              {issue.excerpt ? <span className="nv-audit-target">{`「${issue.excerpt.slice(0, 120)}」`}</span> : null}
              {onRemove ? (
                <button
                  type="button"
                  className="nv-audit-remove"
                  aria-label={`删除指向 ${issue.targetTitle} 的引用`}
                  onClick={() => onRemove(issue)}
                >
                  删除这条引用
                </button>
              ) : null}
              {onIgnore ? (
                <button
                  type="button"
                  className="nv-audit-ignore"
                  aria-label={`忽略指向 ${issue.targetTitle} 的这条问题`}
                  title="不打算处理它：从清单里收起来，不改正文"
                  onClick={() => onIgnore(issue)}
                >
                  忽略
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {ignored.length > 0 ? (
        <details className="nv-audit-ignored" aria-label="已忽略的引用问题">
          <summary>{`已忽略 ${ignored.length} 处`}</summary>
          <ul className="nv-audit-list">
            {ignored.map((issue) => (
              <li key={issueKey(issue)}>
                <span className="nv-audit-target">
                  {`《${issue.noteTitle}》→ 《${issue.targetTitle}》（${issue.status === "missing" ? "失效" : "过期"}）`}
                  {issue.excerpt ? `「${issue.excerpt.slice(0, 120)}」` : ""}
                </span>
                {onUnignore ? (
                  <button
                    type="button"
                    className="nv-audit-ignore"
                    aria-label={`恢复指向 ${issue.targetTitle} 的这条问题`}
                    onClick={() => onUnignore(issue)}
                  >
                    撤销忽略
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </details>
  );
}
