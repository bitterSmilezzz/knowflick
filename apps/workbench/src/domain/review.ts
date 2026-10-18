import type { KnowledgeCard } from "./card";

export type SpacedRating = "again" | "hard" | "good" | "easy";
export type SpacedAlgorithm = "sm2" | "fsrs";

export interface ReviewResult {
  repetition: number;
  intervalDays: number;
  easeFactor: number;
  masteryLevel: number;
  lastReviewedAt: number;
  stability: number;
  difficulty: number;
}

const RATINGS: SpacedRating[] = ["again", "hard", "good", "easy"];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function qualityOf(rating: SpacedRating): number {
  if (rating === "again") return 1;
  if (rating === "hard") return 3;
  if (rating === "good") return 4;
  return 5;
}

export function calculateSm2(card: KnowledgeCard, rating: SpacedRating, now: number): ReviewResult {
  const q = qualityOf(rating);
  const prevRepetition = card.repetition;
  const prevInterval = Math.max(1, card.intervalDays);
  const prevEf = clamp(card.easeFactor, 1.3, 3);
  let newRepetition: number;
  let newInterval: number;
  if (q < 3) {
    newRepetition = 0;
    newInterval = 1;
  } else {
    newRepetition = prevRepetition + 1;
    if (newRepetition === 1) newInterval = rating === "easy" ? 2 : 1;
    else if (newRepetition === 2) newInterval = rating === "hard" ? 3 : rating === "easy" ? 8 : 6;
    else {
      const multiplier = rating === "hard" ? 1.2 : rating === "easy" ? prevEf * 1.3 : prevEf;
      newInterval = Math.max(prevInterval + 1, Math.round(prevInterval * multiplier));
    }
  }
  const deltaEf = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
  const newEf = clamp(round2(prevEf + deltaEf), 1.3, 3);
  const mastery = rating === "again" ? 0 : rating === "hard" ? 1 : 2;
  return {
    repetition: newRepetition,
    intervalDays: newInterval,
    easeFactor: newEf,
    masteryLevel: mastery,
    lastReviewedAt: now,
    stability: card.stability,
    difficulty: card.difficulty,
  };
}

const INITIAL_S = [0.4, 1.2, 3.1, 8.5];
const FACTOR = 19 / 81;
const DECAY = -0.5;

export function fsrsRetrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0 || elapsedDays <= 0) return 1;
  return clamp((1 + FACTOR * (elapsedDays / stability)) ** DECAY, 0, 1);
}

function fsrsInterval(stability: number, requestRetention = 0.9): number {
  if (stability <= 0) return 1;
  const r = clamp(requestRetention, 0.7, 0.98);
  const interval = (stability / FACTOR) * (r ** (1 / DECAY) - 1);
  return Math.max(1, Math.round(interval));
}

export function calculateFsrs(card: KnowledgeCard, rating: SpacedRating, now: number): ReviewResult {
  const lastReviewed = card.lastReviewedAt ?? card.createdAt;
  const elapsedDays = Math.max(0, (now - lastReviewed) / 86_400_000);
  const currentS = card.stability > 0 ? card.stability : Math.max(1, card.intervalDays);
  const currentD = card.difficulty >= 1 && card.difficulty <= 10
    ? card.difficulty
    : clamp(3 - (card.easeFactor - 1.3) * 1.5, 1, 10);
  const currentR = fsrsRetrievability(elapsedDays, currentS);
  const first = card.repetition === 0 && card.stability <= 0;
  const grade = RATINGS.indexOf(rating);
  let newS: number;
  let newD: number;
  if (first) {
    newS = INITIAL_S[grade] ?? 0.4;
    newD = rating === "again" ? 7 : rating === "hard" ? 5.5 : rating === "good" ? 4 : 2.5;
  } else {
    const gradeDelta = rating === "again" ? 2 : rating === "hard" ? 1 : rating === "easy" ? -1 : 0;
    newD = clamp(0.1 * 4 + 0.9 * (currentD + gradeDelta), 1, 10);
    if (rating === "again") {
      newS = Math.max(0.3, 0.25 * newD ** -0.3 * (currentS + 1) ** 0.2 * Math.exp(0.5 * (1 - currentR)));
    } else {
      const hardBonus = rating === "hard" ? 0.8 : 1;
      const easyBonus = rating === "easy" ? 1.3 : 1;
      const reward = Math.exp(2.4) * (11 - newD) * currentS ** -0.2 * (Math.exp(1 - currentR) - 0.4) * hardBonus * easyBonus;
      const bounded = clamp(reward / 10, 0.1, 5);
      newS = Math.max(currentS + 0.5, currentS * (1 + bounded));
    }
  }
  const nextInterval = fsrsInterval(newS);
  const newRepetition = rating === "again" ? 0 : card.repetition + 1;
  const mastery = newRepetition >= 3 || nextInterval >= 14 ? 2 : newRepetition >= 1 ? 1 : 0;
  return {
    repetition: newRepetition,
    intervalDays: nextInterval,
    easeFactor: clamp(3 - (newD - 1) * 0.18, 1.3, 3),
    masteryLevel: mastery,
    lastReviewedAt: now,
    stability: newS,
    difficulty: newD,
  };
}

