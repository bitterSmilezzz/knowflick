import type { ReferenceIssue } from "../../domain/referenceAudit";
import { issueKey } from "../../domain/referenceIgnore";
import { auditCounts, auditPage, type AuditFilter } from "../../domain/referenceQueue";

/**
 * 引用体检面板（C05）：把库里所有失效/过期引用摊在一处。
 *
 * 抽成组件 + 单独测试：这条链路（扫描结果 → 列表渲染 → 点开原笔记）放在笔记页里测要先铺
 * 一堆会话与列表状态，测出来多半是「环境不对」而不是「功能不对」（B04 那次已经踩过）。
 *
 * 「忽略这条」与「删除这条引用」是**两件不同的事**，别混：
 * - 忽略 = 我知道，但我不打算动（本机界面决定，不改正文）；
 * - 删除 = 把正文里那两行真的删掉（走修订，可回退）。
 *
 * 筛选与分页由调用方持有（`filter` / `page`）：换筛选要回到第 1 页，这个决定属于持有者，
 * 组件只按给定条件渲染——不然「点了筛选却停在空白页」这类问题会藏在组件内部。
 */
export function ReferenceAuditPanel({
  issues,
  ignored = [],
  filter = "all",
  page = 1,
  onFilter,
  onPage,
  onOpen,
  onRemove,
  onIgnore,
  onUnignore,
}: {
  /** 要处理的问题（已剔除忽略的）。 */
  issues: readonly ReferenceIssue[];
  /** 被忽略的问题：收在折叠区里，随时能撤销。 */
  ignored?: readonly ReferenceIssue[];
  /** 当前分类筛选。 */
  filter?: AuditFilter;
  /** 当前页码（从 1 开始）。 */
  page?: number;
  onFilter?: (filter: AuditFilter) => void;
  onPage?: (page: number) => void;
  onOpen: (noteId: string) => void;
  /** 就地删掉这条引用；不传就只有查看。 */
  onRemove?: (issue: ReferenceIssue) => void;
  /** 忽略这条；不传就不显示忽略按钮。 */
  onIgnore?: (issue: ReferenceIssue) => void;
  /** 撤销忽略。 */
  onUnignore?: (issue: ReferenceIssue) => void;
}): React.ReactElement | null {
  if (issues.length === 0 && ignored.length === 0) return null;
  const counts = auditCounts(issues);
  const view = auditPage(issues, filter, page);
  const ignoredNote = ignored.length > 0 ? `，另有 ${ignored.length} 处已忽略` : "";
  const head =
    counts.all === 0
      ? `引用体检：全部 ${ignored.length} 处已忽略`
      : `引用体检：${counts.all} 处待复核（失效 ${counts.missing} / 过期 ${counts.changed}）${ignoredNote}`;
  const tabs: { id: AuditFilter; label: string; count: number }[] = [
    { id: "all", label: "全部", count: counts.all },
    { id: "missing", label: "失效", count: counts.missing },
    { id: "changed", label: "过期", count: counts.changed },
  ];
  return (
    <details className="nv-audit" aria-label="引用体检">
      <summary>{head}</summary>
      {counts.all > 0 ? (
        <div className="nv-audit-tabs" role="group" aria-label="按类别筛选">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={filter === tab.id ? "nv-audit-tab nv-audit-tab-on" : "nv-audit-tab"}
              aria-pressed={filter === tab.id}
              aria-label={`只看${tab.label}的 ${tab.count} 处`}
              disabled={tab.count === 0 || !onFilter}
              onClick={() => onFilter?.(tab.id)}
            >
              {`${tab.label} ${tab.count}`}
            </button>
          ))}
        </div>
      ) : null}
      {view.items.length > 0 ? (
        <ul className="nv-audit-list">
          {view.items.map((issue) => (
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
      {view.pageCount > 1 ? (
        <div className="nv-audit-pager" role="group" aria-label="清单翻页">
          <button
            type="button"
            className="nv-audit-page"
            aria-label="上一页"
            disabled={!view.hasPrev}
            onClick={() => onPage?.(view.page - 1)}
          >
            上一页
          </button>
          <span className="nv-audit-pageinfo" aria-live="polite">{`第 ${view.page} / ${view.pageCount} 页 · 共 ${view.total} 处`}</span>
          <button
            type="button"
            className="nv-audit-page"
            aria-label="下一页"
            disabled={!view.hasNext}
            onClick={() => onPage?.(view.page + 1)}
          >
            下一页
          </button>
        </div>
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
