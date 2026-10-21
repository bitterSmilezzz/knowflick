import { useEffect, useState } from "react";
import { quizSessionView } from "../domain/quizSession";
import {
  applyReview,
  buildQuiz,
  calculateReview,
  reviewQueue,
  previewIntervals,
  todayStamp,
  type SpacedAlgorithm,
  type SpacedRating,
} from "../domain/review";
import { reviewOverview, dueForecast } from "../domain/reviewStats";
import type { KnowledgeCard } from "../domain/card";
import { Icon } from "./workspace/Icon";

/** 掌握度与到期负荷面板：回答「我学到什么程度了、接下来几天有多少要复习」。 */
export function ReviewOverviewPanel({ cards }: { cards: KnowledgeCard[] }) {
  const today = todayStamp();
  const overview = reviewOverview(cards, today);
  const forecast = dueForecast(cards, today, 7);
  const peak = Math.max(1, ...forecast.map((d) => d.count));

  return (
    <section className="ws-review-overview" aria-label="复习统计">
      <div className="ws-review-overview-kpis">
        <div>
          <span>今日待复习</span>
          <strong>{overview.dueToday}</strong>
        </div>
        <div>
          <span>已复习</span>
          <strong>{overview.reviewedCards}</strong>
        </div>
        <div>
          <span>尚未复习</span>
          <strong>{overview.neverReviewed}</strong>
        </div>
        <div>
          <span>平均间隔</span>
          <strong>{overview.averageIntervalDays} 天</strong>
        </div>
      </div>

      <div className="ws-review-mastery">
        <h3>掌握度分布</h3>
        <div className="ws-review-mastery-bars">
          {overview.masteryBuckets.map((bucket) => (
            <div key={bucket.label} className="ws-review-mastery-item">
              <span className="ws-review-mastery-label">{bucket.label}</span>
              <div className="ws-review-mastery-track">
                <i
                  style={{
                    width: `${overview.totalCards === 0 ? 0 : (bucket.count / overview.totalCards) * 100}%`,
                  }}
                />
              </div>
              <span className="ws-review-mastery-count">{bucket.count}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="ws-review-forecast">
        <h3>未来 7 天到期负荷</h3>
        <div className="ws-review-forecast-row">
          {forecast.map((day, index) => (
            <div key={day.day} className="ws-review-forecast-col" title={`${day.day}：${day.count} 张`}>
              <span className="ws-review-forecast-count">{day.count > 0 ? day.count : ""}</span>
              <i style={{ height: `${Math.max(3, (day.count / peak) * 100)}%` }} />
              <span className="ws-review-forecast-day">{index === 0 ? "今天" : day.day.slice(5)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

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
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState("");
  // 默认按记忆算法的安排复习；「额外练习」必须由用户显式选择，
  // 否则「今日待复习 0」下面紧接着出现一张待评分卡，用户会以为计数坏了。
  const [extraPractice, setExtraPractice] = useState(false);

  // 按计划复习 = 到期卡 + 从未过目的新卡；额外练习才用全库随机。
  const defaultQueue = dueOnly && !extraPractice
    ? reviewQueue(cards, today).map((card) => card.id)
    : buildQuiz(cards, today).map((card) => card.id);
  const queueIds = ids ?? defaultQueue;
  const session = quizSessionView(cards, queueIds, index);

  const rate = (rating: SpacedRating) => {
    if (session.kind !== "active") return;
    if (!revealed) {
      setRevealed(true);
      return;
    }
    const { card } = session;
    const next = cards.map((item) =>
      item.id === card.id
        ? applyReview(item, calculateReview(item, rating, algorithm))
        : item
    );
    if (ids === null) setIds(queueIds);
    setRevealed(false);
    onChange(next)
      .then(() => setIndex((value) => value + 1))
      .catch((err: unknown) => setError(String(err)));
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (session.kind !== "active") return;
      if (e.key === " " || e.key === "Enter") {
        if (!revealed) {
          e.preventDefault();
          setRevealed(true);
        }
      } else if (e.key === "1") {
        e.preventDefault();
        rate("again");
      } else if (e.key === "2") {
        e.preventDefault();
        rate("hard");
      } else if (e.key === "3") {
        e.preventDefault();
        rate("good");
      } else if (e.key === "4") {
        e.preventDefault();
        rate("easy");
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [session, revealed, ids, cards]);

  if (session.kind === "empty") {
    const total = cards.length;
    return (
      <div className="ws-review-container">
        <div className="ws-review-done-card">
          <Icon name="check" size={32} style={{ color: "var(--accent)", marginBottom: 12 }} />
          <h2>今天没有到期的卡片</h2>
          <p>
            {total > 0
              ? `记忆算法已把 ${total} 张卡排到之后的日期，按计划复习效果最好。想多练几张也可以。`
              : "知识库中目前没有需要复习的内容。多沉淀一些知识卡，记忆算法会自动安排温故节奏。"}
          </p>
          {total > 0 ? (
            <button
              type="button"
              className="ws-bordered"
              onClick={() => { setExtraPractice(true); setIds(null); setIndex(0); setRevealed(false); }}
            >
              仍要复习全部（额外练习）
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (session.kind === "complete") {
    return (
      <div className="ws-review-container">
        <div className="ws-review-done-card">
          <Icon name="check" size={36} style={{ color: "var(--accent)", marginBottom: 14 }} />
          <h2>本轮温故复习完成</h2>
          <p>共完成 {session.total} 张知识卡的提取练习。间隔重复算法已计算下次到期间隔。</p>
          <button
            type="button"
            className="ws-primary"
            style={{ marginTop: 16 }}
            onClick={() => {
              setIds(null);
              setIndex(0);
              setError("");
              setRevealed(false);
            }}
          >
            再来一轮温故
          </button>
        </div>
      </div>
    );
  }

  if (session.kind === "stale") {
    return (
      <div className="ws-review-container">
        <div className="ws-review-done-card">
          <h2>复习队列已更新</h2>
          <p>知识库卡片在此期间发生了变动，请重新开始本轮复习。</p>
          <button
            type="button"
            className="ws-primary"
            style={{ marginTop: 16 }}
            onClick={() => {
              setIds(null);
              setIndex(0);
              setRevealed(false);
            }}
          >
            重新开始
          </button>
        </div>
      </div>
    );
  }

  const { card } = session;
  const preview = previewIntervals(card, algorithm);
  const progressPct = Math.round(((session.index + 1) / session.total) * 100);

  return (
    <div className="ws-review-container">
      <div className="ws-review-wrapper">
        <div className="ws-review-progress-bar">
          <div className="ws-review-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>

        <div className="ws-review-header-row">
          <div className="ws-review-tags">
            <span className="ws-review-category">
              <Icon name="folder" size={13} />
              {card.category || "未分类"}
            </span>
            {card.tags?.slice(0, 3).map((t) => (
              <span key={t} className="ws-review-tag">
                # {t}
              </span>
            ))}
          </div>
          <span className="ws-review-counter">
            {session.index + 1} / {session.total}
          </span>
        </div>

        <article className="ws-review-card">
          <div className="ws-review-card-front">
            <span className="ws-review-eyebrow">提问与主题</span>
            <h1>{card.headline}</h1>
            {card.summary ? <p className="ws-review-summary">{card.summary}</p> : null}
          </div>

          {!revealed ? (
            <div className="ws-review-reveal-zone">
              <button
                type="button"
                className="ws-review-reveal-btn"
                onClick={() => setRevealed(true)}
              >
                <span>点击或按空格显示答案解析</span>
                <kbd>Space</kbd>
              </button>
            </div>
          ) : (
            <div className="ws-review-card-back">
              <span className="ws-review-eyebrow">详细解析</span>
              <div className="ws-prose">
                {card.details
                  .split(/\n{2,}/)
                  .filter(Boolean)
                  .map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
              </div>
            </div>
          )}
        </article>

        {error ? (
          <div className="ws-feedback" role="alert" style={{ margin: "12px 0" }}>
            <span>{error}</span>
          </div>
        ) : null}

        <footer className="ws-review-ratings">
          <button
            type="button"
            disabled={!revealed}
            className="ws-rating-btn rating-again"
            onClick={() => rate("again")}
          >
            <span className="rating-num">1</span>
            <strong>重来</strong>
            <small>{preview.again} 天</small>
          </button>
          <button
            type="button"
            disabled={!revealed}
            className="ws-rating-btn rating-hard"
            onClick={() => rate("hard")}
          >
            <span className="rating-num">2</span>
            <strong>较难</strong>
            <small>{preview.hard} 天</small>
          </button>
          <button
            type="button"
            disabled={!revealed}
            className="ws-rating-btn rating-good"
            onClick={() => rate("good")}
          >
            <span className="rating-num">3</span>
            <strong>良好</strong>
            <small>{preview.good} 天</small>
          </button>
          <button
            type="button"
            disabled={!revealed}
            className="ws-rating-btn rating-easy"
            onClick={() => rate("easy")}
          >
            <span className="rating-num">4</span>
            <strong>容易</strong>
            <small>{preview.easy} 天</small>
          </button>
        </footer>

        <div className="ws-review-kbd-hint">
          <span>{revealed ? "提示：按数字键 1–4 快速评分并进入下一张" : "提示：按空格翻开解析后评分"}</span>
        </div>
      </div>
    </div>
  );
}
