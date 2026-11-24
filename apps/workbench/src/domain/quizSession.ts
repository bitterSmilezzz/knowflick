import type { KnowledgeCard } from "./card";

export type QuizSessionView =
  | { kind: "empty" }
  | { kind: "complete"; total: number }
  | { kind: "stale" }
  | { kind: "active"; card: KnowledgeCard; index: number; total: number };

export function quizSessionView(
  cards: KnowledgeCard[],
  queueIds: string[],
  index: number,
): QuizSessionView {
  if (queueIds.length === 0) return { kind: "empty" };
  if (index >= queueIds.length) return { kind: "complete", total: queueIds.length };
  const card = cards.find((item) => item.id === queueIds[index]);
  if (!card) return { kind: "stale" };
  return { kind: "active", card, index, total: queueIds.length };
}
