import { useMemo, useState } from "react";
import type { KnowledgeCard } from "../domain/card";
import { searchCards, type SearchSourceFilter } from "../domain/search";
import { stampColor } from "./stampColor";

export function SearchSheet({
  cards,
  searchHistory,
  onAddSearchHistory,
  onRemoveSearchHistory,
  onClearSearchHistory,
  onOpen,
  onPromoteToDeck,
  onClose,
}: {
  cards: KnowledgeCard[];
  searchHistory: string[];
  onAddSearchHistory: (query: string) => void;
  onRemoveSearchHistory: (query: string) => void;
  onClearSearchHistory: () => void;
  onOpen: (id: string) => void;
  onPromoteToDeck: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [source, setSource] = useState<SearchSourceFilter>("all");
  const categories = useMemo(() => {
    const set = new Set(cards.map((card) => card.category).filter(Boolean));
    return ["全部", ...[...set].sort((a, b) => a.localeCompare(b))];
  }, [cards]);
  const results = useMemo(
    () => searchCards(query, cards, { category, source }),
    [cards, category, query, source],
  );
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal" onClick={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <h1>搜索卡库</h1>
          <button type="button" onClick={onClose}>关闭</button>
        </header>
        <label>
          关键词
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && query.trim()) onAddSearchHistory(query);
            }}
            placeholder="标题、分类、正文…"
            autoFocus
          />
        </label>
        {searchHistory.length > 0 && !query ? (
          <div className="search-history">
            <div className="actions">
              <span className="hint">最近搜索</span>
              <button type="button" onClick={onClearSearchHistory}>清空</button>
            </div>
            <ul>
              {searchHistory.map((item) => (
                <li key={item}>
                  <button type="button" onClick={() => setQuery(item)}>{item}</button>
                  <button type="button" className="ghost" aria-label={`删除 ${item}`} onClick={() => onRemoveSearchHistory(item)}>×</button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="actions">
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={source} onChange={(event) => setSource(event.target.value as SearchSourceFilter)}>
            <option value="all">全部来源</option>
            <option value="imported">剪藏导入</option>
            <option value="ai">AI 生成</option>
            <option value="favorites">已收藏</option>
            <option value="seen">学习足迹</option>
            <option value="unseen">待探索</option>
          </select>
        </div>
        <ul className="search-results">
          {results.map((item) => (
            <li key={item.card.id}>
              <div className="search-row">
                <button type="button" className="search-open" onClick={() => { if (query.trim()) onAddSearchHistory(query); onOpen(item.card.id); onClose(); }}>
                  <span className="stamp" style={{ ["--stamp" as string]: stampColor(item.card.category) }}>{item.card.category || "未分类"}</span>
                  <strong>{item.card.headline}</strong>
                  <p>{item.matchedExcerpt}</p>
                </button>
                <button type="button" className="ghost" title="加入卡堆顶" onClick={() => { if (query.trim()) onAddSearchHistory(query); onPromoteToDeck(item.card.id); onClose(); }}>↥</button>
              </div>
            </li>
          ))}
        </ul>
        {query && results.length === 0 ? <p className="hint">没有匹配结果</p> : null}
      </section>
    </div>
  );
}
