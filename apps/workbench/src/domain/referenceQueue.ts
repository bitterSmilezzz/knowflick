/**
 * 引用体检清单的筛选与分页（C05）。
 *
 * 为什么需要：体检是全库横向扫描，坏引用一多，清单会长到几十上百条——
 * 一屏塞不下时用户既看不清总数，也没法只看「失效」或只看「过期」。
 *
 * 这里只做**规则**：怎么筛、翻到第几页、边界怎么处理。渲染由组件负责。
 */

import type { ReferenceIssue, ReferenceIssueStatus } from "./referenceAudit";

/** 筛选口径：全部、只看失效、只看过期。 */
export type AuditFilter = "all" | ReferenceIssueStatus;

/** 每页条数：一屏能看完，又不至于翻太多页。 */
export const AUDIT_PAGE_SIZE = 8;

export interface AuditPage {
  /** 当前页要渲染的条目。 */
  items: ReferenceIssue[];
  /** 筛选后的总数（不是全部问题的总数）。 */
  total: number;
  /** 从 1 开始；空清单也是 1，界面不会出现「第 0 页」。 */
  page: number;
  /** 总页数；空清单也是 1。 */
  pageCount: number;
  hasPrev: boolean;
  hasNext: boolean;
}

/** 按状态筛选。`all` 原样返回（不复制），其余只留对应状态。 */
export function filterIssues(
  issues: readonly ReferenceIssue[],
  filter: AuditFilter,
): ReferenceIssue[] {
  if (filter === "all") return [...issues];
  return issues.filter((issue) => issue.status === filter);
}

/** 分类计数：给筛选按钮显示「失效 N / 过期 M」，也用于决定哪些按钮该禁用。 */
export function auditCounts(issues: readonly ReferenceIssue[]): {
  all: number;
  missing: number;
  changed: number;
} {
  let missing = 0;
  for (const issue of issues) if (issue.status === "missing") missing += 1;
  return { all: issues.length, missing, changed: issues.length - missing };
}

/**
 * 取某一页。
 *
 * 页码会被夹到合法区间：删掉几条之后仍停在原来的页码，很容易越界，
 * 那时应该显示最后一页，而不是空白——空白会让用户以为清单空了。
 */
export function paginateIssues(
  issues: readonly ReferenceIssue[],
  page: number,
  pageSize = AUDIT_PAGE_SIZE,
): AuditPage {
  const size = Math.max(1, Math.floor(pageSize));
  const total = issues.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const wanted = Number.isFinite(page) ? Math.floor(page) : 1;
  const current = Math.min(Math.max(1, wanted), pageCount);
  const start = (current - 1) * size;
  return {
    items: issues.slice(start, start + size),
    total,
    page: current,
    pageCount,
    hasPrev: current > 1,
    hasNext: current < pageCount,
  };
}

/**
 * 筛选 + 分页一次做完。
 *
 * 换筛选条件时必须回到第 1 页：停在第 3 页再切到只有 5 条的分类，
 * 用户会看到一片空白而不是「这个分类只有 5 条」。
 */
export function auditPage(
  issues: readonly ReferenceIssue[],
  filter: AuditFilter,
  page: number,
  pageSize = AUDIT_PAGE_SIZE,
): AuditPage {
  return paginateIssues(filterIssues(issues, filter), page, pageSize);
}
