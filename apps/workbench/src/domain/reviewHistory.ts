import type { SpacedAlgorithm, SpacedRating } from "./review";

export interface ReviewEvent {
  id: string;
  cardId: string;
  reviewedAt: number;
  rating: SpacedRating;
  algorithm: SpacedAlgorithm;
  projectIds: string[];
  projectAttributionComplete: boolean;
}

export interface ReviewHistorySnapshot {
  version: 1;
  coverageStartedAt: number;
  events: ReviewEvent[];
}

export interface ReviewRestoreCounts {
  inserted: number;
  skipped: number;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RATINGS = new Set<SpacedRating>(["again", "hard", "good", "easy"]);
const ALGORITHMS = new Set<SpacedAlgorithm>(["sm2", "fsrs"]);

function uuidV4(): string {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("当前环境无法安全生成复习事件标识");
  }
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createReviewEvent(input: {
  cardId: string;
  reviewedAt: number;
  rating: SpacedRating;
  algorithm: SpacedAlgorithm;
  projectIds: readonly string[];
  projectAttributionComplete: boolean;
}): ReviewEvent {
  const event: ReviewEvent = {
    id: uuidV4(),
    cardId: input.cardId,
    reviewedAt: input.reviewedAt,
    rating: input.rating,
    algorithm: input.algorithm,
    projectIds: [...new Set(input.projectIds)].sort(),
    projectAttributionComplete: input.projectAttributionComplete,
  };
  validateReviewEvent(event);
  return event;
}

export function isReviewProjectID(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

function validateReviewEvent(value: unknown): ReviewEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("复习事件结构无效");
  const row = value as Record<string, unknown>;
  const keys = "algorithm,cardId,id,projectAttributionComplete,projectIds,rating,reviewedAt";
  if (Object.keys(row).sort().join(",") !== keys || typeof row.id !== "string" || !UUID_V4.test(row.id) ||
      typeof row.cardId !== "string" || !row.cardId || row.cardId.length > 256 || /[\u0000-\u001f\u007f-\u009f]/.test(row.cardId) ||
      !Number.isSafeInteger(row.reviewedAt) || (row.reviewedAt as number) < 0 || !RATINGS.has(row.rating as SpacedRating) ||
      !ALGORITHMS.has(row.algorithm as SpacedAlgorithm) || typeof row.projectAttributionComplete !== "boolean" || !Array.isArray(row.projectIds)) {
    throw new Error("复习事件字段无效");
  }
  const projects = row.projectIds as unknown[];
  if (projects.some((id) => !isReviewProjectID(id)) ||
      projects.some((id, index) => index > 0 && String(projects[index - 1]) >= String(id))) {
    throw new Error("复习事件项目归属无效");
  }
  return value as ReviewEvent;
}

export function validateReviewHistory(value: unknown): ReviewHistorySnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("复习历史快照结构无效");
  const snapshot = value as Record<string, unknown>;
  if (Object.keys(snapshot).sort().join(",") !== "coverageStartedAt,events,version" || snapshot.version !== 1 ||
      !Number.isSafeInteger(snapshot.coverageStartedAt) || (snapshot.coverageStartedAt as number) < 0 || !Array.isArray(snapshot.events)) {
    throw new Error("复习历史快照字段无效");
  }
  const ids = new Set<string>();
  const events = snapshot.events.map((raw) => {
    const event = validateReviewEvent(raw);
    if (ids.has(event.id)) throw new Error("复习历史包含重复事件标识");
    ids.add(event.id);
    return event;
  });
  return { version: 1, coverageStartedAt: snapshot.coverageStartedAt as number, events };
}
