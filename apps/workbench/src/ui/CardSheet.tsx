import { useEffect, useState, type CSSProperties, type PointerEvent } from "react";
import type { KnowledgeCard } from "../domain/card";
import { themeFallbackBackground, themeImageUrl, themeKeyForCard } from "../domain/cardTheme";
import { stampColor } from "./stampColor";

export function CardSheet({
  card,
  className,
  style,
  dragX = 0,
  showAiMark = false,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  card: KnowledgeCard;
  className: string;
  style?: CSSProperties;
  dragX?: number;
  showAiMark?: boolean;
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove?: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp?: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel?: (event: PointerEvent<HTMLElement>) => void;
}) {
  const key = themeKeyForCard(card);
  const [photoOk, setPhotoOk] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => { if (!cancelled) setPhotoOk(true); };
    image.onerror = () => { if (!cancelled) setPhotoOk(false); };
    image.src = themeImageUrl(key);
    return () => { cancelled = true; };
  }, [key]);
  const threshold = 90;
  const likeProgress = dragX > 0 ? dragX / threshold : 0;
  const skipProgress = dragX < 0 ? -dragX / threshold : 0;
  const likeOpacity = likeProgress > 0 ? Math.min(1, Math.max(0, (likeProgress - 0.28) / 0.52)) : 0;
  const skipOpacity = skipProgress > 0 ? Math.min(1, Math.max(0, (skipProgress - 0.28) / 0.52)) : 0;
  const likeScale = 0.88 + 0.12 * likeOpacity;
  const skipScale = 0.88 + 0.12 * skipOpacity;
  return (
    <article
      className={`${className} photo`}
      style={{
        ...style,
        backgroundImage: photoOk
          ? `linear-gradient(180deg,rgba(0,0,0,.14) 0%,rgba(0,0,0,.28) 32%,rgba(0,0,0,.58) 64%,rgba(0,0,0,.82) 100%),url(${themeImageUrl(key)})`
          : themeFallbackBackground(key),
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <span
        className="swipe-stamp like"
        style={{ opacity: likeOpacity, transform: `rotate(-12deg) scale(${likeScale})` }}
      >
        ♥ 收藏
      </span>
      <span
        className="swipe-stamp skip"
        style={{ opacity: skipOpacity, transform: `rotate(12deg) scale(${skipScale})` }}
      >
        ✕ 略过
      </span>
      <div className="card-meta">
        <p className="stamp light" style={{ color: stampColor(card.category) }}>{card.category || "未分类"}</p>
        {showAiMark && card.source === "ai" ? <span className="ai-mark">AI</span> : null}
      </div>
      <h1>{card.headline || "无标题"}</h1>
      <p className="summary">{card.summary}</p>
    </article>
  );
}
