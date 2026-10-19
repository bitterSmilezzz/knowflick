import { useState } from "react";
import { quizSessionView } from "../domain/quizSession";
import { applyReview, buildQuiz, calculateReview, dueCards, previewIntervals, todayStamp, type SpacedAlgorithm, type SpacedRating } from "../domain/review";
import type { KnowledgeCard } from "../domain/card";

export function QuizView({
  cards,
  algorithm,
  dueOnly = false,
  onChange,
}: {
  cards: KnowledgeCard[];
  algorithm: SpacedAlgorithm;
  dueOnly?: boolean;
  onChange: (cards: KnowledgeCard[]) => Promise<void>;
}) {
  const today = todayStamp();
  const [ids, setIds] = useState<string[] | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const defaultQueue = dueOnly
    ? dueCards(cards, today).map((card) => card.id)
    : buildQuiz(cards, today).map((card) => card.id);
  const queueIds = ids ?? defaultQueue;
  const session = quizSessionView(cards, queueIds, index);
  if (session.kind === "empty") {
    return (
      <div className="ws-empty">
        <div>
          <p>没有可以复习的卡片</p>
          <p style={{ fontSize: 12 }}>先收藏或整理出几张知识卡。</p>
        </div>
      </div>
    );
  }
  if (session.kind === "complete") {
    return (
      <div className="ws-empty">
        <div>
          <p>本轮复习完成，共 {session.total} 张</p>
          <p style={{ fontSize: 12 }}>明天到期的卡片会再出现在队列里。</p>
          <button type="button" className="ws-primary" onClick={() => { setIds(null); setIndex(0); setError(""); }}>再来一轮</button>
        </div>
      </div>
    );
  }
  if (session.kind === "stale") {
    return (
      <div className="ws-empty">
        <div>
          <p>复习队列已过期</p>
          <p style={{ fontSize: 12 }}>知识库有变动，请重新开始。</p>
          <button type="button" className="ws-primary" onClick={() => { setIds(null); setIndex(0); }}>重新开始</button>
        </div>
      </div>
    );
  }
  const { card } = session;
  const preview = previewIntervals(card, algorithm);
  const labels: Array<[SpacedRating, string]> = [["again", "重来"], ["hard", "较难"], ["good", "良好"], ["easy", "容易"]];
  return (
    <div className="ws-reader-scroll">
      <div className="ws-reader-inner">
        <div className="ws-reader-meta">
          <span>{card.category}</span>
          <span>·</span>
          <span>{session.index + 1} / {session.total}</span>
        </div>
        <h1>{card.headline}</h1>
        {card.summary ? <div className="ws-byline">{card.summary}</div> : null}
        <div className="ws-prose" style={{ marginTop: 16 }}>
          {card.details.split(/\n{2,}/).filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}
        </div>
        {error ? <div className="ws-feedback" role="alert"><span>{error}</span></div> : null}
        <div className="ws-editor-actions" style={{ marginTop: 26 }}>
          {labels.map(([rating, label]) => (
            <button
              key={rating}
              type="button"
              className={rating === "good" ? "ws-primary" : "ws-bordered"}
              onClick={() => {
                const next = cards.map((item) => item.id === card.id ? applyReview(item, calculateReview(item, rating, algorithm)) : item);
                if (ids === null) setIds(queueIds);
                onChange(next).then(() => setIndex((value) => value + 1)).catch((err: unknown) => setError(String(err)));
              }}
            >
              {label} · {preview[rating]} 天
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