export function calculateReview(card: KnowledgeCard, rating: SpacedRating, algorithm: SpacedAlgorithm, now = Date.now()): ReviewResult {
  return algorithm === "fsrs" ? calculateFsrs(card, rating, now) : calculateSm2(card, rating, now);
}

export function previewIntervals(card: KnowledgeCard, algorithm: SpacedAlgorithm, now = Date.now()): Record<SpacedRating, number> {
  return {
    again: calculateReview(card, "again", algorithm, now).intervalDays,
    hard: calculateReview(card, "hard", algorithm, now).intervalDays,
    good: calculateReview(card, "good", algorithm, now).intervalDays,
    easy: calculateReview(card, "easy", algorithm, now).intervalDays,
  };
}

export function applyReview(card: KnowledgeCard, result: ReviewResult): KnowledgeCard {
  return {
    ...card,
    reviewCount: card.reviewCount + 1,
    repetition: result.repetition,
    intervalDays: result.intervalDays,
    easeFactor: result.easeFactor,
    masteryLevel: Math.min(2, Math.max(0, result.masteryLevel)),
    lastReviewedAt: result.lastReviewedAt,
    stability: result.stability > 0 ? result.stability : card.stability,
    difficulty: result.difficulty > 0 ? result.difficulty : card.difficulty,
  };
}

export function localDay(epoch: number): string {
  const date = new Date(epoch);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(year, (month ?? 1) - 1, date ?? 1);
  value.setDate(value.getDate() + days);
  return localDay(value.getTime());
}

export function todayStamp(now = Date.now()): string {
  return localDay(now);
}

/** 下次复习日。没看过的卡没有到期日。 */
export function reviewDay(card: KnowledgeCard): string | null {
  const last = card.lastReviewedAt ?? card.seenAt;
  if (last === null) return null;
  const lastDay = localDay(last);
  let days: number;
  if (card.lastReviewedAt === null) days = 1;
  else if (card.intervalDays > 1) days = card.intervalDays;
  else if (card.masteryLevel >= 2) days = 7;
  else if (card.masteryLevel === 1) days = 3;
  else days = 1;
  return addDays(lastDay, days);
}

export function dueCards(cards: KnowledgeCard[], today = todayStamp()): KnowledgeCard[] {
  return cards
    .flatMap((card) => {
      const day = reviewDay(card);
      return day ? [{ card, day }] : [];
    })
    .sort((a, b) => a.day.localeCompare(b.day) || a.card.id.localeCompare(b.card.id))
    .filter((item) => item.day <= today)
    .map((item) => item.card);
}

export function buildQuiz(cards: KnowledgeCard[], today = todayStamp(), limit = 10): KnowledgeCard[] {
  const due = dueCards(cards, today);
  const dueIds = new Set(due.map((card) => card.id));
  const favorites = cards.filter((card) => card.isFavorite && !dueIds.has(card.id));
  const favoriteIds = new Set(favorites.map((card) => card.id));
  const history = cards.filter((card) => card.seenAt !== null && !dueIds.has(card.id) && !favoriteIds.has(card.id));
  const historyIds = new Set(history.map((card) => card.id));
  const rest = cards.filter((card) => !dueIds.has(card.id) && !favoriteIds.has(card.id) && !historyIds.has(card.id));
  return [...due, ...favorites, ...history, ...rest].slice(0, Math.max(0, limit));
}
