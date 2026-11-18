/**
 * 复盘数据聚合层（R4/D03 的底座）：从记录与目标算出复盘所需的全部事实。
 *
 * 路线图口径：区分**记录事实**和**建议**——这里只产事实，一个建议都不给；
 * 「缺少记录」如实报零，不产生任何负面状态（与 D04 同一口径）。
 * 纯函数 + 固定时间注入：node 环境可测，视图只做渲染。
 */

import type { KnowledgeCard } from "./card";
import type { Goal, GoalEvidenceItem, RawMaterial } from "./dto";
import type { Note } from "./note";
import type { ReviewEvent, ReviewHistorySnapshot } from "./reviewHistory";

export interface ReviewPeriod {
  /** 周期起点（含）。 */
  from: number;
  /** 周期终点（含）。 */
  to: number;
  label: string;
}

/** 日/周/月复盘的周期起点（对齐自然日/周一/月初）。 */
export function periodStart(kind: "day" | "week" | "month", now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (kind === "day") return d.getTime();
  if (kind === "week") {
    // 周一为一周之始（getDay(): 0=周日）
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    return d.getTime();
  }
  d.setDate(1);
  return d.getTime();
}

export function periodLabel(kind: "day" | "week" | "month", now: number): string {
  const d = new Date(now);
  if (kind === "day") return `${d.getMonth() + 1}月${d.getDate()}日`;
  if (kind === "week") return `${d.getMonth() + 1}月第 ${Math.ceil(d.getDate() / 7)} 周`;
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
}

export interface ReviewFacts {
  period: ReviewPeriod;
  /** 周期内新收集的素材（含标题，按时间倒序）。 */
  newMaterials: Array<{ id: string; title: string; sourceType: string; at: number }>;
  /** 周期内新建或更新的笔记（按最近活动时间倒序）。 */
  newNotes: Array<{ id: string; title: string; activity: "created" | "updated"; at: number }>;
  noteFactsAvailable: boolean;
  /** 周期内新转出的知识卡。 */
  newCards: Array<{ id: string; headline: string; at: number }>;
  /** 最近一次复习时间落在周期内的卡数；这是卡片状态，不是动作次数。 */
  reviewedCardCount: number | null;
  /** 项目归属数据尚不可用时为 null，避免把无法确认的范围显示为零。 */
  projectFactsAvailable: boolean;
  /** 按当前项目范围筛选的逐次事件；缺少可靠历史时为空且 available=false。 */
  reviewEvents: ReviewEvent[];
  reviewHistoryAvailable: boolean;
  reviewHistoryComplete: boolean;
  projectReviewHistoryComplete: boolean;
  /** 目标当前状态及累计证据数。 */
  goals: Array<{ id: string; title: string; evidenceCount: number; achieved: boolean; abandoned: boolean; periodEvidence: GoalEvidenceItem[] | null }>;
  goalSnapshotComplete: boolean;
  /** 如实缺席清单：周期内没有任何记录的方面（不是失败，是「没有记录」）。 */
  gaps: string[];
}

export interface ReviewInput {
  materials: RawMaterial[];
  /** null 或缺省表示笔记快照尚未读取，不能按零条处理。 */
  notes?: Note[] | null;
  cards: KnowledgeCard[];
  goals: Goal[];
  /** null 或缺省表示未能读取，不能当成零条。 */
  goalEvidence?: GoalEvidenceItem[] | null;
  reviewHistory?: ReviewHistorySnapshot | null;
  projectScope?: string[];
  /** 项目内笔记、素材与卡片 ID；null/缺省表示项目成员索引尚不可用。 */
  projectNoteIds?: ReadonlySet<string> | null;
  projectMaterialIds?: ReadonlySet<string> | null;
  projectCardIds?: ReadonlySet<string> | null;
  now: number;
}

/**
 * 从“笔记 → 项目”索引推导复盘可用的素材与卡片归属。
 * 素材通过来源笔记归属项目，卡片通过 materialId 继承素材归属；
 * 没有这条明确关系的项目外内容不会被猜进项目复盘。
 */
