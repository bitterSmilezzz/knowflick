/** 与 Kotlin `KnowledgeCard` / `CardJson` 同一份线格式。本地 cards.json 是裸数组。 */

export type SwipeDirection = "left" | "right" | "skip";

/** 与 `LibraryScreen.directionLabel` 一致，用于历史列表副标题。 */
export function swipeDirectionLabel(direction: SwipeDirection | null): string {
  if (direction === "right") return "♥ 感兴趣";
  if (direction === "left") return "✕ 不喜欢";
  if (direction === "skip") return "↻ 跳过";
  return "浏览";
}
export type CardSource = "seed" | "ai" | "imported";

export interface ScienceLink {
  title: string;
  url: string;
}

export interface KnowledgeCard {
  id: string;
  category: string;
  headline: string;
  summary: string;
  details: string;
  links: ScienceLink[];
  source: CardSource;
  createdAt: number;
  editedAt: number | null;
  seenAt: number | null;
  swiped: SwipeDirection | null;
  isFavorite: boolean;
  favoritedAt: number | null;
  reviewCount: number;
  masteryLevel: number;
  lastReviewedAt: number | null;
  repetition: number;
  intervalDays: number;
  easeFactor: number;
  stability: number;
  difficulty: number;
  subject: string | null;
  branch: string | null;
  level: number | null;
  track: string | null;
  orderKey: string | null;
  prereq: string[];
  materialId?: string | null;
  tags?: string[];
}

const SWIPES: readonly SwipeDirection[] = ["left", "right", "skip"];
const SOURCES: readonly CardSource[] = ["seed", "ai", "imported"];

export function encodeDate(epochMillis: number): string {
  const iso = new Date(epochMillis).toISOString();
  return epochMillis % 1000 === 0 ? iso.replace(".000Z", "Z") : iso;
}

function epochToMillis(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const truncated = Math.trunc(value);
  return Math.abs(truncated) < 10_000_000_000 ? truncated * 1000 : truncated;
}

export function decodeDate(raw: unknown): number | null {
  if (typeof raw === "number") return epochToMillis(raw);
  if (typeof raw !== "string" || raw.length === 0) return null;
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) return parsed;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? epochToMillis(numeric) : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** JsonPrimitive.content：数字和布尔也按字面量收下。 */
function asString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return null;
}

function asInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function asBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asDouble(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function blankToNull(value: string | null): string | null {
  if (value === null || value.trim() === "") return null;
  return value;
}

export function cardFromJson(value: unknown, now = Date.now()): KnowledgeCard {
  const obj = asObject(value);
  if (!obj) throw new Error("卡片不是对象");
  const swipedRaw = asString(obj.swiped);
  const swiped = SWIPES.find((item) => item === swipedRaw) ?? null;
  const isFavorite = asBool(obj.isFavorite) ?? swiped === "right";
  const seenAt = decodeDate(obj.seenAt);
  const favoritedAt = decodeDate(obj.favoritedAt) ?? (isFavorite ? seenAt : null);
  const sourceRaw = asString(obj.source);
  const source = SOURCES.find((item) => item === sourceRaw) ?? "seed";
  const level = asInt(obj.level);
  return {
    id: asString(obj.id) ?? crypto.randomUUID().toUpperCase(),
    category: asString(obj.category) ?? "",
    headline: asString(obj.headline) ?? "",
    summary: asString(obj.summary) ?? "",
    details: asString(obj.details) ?? "",
    links: Array.isArray(obj.links)
      ? obj.links.flatMap((link) => {
          const linkObj = asObject(link);
          if (!linkObj) return [];
          return [{ title: asString(linkObj.title) ?? "", url: asString(linkObj.url) ?? "" }];
        })
      : [],
    source,
    createdAt: decodeDate(obj.createdAt) ?? now,
    editedAt: decodeDate(obj.editedAt),
    seenAt,
    swiped,
    isFavorite,
    favoritedAt,
    reviewCount: asInt(obj.reviewCount) ?? 0,
    masteryLevel: asInt(obj.masteryLevel) ?? 0,
    lastReviewedAt: decodeDate(obj.lastReviewedAt),
    repetition: asInt(obj.repetition) ?? 0,
    intervalDays: asInt(obj.intervalDays) ?? 1,
    easeFactor: asDouble(obj.easeFactor) ?? 2.5,
    stability: asDouble(obj.stability) ?? 0,
    difficulty: asDouble(obj.difficulty) ?? 0,
    subject: blankToNull(asString(obj.subject)),
    branch: blankToNull(asString(obj.branch)),
    level: level !== null && level >= 1 && level <= 5 ? level : null,
    track: blankToNull(asString(obj.track)),
    orderKey: blankToNull(asString(obj.orderKey)),
    ...(typeof obj.materialId === "string" ? { materialId: obj.materialId } : {}),
    ...(Array.isArray(obj.tags) ? { tags: obj.tags.filter((tag): tag is string => typeof tag === "string") } : {}),
    prereq: Array.isArray(obj.prereq)
      ? obj.prereq.flatMap((item) => {
          const text = asString(item);
          return text === null ? [] : [text];
        })
      : [],
  };
}

export function cardToJson(card: KnowledgeCard): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    id: card.id,
    category: card.category,
    headline: card.headline,
    summary: card.summary,
    details: card.details,
    links: card.links.map((link) => ({ title: link.title, url: link.url })),
    source: card.source,
    createdAt: encodeDate(card.createdAt),
  };
  if (card.editedAt !== null) obj.editedAt = encodeDate(card.editedAt);
  if (card.seenAt !== null) obj.seenAt = encodeDate(card.seenAt);
  if (card.swiped !== null) obj.swiped = card.swiped;
  obj.isFavorite = card.isFavorite;
  if (card.favoritedAt !== null) obj.favoritedAt = encodeDate(card.favoritedAt);
  obj.reviewCount = card.reviewCount;
  obj.masteryLevel = card.masteryLevel;
  if (card.lastReviewedAt !== null) obj.lastReviewedAt = encodeDate(card.lastReviewedAt);
  obj.repetition = card.repetition;
  obj.intervalDays = card.intervalDays;
  obj.easeFactor = card.easeFactor;
  if (card.stability > 0) obj.stability = card.stability;
  if (card.difficulty > 0) obj.difficulty = card.difficulty;
  if (card.subject) obj.subject = card.subject;
  if (card.branch) obj.branch = card.branch;
  if (card.level !== null) obj.level = card.level;
  if (card.track) obj.track = card.track;
  if (card.orderKey) obj.orderKey = card.orderKey;
  if (card.prereq.length > 0) obj.prereq = card.prereq;
  if (card.materialId) obj.materialId = card.materialId;
  if (card.tags?.length) obj.tags = card.tags;
  return obj;
}

