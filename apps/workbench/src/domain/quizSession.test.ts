import { describe, expect, it } from "vitest";
import { cardFromJson } from "./card";
import { quizSessionView } from "./quizSession";

describe("quiz session", () => {
  const cards = [
    cardFromJson({ id: "a", headline: "甲" }),
    cardFromJson({ id: "b", headline: "乙" }),
  ];

  it("reports empty, active, complete, and stale states", () => {
    expect(quizSessionView(cards, [], 0).kind).toBe("empty");
    expect(quizSessionView(cards, ["a", "b"], 0)).toMatchObject({ kind: "active", index: 0, total: 2 });
    expect(quizSessionView(cards, ["a", "b"], 2)).toMatchObject({ kind: "complete", total: 2 });
    expect(quizSessionView(cards, ["missing"], 0).kind).toBe("stale");
  });
});
