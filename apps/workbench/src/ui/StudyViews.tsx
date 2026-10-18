import { useState } from "react";
import { askModel } from "../domain/aiChat";
import { addCards } from "../domain/ingest";
import { digest as clipDigest } from "../domain/clipEngine";
import { parseNotesFile } from "../domain/notes";
import { createLearningPlan } from "../domain/learningPlan";
import { quizSessionView } from "../domain/quizSession";
import { applyReview, buildQuiz, calculateReview, dueCards, previewIntervals, todayStamp, type SpacedAlgorithm, type SpacedRating } from "../domain/review";
import { computeStats } from "../domain/stats";
import type { AiSettings } from "../domain/settings";
import type { KnowledgeCard } from "../domain/card";
import { fetchClip, pickNoteFile, readTextFile } from "../shell/store";
import { CardSheet } from "./CardSheet";

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
      <section className="empty">
        <h1>没有可以测验的卡</h1>
        <p>先剪藏、导入或生成几张卡。</p>
      </section>
    );
  }
  if (session.kind === "complete") {
    return (
      <section className="empty">
        <h1>本轮测验完成</h1>
        <p>共复习 {session.total} 张。明天到期卡会再出现在队列里。</p>
        <div className="actions">
          <button type="button" className="primary" onClick={() => { setIds(null); setIndex(0); setError(""); }}>再来一轮</button>
        </div>
      </section>
    );
  }
  if (session.kind === "stale") {
    return (
      <section className="empty">
        <h1>测验队列已过期</h1>
        <p>卡库有变动，请重新开始。</p>
        <div className="actions">
          <button type="button" className="primary" onClick={() => { setIds(null); setIndex(0); }}>重新开始</button>
        </div>
      </section>
    );
  }
  const { card } = session;
  const preview = previewIntervals(card, algorithm);
  const labels: Array<[SpacedRating, string]> = [["again", "重来"], ["hard", "较难"], ["good", "良好"], ["easy", "容易"]];
  return (
    <section className="deck">
      <CardSheet card={card} className="sheet top quiz-card" />
      <p className="remain">{session.index + 1} / {session.total}</p>
      {error ? <p className="banner error">{error}</p> : null}
      <div className="actions">
        {labels.map(([rating, label]) => (
          <button
            key={rating}
            type="button"
            className={rating === "good" ? "primary" : ""}
            onClick={() => {
              const next = cards.map((item) => item.id === card.id ? applyReview(item, calculateReview(item, rating, algorithm)) : item);
              if (ids === null) setIds(queueIds);
              onChange(next).then(() => setIndex((value) => value + 1)).catch((err: unknown) => setError(String(err)));
            }}
          >
            {label} · {preview[rating]}天
          </button>
        ))}
      </div>
    </section>
  );
}