/** 主文件解码。任一元素不是对象则整文件失败，交给备份。空数组也视为没有可用库。 */
export function decodeCardList(text: string): KnowledgeCard[] {
  const root = JSON.parse(text) as unknown;
  if (!Array.isArray(root)) throw new Error("cards.json 不是数组");
  const cards = root.map((item) => cardFromJson(item));
  if (cards.length === 0) throw new Error("cards.json 是空数组");
  return cards;
}

export function encodeCardList(cards: KnowledgeCard[]): string {
  return JSON.stringify(cards.map(cardToJson));
}

/**
 * 加载顺序与 `CardStorage.loadCards` 一致：主文件、一代备份、二代备份。
 * 空文本和空数组都继续往下找。
 */
export function loadCardList(files: {
  main: string | null;
  backup: string | null;
  backup2: string | null;
}): { cards: KnowledgeCard[]; recoveredFrom: "main" | "backup" | "backup2" | "empty" } {
  for (const [name, text] of [
    ["main", files.main],
    ["backup", files.backup],
    ["backup2", files.backup2],
  ] as const) {
    if (!text) continue;
    try {
      return { cards: decodeCardList(text), recoveredFrom: name };
    } catch {
      continue;
    }
  }
  return { cards: [], recoveredFrom: "empty" };
}

/** 划走。右划补收藏，左划取消收藏，skip 不动收藏。已有 seenAt 保持原时间。 */
export function swipeCard(card: KnowledgeCard, direction: SwipeDirection, now = Date.now()): KnowledgeCard {
  let next: KnowledgeCard = {
    ...card,
    seenAt: card.seenAt ?? now,
    swiped: direction,
  };
  if (direction === "right" && !next.isFavorite) {
    next = { ...next, isFavorite: true, favoritedAt: now };
  } else if (direction === "left" && next.isFavorite) {
    next = { ...next, isFavorite: false, favoritedAt: null };
  }
  return next;
}

/** 撤销只还原 seenAt / swiped，收藏保持划之后的状态。 */
export function undoSwipe(current: KnowledgeCard, before: KnowledgeCard): KnowledgeCard {
  return { ...current, seenAt: before.seenAt, swiped: before.swiped };
}

/** 重新探索：清空 seenAt，保留收藏与 swiped（与 `CardStore.clearHistory` 一致）。 */
export function clearHistory(cards: KnowledgeCard[]): KnowledgeCard[] {
  return cards.map((card) => (card.seenAt === null ? card : { ...card, seenAt: null }));
}

export function unseenDeck(cards: KnowledgeCard[], enableAI: boolean, preferredCategories: string[]): KnowledgeCard[] {
  const unseen = cards.filter((card) => card.seenAt === null);
  const sourced = enableAI ? unseen : unseen.filter((card) => card.source !== "ai");
  if (preferredCategories.length === 0) return sourced;
  const preferred = sourced.filter((card) => preferredCategories.includes(card.category));
  return preferred.length > 0 ? preferred : sourced;
}

export { arrange } from "./cardArrange";
