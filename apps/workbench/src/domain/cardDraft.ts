import type { KnowledgeCard } from "./card";

export interface CardDraftInput {
  id: string;
  version: number;
  content: { category: string; headline: string; summary: string; details: string; tags: string[] };
  materialId?: string;
  source: string;
  links: { title: string; url: string }[];
}

/** 把 AI 提炼出的卡片转成新建卡片输入（version 0 表示新建，id 用模型卡自带的随机 id）。 */
export function toCardDraftInput(card: KnowledgeCard, materialId: string): CardDraftInput {
  return {
    id: card.id,
    version: 0,
    content: {
      category: card.category || "随手笔记",
      headline: card.headline,
      summary: card.summary || card.headline,
      details: card.details,
      tags: [...(card.tags ?? [])],
    },
    materialId,
    source: card.source || "ai",
    links: card.links.map((link) => ({ title: link.title, url: link.url })),
  };
}