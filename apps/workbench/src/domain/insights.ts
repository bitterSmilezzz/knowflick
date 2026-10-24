import type { RawMaterial } from "../shell/store";
import type { KnowledgeCard } from "./card";

export type SourceKind = "mailAccount" | "mailSender" | "subscription" | "host" | "local";

export interface SourceProfile {
  /** Stable identity, e.g. `mail:<accountId>`, `sender:<address>`, `host:<hostname>`. */
  key: string;
  label: string;
  kind: SourceKind;
  itemCount: number;
  /** Explicit actions, never inferred. */
  converted: number;
  favorited: number;
  ignored: number;
  reviewed: number;
  /** `score` normalised to 0..1 for ordering only. */
  score: number;
  /** One sentence the user can verify against what they actually did. */
  reason: string;
}
export interface SourceInsightSet {
  total: number;
  /** Highest score first; a source with no signal keeps score 0 and sits below. */
  ranked: SourceProfile[];
}

/** Action weights, surfaced in the UI so the ranking is explainable. */
export const SOURCE_WEIGHTS = { converted: 5, favorited: 3, reviewed: 2 } as const;
/** A source the user has not acted on yet is neither good nor bad. */
export const NEUTRAL_SCORE = 0.5;
/** How much an explicit "ignore" pushes a source down. */
export const IGNORED_PENALTY = 0.6;
/** Content older than this stops contributing, so stale behaviour cannot dominate. */
export const INSIGHT_WINDOW_DAYS = 90;

/** Content older than the window is ignored outright, not merely down-weighted. */
function inWindow(material: RawMaterial, now: number): boolean {
  const stamp = Math.max(material.updatedAt || 0, material.createdAt || 0);
  return now - stamp <= INSIGHT_WINDOW_DAYS * 86_400_000;
}

/** Recency weight inside the window: 1 for this week's content, 0.2 at the edge. */
function recency(material: RawMaterial, now: number): number {
  const stamp = Math.max(material.updatedAt || 0, material.createdAt || 0);
  const age = Math.max(0, now - stamp) / 86_400_000;
  return Math.max(0.2, 1 - age / INSIGHT_WINDOW_DAYS);
}