export function StatsView({
  cards,
  algorithm,
  onAlgorithm,
  onStartDueQuiz,
  onOpenCard,
}: {
  cards: KnowledgeCard[];
  algorithm: SpacedAlgorithm;
  onAlgorithm: (value: SpacedAlgorithm) => void;
  onStartDueQuiz: () => void;
  onOpenCard: (id: string) => void;
}) {
  const today = todayStamp();
  const stats = computeStats(cards, today);
  const plan = createLearningPlan(cards, today);
  const dist = plan.masteryDistribution;
  const upcoming = plan.upcomingSchedule(7);
  const maxUpcoming = Math.max(1, ...upcoming.map((item) => item.count));
  const preview = plan.upcomingCards(5);
  return (
    <section className="detail stats-panel">
      <h1>统计</h1>
      <p>已看 {stats.seenCount} · 感兴趣率 {stats.seenCount ? Math.round((stats.likedCount / stats.seenCount) * 100) : 0}% · 连续 {stats.streakDays} 天 · 今日已学 {plan.completedToday}</p>
      <div className="stats-due card-lite">
        <p><strong>今日到期 {plan.due.length}</strong> 张 · 熟练掌握 {plan.mastered} 张 · 记忆留存 {dist.retentionRate}%</p>
        <div className="actions">
          <button type="button" className="primary" disabled={plan.due.length === 0} onClick={onStartDueQuiz}>复习到期卡片</button>
        </div>
      </div>
      <p className="hint">掌握度：熟练 {dist.masteredCount} · 学习中 {dist.hesitantCount} · 需强化 {dist.needsReviewCount}</p>
      <h2 className="stats-sub">未来 7 天到期</h2>
      <div className="chart">
        {upcoming.map((item) => (
          <div key={item.day} className="bar" title={`${item.day}：${item.count}`}>
            <span style={{ height: `${Math.max(8, (item.count / maxUpcoming) * 96)}px` }} />
            <em>{item.count}</em>
          </div>
        ))}
      </div>
      {preview.length > 0 ? (
        <>
          <h2 className="stats-sub">近期待复习</h2>
          <ul className="stats-upcoming">
            {preview.map(({ card, day }) => (
              <li key={card.id}>
                <button type="button" onClick={() => onOpenCard(card.id)}>
                  <strong>{card.headline}</strong>
                  <em>{day}</em>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h2 className="stats-sub">过去 7 天刷卡</h2>
      <div className="chart">
        {stats.daily.map((item) => (
          <div key={item.day} className="bar" title={`${item.day}：${item.count}`}>
            <span style={{ height: `${Math.max(8, item.count * 18)}px` }} />
            <em>{item.count}</em>
          </div>
        ))}
      </div>
      {stats.categories.length > 0 ? (
        <ul>
          {stats.categories.map((item) => (
            <li key={item.category}>{item.category || "未分类"} · 已看 {item.seen} · 感兴趣 {item.liked}</li>
          ))}
        </ul>
      ) : null}
      <div className="actions">
        <button type="button" className={algorithm === "sm2" ? "on" : ""} onClick={() => onAlgorithm("sm2")}>SM-2</button>
        <button type="button" className={algorithm === "fsrs" ? "on" : ""} onClick={() => onAlgorithm("fsrs")}>FSRS</button>
      </div>
    </section>
  );
}

export function NotesView({ cards, settings, apiKey, onImported }: {
  cards: KnowledgeCard[];
  settings: AiSettings;
  apiKey: string;
  onImported: (cards: KnowledgeCard[], message: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<KnowledgeCard[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  return (
    <section className="settings">
      <h1>导入笔记</h1>
      <textarea value={text} onChange={(event) => setText(event.target.value)} rows={8} placeholder="贴上 Markdown 或 JSON" />
      {error ? <p className="banner error">{error}</p> : null}
      <div className="actions">
        <button type="button" onClick={() => {
          setError("");
          void pickNoteFile().then(async (path) => {
            if (!path) return;
            const fileText = await readTextFile(path);
            setFileName(path.split(/[/\\]/).pop() ?? "");
            setText(fileText);
          }).catch((err: unknown) => setError(String(err)));
        }}>选择文件</button>
        <button type="button" onClick={() => {
          try {
            const next = parseNotesFile(text, fileName);
            setParsed(next);
            setSelected(next.map((card) => card.id));
            setError(next.length ? "" : "没有解析出卡片");
          } catch (err: unknown) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}>规则解析</button>
        <button type="button" onClick={() => {
          void askModel(text, settings, apiKey).then((next) => {
            const imported = next.map((card) => ({ ...card, source: "imported" as const }));
            setParsed(imported);
            setSelected(imported.map((card) => card.id));
            setError("");
          }).catch((err: unknown) => setError(String(err)));
        }}>AI 提炼</button>
        <button type="button" className="primary" onClick={() => {
          const incoming = parsed.filter((card) => selected.includes(card.id));
          const result = addCards(cards, incoming, true);
          void onImported(result.cards, `导入完成：新增 ${result.added} 张，跳过重复卡 ${incoming.length - result.added} 张。`);
        }}>确认导入（{selected.length}）</button>
      </div>
      <ul>
        {parsed.map((card) => (
          <li key={card.id}>
            <label className="check">
              <input type="checkbox" checked={selected.includes(card.id)} onChange={(event) => {
                setSelected((current) => event.target.checked ? [...current, card.id] : current.filter((id) => id !== card.id));
              }} />
              {card.category} · {card.headline}
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ClipView({ cards, settings, apiKey, onImported }: {
  cards: KnowledgeCard[];
  settings: AiSettings;
  apiKey: string;
  onImported: (cards: KnowledgeCard[], message: string) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [page, setPage] = useState<ReturnType<typeof clipDigest>>(null);
  const [parsed, setParsed] = useState<KnowledgeCard[]>([]);
  const [error, setError] = useState("");
  return (
    <section className="settings">
      <h1>剪藏网页</h1>
      <label>地址<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" /></label>
      {error ? <p className="banner error">{error}</p> : null}
      <div className="actions">
        <button type="button" onClick={() => {
          setError("");
          void fetchClip(url).then((fetched) => {
            const result = clipDigest(fetched.text, fetched.finalUrl);
            if (!result) throw new Error("没从这一页抽到正文（可能需登录，或内容全靠脚本渲染）");
            setPage(result);
            setParsed([]);
          }).catch((err: unknown) => setError(String(err)));
        }}>抓取并预览正文</button>
        <button type="button" disabled={!page} onClick={() => {
          if (!page) return;
          void askModel(page.aiNote, settings, apiKey).then((next) => {
            setParsed(page.attributing(next));
            setError("");
          }).catch((err: unknown) => setError(String(err)));
        }}>AI 提炼成卡片</button>
        <button type="button" className="primary" disabled={parsed.length === 0} onClick={() => {
          const result = addCards(cards, parsed, true);
          void onImported(result.cards, `导入完成：新增 ${result.added} 张，跳过重复卡 ${parsed.length - result.added} 张。`);
        }}>确认导入（{parsed.length}）</button>
      </div>
      {page ? <pre className="digest">{page.aiNote}</pre> : null}
      <ul>{parsed.map((card) => <li key={card.id}>{card.headline}</li>)}</ul>
    </section>
  );
}

export function GenerateView({ cards, settings, apiKey, onImported }: {
  cards: KnowledgeCard[];
  settings: AiSettings;
  apiKey: string;
  onImported: (cards: KnowledgeCard[], message: string) => Promise<void>;
}) {
  const [topic, setTopic] = useState("");
  const [error, setError] = useState("");
  return (
    <section className="settings">
      <h1>AI 出卡</h1>
      <label>想学的题目或一段材料<textarea value={topic} onChange={(event) => setTopic(event.target.value)} rows={5} /></label>
      {error ? <p className="banner error">{error}</p> : null}
      <button type="button" className="primary" onClick={() => {
        void askModel(topic, settings, apiKey).then((next) => {
          const result = addCards(cards, next, true);
          return onImported(result.cards, `导入完成：新增 ${result.added} 张，跳过重复卡 ${next.length - result.added} 张。`);
        }).catch((err: unknown) => setError(String(err)));
      }}>生成并放入卡堆</button>
    </section>
  );
}