export function projectFactMembership(
  projectScope: readonly string[],
  notes: ReadonlyArray<Pick<Note, "id" | "sourceMaterialId" | "isDeleted">>,
  cards: ReadonlyArray<Pick<KnowledgeCard, "id" | "materialId">>,
  noteProjects: ReadonlyMap<string, readonly string[]>,
): { noteIds: ReadonlySet<string>; materialIds: ReadonlySet<string>; cardIds: ReadonlySet<string> } {
  const selectedProjects = new Set(projectScope);
  const noteIds = new Set<string>();
  const materialIds = new Set<string>();
  for (const note of notes) {
    if (note.isDeleted) continue;
    if ((noteProjects.get(note.id) ?? []).some((projectId) => selectedProjects.has(projectId))) {
      noteIds.add(note.id);
      if (note.sourceMaterialId) materialIds.add(note.sourceMaterialId);
    }
  }
  const cardIds = new Set<string>();
  for (const card of cards) {
    if (card.materialId && materialIds.has(card.materialId)) cardIds.add(card.id);
  }
  return { noteIds, materialIds, cardIds };
}

/** 聚合一个周期的复盘事实。只算事实；解读与建议是上层的事。 */
export function reviewFacts(input: ReviewInput, kind: "day" | "week" | "month"): ReviewFacts {
  const from = periodStart(kind, input.now);
  const to = input.now;
  const inPeriod = (at: number | null | undefined) => at != null && at >= from && at <= to;
  const projectScope = input.projectScope ?? [];
  const noteFactsAvailable = input.notes != null &&
    (projectScope.length === 0 || input.projectNoteIds != null);
  const projectFactsAvailable = projectScope.length === 0 ||
    (input.projectMaterialIds != null && input.projectCardIds != null);

  const newNotes: ReviewFacts["newNotes"] = [];
  for (const note of input.notes ?? []) {
    if (note.isDeleted || (projectScope.length > 0 && input.projectNoteIds?.has(note.id) !== true)) continue;
    if (inPeriod(note.createdAt)) {
      newNotes.push({ id: note.id, title: note.title, activity: "created", at: note.createdAt });
    } else if (inPeriod(note.updatedAt)) {
      newNotes.push({ id: note.id, title: note.title, activity: "updated", at: note.updatedAt });
    }
  }
  newNotes.sort((a, b) => b.at - a.at);

  const newMaterials = input.materials
    .filter((m) => inPeriod(m.createdAt) &&
      (projectScope.length === 0 || input.projectMaterialIds?.has(m.id) === true))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((m) => ({ id: m.id, title: m.title, sourceType: m.sourceType, at: m.createdAt }));
  const newCards = input.cards
    .filter((c) => inPeriod(c.createdAt) &&
      (projectScope.length === 0 || input.projectCardIds?.has(c.id) === true))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((c) => ({ id: c.id, headline: c.headline, at: c.createdAt }));

  const scopedCards = projectScope.length === 0
    ? input.cards
    : input.cards.filter((card) => input.projectCardIds?.has(card.id) === true);
  const reviewedCards = scopedCards.filter((c) => inPeriod(c.lastReviewedAt));
  const allReviewEvents = input.reviewHistory?.events.filter((event) => inPeriod(event.reviewedAt)) ?? [];
  const reviewEvents = projectScope.length === 0
    ? allReviewEvents
    : allReviewEvents.filter((event) => event.projectIds.some((id) => projectScope.includes(id)));
  const reviewHistoryAvailable = input.reviewHistory != null;
  const reviewHistoryComplete = reviewHistoryAvailable && from >= input.reviewHistory!.coverageStartedAt;
  const projectReviewHistoryComplete = reviewHistoryComplete &&
    (projectScope.length === 0 || allReviewEvents.every((event) => event.projectAttributionComplete));

  const goals = input.goals
    .filter((goal) => projectScope.length === 0 || (goal.scope !== null && projectScope.includes(goal.scope)))
    .map((g) => ({
    id: g.id,
    title: g.title,
    evidenceCount: g.evidenceCount,
    achieved: g.achievedAt != null && g.achievedAt <= to,
    abandoned: g.abandonedAt != null && g.abandonedAt <= to,
    periodEvidence: input.goalEvidence == null ? null : input.goalEvidence
      .filter((e) => e.goalId === g.id && inPeriod(e.linkedAt))
      .sort((a, b) => b.linkedAt - a.linkedAt),
  }));

  const gaps: string[] = [];
  if (!noteFactsAvailable) gaps.push(projectScope.length > 0
    ? "项目笔记归属索引不可用，无法确认所选项目的笔记记录"
    : "笔记事实不可用，尚未读取笔记快照");
  else if (newNotes.length === 0) gaps.push("本周期没有新建或更新的笔记");
  if (!projectFactsAvailable) gaps.push("项目归属索引不可用，无法确认所选项目的素材与知识卡记录");
  else {
    if (newMaterials.length === 0) gaps.push("本周期没有新收集的素材");
    if (newCards.length === 0) gaps.push("本周期没有新转出的知识卡");
  }
  if (!reviewHistoryAvailable) gaps.push("逐次复习历史不可用，无法确认本周期动作次数");
  else if (reviewHistoryComplete && projectReviewHistoryComplete && reviewEvents.length === 0) {
    gaps.push(projectScope.length > 0 ? "本周期没有所选项目的逐次复习事件" : "本周期没有逐次复习事件");
  }

  return {
    period: { from, to, label: periodLabel(kind, to) },
    newNotes,
    noteFactsAvailable,
    newMaterials,
    newCards,
    reviewedCardCount: projectFactsAvailable ? reviewedCards.length : null,
    projectFactsAvailable,
    reviewEvents,
    reviewHistoryAvailable,
    reviewHistoryComplete,
    projectReviewHistoryComplete,
    goals,
    goalSnapshotComplete: input.goalEvidence != null,
    gaps,
  };
}

