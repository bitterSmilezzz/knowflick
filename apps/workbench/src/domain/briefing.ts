import type { KnowledgeCard } from "./card";

export interface BriefingSection {
  title: string;
  items: Array<{ title: string; subtitle?: string; id?: string }>;
}

export interface CognitiveBriefing {
  weekLabel: string;
  generatedAt: number;
  newCapturedCount: number;
  sections: [BriefingSection, BriefingSection, BriefingSection]; // 固定三块
  markdown: string;
}

/**
 * 认知简报生成器
 * @param cards 知识库全部卡片
 * @param now 当前时间戳（毫秒）
 * @param lookbackDays 回溯天数，默认 7 天
 */
export function generateCognitiveBriefing(
  cards: KnowledgeCard[],
  now = Date.now(),
  lookbackDays = 7
): CognitiveBriefing {
  const windowMs = lookbackDays * 86400 * 1000;
  const recentThreshold = now - windowMs;

  // 1. 本周新收录卡片
  const newCards = cards.filter((c) => c.createdAt >= recentThreshold);

  // 聚类：按分类划分
  const categoryClusters = new Map<string, KnowledgeCard[]>();
  for (const c of newCards) {
    const cat = c.category || "未分类";
    const list = categoryClusters.get(cat) ?? [];
    list.push(c);
    categoryClusters.set(cat, list);
  }

  const section1Items: Array<{ title: string; subtitle?: string; id?: string }> = [];
  for (const [cat, items] of categoryClusters.entries()) {
    section1Items.push({
      title: `【${cat}】(${items.length} 条)`,
      subtitle: items.map((i) => i.headline).slice(0, 3).join(" · "),
    });
  }

  const section1: BriefingSection = {
    title: "一、近期新收内容聚类",
    items: section1Items.length > 0 ? section1Items : [{ title: "近期无新收录卡片" }],
  };

  // 2. 关注趋势演变（分析高频主题分布）
  const allCategoryCounts = new Map<string, number>();
  for (const c of cards) {
    const cat = c.category || "未分类";
    allCategoryCounts.set(cat, (allCategoryCounts.get(cat) ?? 0) + 1);
  }

  const topCategories = Array.from(allCategoryCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const section2: BriefingSection = {
    title: "二、核心关注趋势演变",
    items: topCategories.map(([cat, count]) => ({
      title: cat,
      subtitle: `累计积累 ${count} 条知识卡片`,
    })),
  };

  // 3. 值得回看的旧内容（时间衰减挑选）
  // 挑出建立时间较久，且复习间隔较长或很久未复习的高价值卡片（收藏卡优先）
  const olderCards = cards
    .filter((c) => c.createdAt < recentThreshold)
    .map((c) => {
      const ageDays = (now - c.createdAt) / (86400 * 1000);
      const favWeight = c.isFavorite ? 2.0 : 1.0;
      const reviewScore = (ageDays / (c.reviewCount + 1)) * favWeight;
      return { card: c, score: reviewScore };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const section3: BriefingSection = {
    title: "三、温故知新：值得回看的旧内容",
    items: olderCards.map(({ card }) => ({
      title: card.headline,
      subtitle: `${card.category} · ${card.summary.substring(0, 60)}...`,
      id: card.id,
    })),
  };

  const weekLabel = `第 ${Math.ceil(new Date(now).getDate() / 7)} 周知识洞察`;

  // 拼装 Markdown 文本
  const mdLines: string[] = [
    `# 认知简报 · ${weekLabel}`,
    `> 生成时间: ${new Date(now).toLocaleDateString()} | 近期新增: ${newCards.length} 条 | 知识库总计: ${cards.length} 条`,
    "",
    `## ${section1.title}`,
    ...section1.items.map((it) => `- **${it.title}**: ${it.subtitle || ""}`),
    "",
    `## ${section2.title}`,
    ...section2.items.map((it) => `- **${it.title}**: ${it.subtitle || ""}`),
    "",
    `## ${section3.title}`,
    ...section3.items.map((it) => `- **${it.title}** (${it.subtitle || ""})`),
  ];

  return {
    weekLabel,
    generatedAt: now,
    newCapturedCount: newCards.length,
    sections: [section1, section2, section3],
    markdown: mdLines.join("\n"),
  };
}
