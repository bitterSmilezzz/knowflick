import type { KnowledgeCard } from "./card";
import type { RawMaterial } from "../shell/store";

/**
 * 恢复备份时「哪些条目该被放回去」的判定。
 *
 * 这条规则单独抽出来，是因为它曾经是个**静默丢数据**的地方：
 * 恢复时用 `!c.headline || !c.details` 过滤卡片、`|| !m.title` 过滤素材，
 * 于是「空标题」「空正文」的条目在恢复时**被悄悄丢弃**——备份里明明写进去了，
 * 恢复回来却少了内容，而界面上只说「恢复完成」。
 *
 * 判定标准只有一个：**这条记录在数据上是否可用**。
 * 标题/正文为空不代表它无效——那可能是用户自己建的空标题笔记。
 */
export function restorableMaterials(materials: RawMaterial[]): RawMaterial[] {
  return materials.filter((m) => Boolean(m.id) && typeof m.rawText === "string");
}

/** 同上，对卡片。 */
export function restorableCards(cards: KnowledgeCard[]): KnowledgeCard[] {
  return cards.filter((c) => Boolean(c.id));
}

/** 同上，对认知产物（产物仍要求有标题——它没有正文可退化）。 */
export function restorableArtifacts<T extends { id: string; title: string }>(artifacts: T[]): T[] {
  return artifacts.filter((a) => Boolean(a.id) && Boolean(a.title));
}
