import { useEffect, useState } from "react";
import { LoadReviewDeck, ReadReviewHistoryPeriod, RecordReview } from "./bindings/knowflick.local/workbench-go/previewservice";
import type { Card } from "./bindings/knowflick.local/workbench-go/internal/cards/models";
import { Algorithm, Rating } from "./bindings/knowflick.local/workbench-go/internal/reviewhistory/models";
import type { Snapshot } from "./bindings/knowflick.local/workbench-go/internal/reviewhistory/models";
import type { KnowledgeCard } from "../src/domain/card";
import { isReviewProjectID, type ReviewEvent } from "../src/domain/reviewHistory";
import { setSoundEffectsEnabled } from "../src/shell/sounds";
import { QuizView, ReviewOverviewPanel } from "../src/ui/StudyViews";

function studyCard(card: Card): KnowledgeCard {
  const source = card.source === "ai" || card.source === "imported" ? card.source : "seed";
  const swiped = card.swiped === "left" || card.swiped === "right" || card.swiped === "skip" ? card.swiped : null;
  return { ...card, source, swiped, links: card.links ?? [], tags: card.tags ?? [], prereq: card.prereq ?? [] };
}

const eventRatings = { again: Rating.RatingAgain, hard: Rating.RatingHard, good: Rating.RatingGood, easy: Rating.RatingEasy };
const eventAlgorithms = { sm2: Algorithm.AlgorithmSm2, fsrs: Algorithm.AlgorithmFsrs };
const ratings: Record<string, string> = { again: "重来", hard: "困难", good: "良好", easy: "简单" };

export function ReviewDeck({ generation, writable, onSaving }: {
  generation: number;
  writable: boolean;
  onSaving: (saving: boolean) => void;
}) {
  const [cards, setCards] = useState<KnowledgeCard[] | null>(null);
  const [projects, setProjects] = useState<Record<string, string[] | null | undefined> | null>(null);
  const [history, setHistory] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"review" | "quiz">("review");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const deck = await LoadReviewDeck(generation);
        if (!active) return;
        setCards((deck.cards ?? []).map(studyCard));
        setProjects(deck.projects);
        setSoundEffectsEnabled(deck.soundEnabled);
      } catch (cause) {
        if (active) setError("读取复习卡片失败：" + String(cause));
      }
    })();
    return () => { active = false; };
  }, [generation]);

  useEffect(() => {
    let active = true;
    const now = Date.now();
    void (async () => {
      try {
        const snapshot = await ReadReviewHistoryPeriod(generation, now - 30 * 86_400_000, now);
        if (active) {
          setHistory(snapshot);
          setHistoryError("");
        }
      } catch (cause) {
        if (active) setHistoryError("读取复习记录失败：" + String(cause));
      }
    })();
    return () => { active = false; };
  }, [generation, refresh]);

  async function saveReview(next: KnowledgeCard[], event?: ReviewEvent) {
    const card = event && next.find((item) => item.id === event.cardId);
    if (!event || !card) throw new Error("缺少复习事件或卡片");
    setSaving(true);
    onSaving(true);
    try {
      const { id, reviewCount, masteryLevel, lastReviewedAt, repetition, intervalDays, easeFactor, stability, difficulty } = card;
      await RecordReview(generation, { id, reviewCount, masteryLevel, lastReviewedAt, repetition, intervalDays, easeFactor, stability, difficulty }, {
        ...event,
        rating: eventRatings[event.rating],
        algorithm: eventAlgorithms[event.algorithm],
      });
      setCards(next);
      setRefresh((value) => value + 1);
    } finally {
      setSaving(false);
      onSaving(false);
    }
  }

  return (
    <section className="preview-study" aria-label="卡片复习">
      {error && <p className="preview-error" role="alert">{error}</p>}
      {!cards && !error && <p role="status">正在读取复习卡片…</p>}
      {cards && <>
        <ReviewOverviewPanel cards={cards} />
        {writable ? <>
          <label>练习方式 <select value={mode} disabled={saving} onChange={(event) => setMode(event.target.value === "quiz" ? "quiz" : "review")}>
            <option value="review">按计划复习</option>
            <option value="quiz">测验</option>
          </select></label>
          <QuizView key={mode} cards={cards} algorithm="fsrs" dueOnly={mode === "review"} onChange={saveReview} recordHistory
            projectContext={(card) => {
              const linked = card.materialId ? projects?.[card.materialId] ?? [] : [];
              const projectIds = linked.filter(isReviewProjectID);
              return { projectIds, complete: projects !== null && projectIds.length === linked.length };
            }} />
        </> : <p className="preview-meta">启用编辑后可以评分。</p>}
      </>}
      <details>
        <summary>最近 30 天复习记录</summary>
        {historyError && <p className="preview-error" role="alert">{historyError}</p>}
        {!history && !historyError && <p role="status">正在读取复习记录…</p>}
        {history && !historyError && <>
          <p>共 {history.events?.length ?? 0} 次评分。账本自 {new Date(history.coverageStartedAt).toLocaleString("zh-CN")} 起记录。</p>
          {history.events && history.events.length > 0 && (
            <ul aria-label="最近十次评分">
              {history.events.slice(-10).reverse().map((event) => (
                <li key={event.id}>{new Date(event.reviewedAt).toLocaleString("zh-CN")} · {cards?.find((card) => card.id === event.cardId)?.headline || event.cardId} · {ratings[event.rating]}</li>
              ))}
            </ul>
          )}
        </>}
      </details>
    </section>
  );
}