/** 复盘的 Markdown 导出（用户可带走/贴给外部工具——带周期边界，不带任何评价）。 */
export function reviewToMarkdown(facts: ReviewFacts): string {
  const lines: string[] = [];
  lines.push(`# 复盘：${facts.period.label}`);
  lines.push("");
  lines.push(`周期：${new Date(facts.period.from).toLocaleString("zh-CN")} ~ ${new Date(facts.period.to).toLocaleString("zh-CN")}`);
  lines.push("");
  lines.push(`## 记录事实`);
  lines.push("");
  if (facts.noteFactsAvailable) {
    lines.push(`- 本周期新建或更新的笔记：${facts.newNotes.length} 篇`);
    for (const note of facts.newNotes) {
      lines.push(`  - ${note.activity === "created" ? "新建" : "更新"}《${note.title || "无标题"}》（笔记 ID：${note.id}；${new Date(note.at).toLocaleString("zh-CN")}）`);
    }
  } else {
    lines.push("- 笔记事实：归属数据不可用，未计算数量");
  }
  if (facts.projectFactsAvailable) {
    lines.push(`- 新收集素材：${facts.newMaterials.length} 条`);
    for (const m of facts.newMaterials) lines.push(`  - ${m.title}`);
    lines.push(`- 新转出知识卡：${facts.newCards.length} 张`);
    for (const c of facts.newCards) lines.push(`  - ${c.headline}`);
  } else {
    lines.push("- 所选项目的素材与知识卡事实：归属数据不可用，未计算数量");
  }
  if (!facts.reviewHistoryAvailable) lines.push("- 逐次复习事件：历史不可用，无法确认本周期次数");
  else lines.push(`- 逐次复习事件：${facts.reviewEvents.length} 次${facts.reviewHistoryComplete ? "（周期历史完整）" : "（仅为已记录数，周期历史不完整）"}`);
  if (facts.reviewHistoryAvailable && facts.reviewHistoryComplete && facts.projectReviewHistoryComplete === false) lines.push("  - 项目归属索引不完整，项目范围复习次数可能偏少");
  if (facts.reviewedCardCount === null) lines.push("- 最近一次复习时间在本周期的卡：项目卡片归属不可用，未计算数量");
  else lines.push(`- 最近一次复习时间在本周期的卡：${facts.reviewedCardCount} 张（卡片累计状态，不等同于本周期动作次数）`);
  lines.push("");
  lines.push(`## 目标现状（证据数只是计数，不是进度评分）`);
  lines.push("");
  if (!facts.goalSnapshotComplete) lines.push("目标周期快照未读取，仅显示已取得的活跃目标。");
  for (const g of facts.goals) {
    lines.push(`- ${g.title}：关联证据 ${g.evidenceCount} 条${g.achieved ? "（已达成）" : g.abandoned ? "（已放弃）" : ""}`);
    if (g.periodEvidence === null) lines.push("  - 本周期证据明细未读取");
    else if (g.periodEvidence.length === 0) lines.push("  - 本周期没有新增关联证据");
    else for (const e of g.periodEvidence) {
      const kind = e.kind === "note" ? "笔记" : "素材";
      lines.push(`  - ${kind}：${e.title ?? "原件已删除或不可用"}（${kind} ID：${e.evidenceId}；关联于 ${new Date(e.linkedAt).toLocaleString("zh-CN")}）`);
    }
  }
  if (facts.goals.length === 0) lines.push(facts.goalSnapshotComplete ? "- （本周期没有目标）" : "- （无可显示的活跃目标）");
  lines.push("");
  lines.push(`## 没有记录的方面（如实列出）`);
  lines.push("");
  if (facts.gaps.length) for (const g of facts.gaps) lines.push(`- ${g}`);
  else lines.push("- 无");
  return lines.join("\n");
}