function parseMeta(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}
function text(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/** Identity of the *group* a piece of content came from. */
export function sourceKeyOf(material: RawMaterial): string {
  const meta = parseMeta(material.metadataJson);
  const accountId = text(meta.mailAccountId) || text(meta.accountId);
  if (material.sourceType === "email" && accountId) return `mail:${accountId}`;
  const subscriptionId = text(meta.subscriptionId);
  if (subscriptionId) return `subscription:${subscriptionId}`;
  const url = material.sourceUrl ?? "";
  if (url.startsWith("http")) {
    try { return `host:${new URL(url).hostname.replace(/^www\./, "")}`; }
    catch { /* fall through to the type-based key */ }
  }
  return material.sourceType || "local";
}

export function senderKeyOf(material: RawMaterial): string | null {
  if (material.sourceType !== "email") return null;
  const from = text(parseMeta(material.metadataJson).from);
  if (!from) return null;
  const address = (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
  return address ? `sender:${address}` : null;
}

export function sourceKindOf(key: string): SourceKind {
  if (key.startsWith("mail:")) return "mailAccount";
  if (key.startsWith("sender:")) return "mailSender";
  if (key.startsWith("subscription:")) return "subscription";
  if (key.startsWith("host:")) return "host";
  return "local";
}

/** Labels the user already sees in the source filter. */
export function sourceLabelOf(key: string): string {
  const kind = sourceKindOf(key);
  const value = kind === "local" ? key : key.slice(key.indexOf(":") + 1);
  if (kind === "mailAccount") return `邮箱账号 ${value.slice(0, 8)}`;
  if (kind === "mailSender") return value;
  if (kind === "host") return value || "网页剪藏";
  if (value === "manual") return "闪念";
  if (value === "document") return "导入文档";
  if (value === "email-digest") return "邮件归纳";
  return value || "内容";
}

export interface InsightInput {
  materials: RawMaterial[];
  cards: KnowledgeCard[];
  now?: number;
}

/**
 * Turns what the user *did* into per-source weights.
 *
 * Only explicit signals count: turned into a card, favourited, ignored, or
 * reviewed. Nothing is inferred from reading time, so every score can be
 * explained in one sentence the user can verify.
 */
export function sourceInsights({ materials, cards, now = Date.now() }: InsightInput): SourceInsightSet {
  const materialById = new Map(materials.map(material => [material.id, material]));
  const profiles = new Map<string, MutableProfile>();
  const bucket = (key: string): MutableProfile => {
    const existing = profiles.get(key);
    if (existing) return existing;
    const created: MutableProfile = {
      key, label: sourceLabelOf(key), kind: sourceKindOf(key),
      itemCount: 0, converted: 0, favorited: 0, ignored: 0, reviewed: 0, weight: 0,
    };
    profiles.set(key, created);
    return created;
  };

  for (const material of materials) {
    // A mail digest is itself derived content, not a source.
    if (material.sourceType === "email-digest") continue;
    // Outside the window the content is not counted at all: a source the user
    // stopped caring about a year ago must not keep a high score.
    if (!inWindow(material, now)) continue;
    const groupKey = sourceKeyOf(material);
    const group = bucket(groupKey);
    group.itemCount += 1;
    if (material.inboxStatus === "dismissed") {
      group.ignored += 1;
      group.weight -= IGNORED_PENALTY;
    }
    const sender = senderKeyOf(material);
    if (sender) {
      const profile = bucket(sender);
      profile.itemCount += 1;
      if (material.inboxStatus === "dismissed") { profile.ignored += 1; profile.weight -= IGNORED_PENALTY; }
    }
  }

  // Favourite and review state live on cards, so attribute them back to the
  // material (and therefore the source) the card came from.
  for (const card of cards) {
    if (!card.materialId) continue;
    const material = materialById.get(card.materialId);
    if (!material || !inWindow(material, now)) continue;
    const weight = recency(material, now);
    for (const key of [sourceKeyOf(material), senderKeyOf(material)].filter((value): value is string => !!value)) {
      const profile = bucket(key);
      // The card itself is the "kept it" signal: turning mail into a card means
      // the user considered it worth keeping. Favourite and review are counted
      // separately and never stack on top of it — a favourited card is still one
      // card, and counting it twice would make a favourite look like two wins.
      profile.converted += 1;
      profile.weight += SOURCE_WEIGHTS.converted * weight;
      if (card.isFavorite) { profile.favorited += 1; }
      // Review is recorded for the report only: a card that has been reviewed is
      // already counted as "kept", and giving it extra weight would make
      // long-studied-but-not-kept material outrank fresh conversions.
      if (card.reviewCount > 0) { profile.reviewed += 1; }
    }
  }

  // Normalise inside each kind: an account profile aggregates every mail it
  // received, so comparing its raw weight with a single sender's weight would
  // make the account look unbeatable. Users compare senders with senders.
  const maxByKind = new Map<SourceKind, number>();
  for (const profile of profiles.values()) {
    const current = maxByKind.get(profile.kind) ?? 0;
    maxByKind.set(profile.kind, Math.max(current, Math.abs(profile.weight)));
  }
  const ranked: SourceProfile[] = [...profiles.values()]
    .map(profile => ({
      key: profile.key, label: profile.label, kind: profile.kind, itemCount: profile.itemCount,
      converted: profile.converted, favorited: profile.favorited, ignored: profile.ignored,
      reviewed: profile.reviewed,
      // Neutral sources sit in the middle; only explicit signal moves them.
      // An explicit ignore is a signal too — downwards.
      score: profile.converted || profile.favorited || profile.reviewed
        ? Math.max(0, profile.weight) / Math.max(1, maxByKind.get(profile.kind) ?? 1)
        : profile.ignored
          ? Math.max(0, NEUTRAL_SCORE - IGNORED_PENALTY * Math.min(1, profile.ignored))
          : NEUTRAL_SCORE,
      reason: explain(profile),
    }))
    .sort((a, b) => b.score - a.score || b.itemCount - a.itemCount || a.label.localeCompare(b.label, "zh-Hans-CN"));
  return { total: ranked.length, ranked };
}

interface MutableProfile {
  key: string; label: string; kind: SourceKind;
  itemCount: number; converted: number; favorited: number; ignored: number; reviewed: number; weight: number;
}

function explain(profile: MutableProfile): string {
  const parts: string[] = [];
  if (profile.converted) parts.push(`${profile.converted} 条已沉淀为知识卡`);
  if (profile.favorited) parts.push(`${profile.favorited} 张卡已收藏`);
  if (profile.reviewed) parts.push(`${profile.reviewed} 张卡已复习`);
  if (profile.ignored) parts.push(`${profile.ignored} 条已忽略`);
  if (!parts.length) return `${profile.itemCount} 条内容，还没有收藏、沉淀或复习`;
  return `${profile.itemCount} 条内容：${parts.join("，")}`;
}

/**
 * Ranking weight for one mail, used to lift mail from senders whose mail was
 * turned into knowledge before. Returns 0 when the source has no positive
 * signal, so ordering falls back to the existing newest-first rule.
 */
export function senderWeight(material: RawMaterial, profiles: SourceProfile[]): number {
  const key = senderKeyOf(material);
  if (!key) return 0;
  const profile = profiles.find(candidate => candidate.key === key);
  if (!profile || profile.converted === 0) return 0;
  return profile.score;
}
