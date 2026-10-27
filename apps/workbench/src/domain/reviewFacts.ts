/**
 * 复盘数据聚合层（R4/D03 的底座）：从记录与目标算出复盘所需的全部事实。
 *
 * 路线图口径：区分**记录事实**和**建议**——这里只产事实，一个建议都不给；
 * 「缺少记录」如实报零，不产生任何负面状态（与 D04 同一口径）。
 * 纯函数 + 固定时间注入：node 环境可测，视图只做渲染。
 */

import type { KnowledgeCard } from "./card";
import type { Goal, RawMaterial } from "./dto";

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
  /** 周期内新转出的知识卡。 */
  newCards: Array<{ id: string; headline: string; at: number }>;
  /** 最近一次复习落在周期内的卡数。没有逐次历史，不能推算周期内动作次数。 */
  reviewedCardCount: number;
  /** 目标当前状态及累计证据数。 */
  goals: Array<{ id: string; title: string; evidenceCount: number; achieved: boolean }>;
  /** 如实缺席清单：周期内没有任何记录的方面（不是失败，是「没有记录」）。 */
  gaps: string[];
}

export interface ReviewInput {
  materials: RawMaterial[];
  cards: KnowledgeCard[];
  goals: Goal[];
  now: number;
}

/** 聚合一个周期的复盘事实。只算事实；解读与建议是上层的事。 */
export function reviewFacts(input: ReviewInput, kind: "day" | "week" | "month"): ReviewFacts {
  const from = periodStart(kind, input.now);
  const to = input.now;
  const inPeriod = (at: number | null | undefined) => at != null && at >= from && at <= to;

  const newMaterials = input.materials
    .filter((m) => inPeriod(m.createdAt))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((m) => ({ id: m.id, title: m.title, sourceType: m.sourceType, at: m.createdAt }));
  const newCards = input.cards
    .filter((c) => inPeriod(c.createdAt))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((c) => ({ id: c.id, headline: c.headline, at: c.createdAt }));

  const reviewedCards = input.cards.filter((c) => inPeriod(c.lastReviewedAt));

  const goals = input.goals.map((g) => ({
    id: g.id,
    title: g.title,
    evidenceCount: g.evidenceCount,
    achieved: g.achievedAt != null,
  }));

  const gaps: string[] = [];
  if (newMaterials.length === 0) gaps.push("本周期没有新收集的素材");
  if (newCards.length === 0) gaps.push("本周期没有新转出的知识卡");
  if (reviewedCards.length === 0) gaps.push("本周期没有复习动作");

  return {
    period: { from, to, label: periodLabel(kind, to) },
    newMaterials,
    newCards,
    reviewedCardCount: reviewedCards.length,
    goals,
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
  lines.push(`- 新收集素材：${facts.newMaterials.length} 条`);
  for (const m of facts.newMaterials) lines.push(`  - ${m.title}`);
  lines.push(`- 新转出知识卡：${facts.newCards.length} 张`);
  for (const c of facts.newCards) lines.push(`  - ${c.headline}`);
  lines.push(`- 最近一次复习在本周期的卡：${facts.reviewedCardCount} 张（未记录逐次复习历史，无法统计本周期动作次数）`);
  lines.push("");
  lines.push(`## 目标现状（证据数只是计数，不是进度评分）`);
  lines.push("");
  for (const g of facts.goals) {
    lines.push(`- ${g.title}：关联证据 ${g.evidenceCount} 条${g.achieved ? "（已达成）" : ""}`);
  }
  if (facts.goals.length === 0) lines.push("- （无活跃目标）");
  lines.push("");
  lines.push(`## 没有记录的方面（如实列出）`);
  lines.push("");
  if (facts.gaps.length) for (const g of facts.gaps) lines.push(`- ${g}`);
  else lines.push("- 无");
  return lines.join("\n");
}
