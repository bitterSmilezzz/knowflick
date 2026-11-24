/**
 * 正文里的附件渲染（B06）。
 *
 * 三种库内附件的**渲染方式完全不同**：
 * - 图片 → `<img>`；
 * - 录音 → `<audio controls>`（塞进 img 标签播不出来）；
 * - 手写笔迹 → SVG（存的是 JSON，本来就不是图片）。
 *
 * 此前一律渲染成 `<img>`，于是录音与笔迹在预览里都是「一个裂掉的图」。
 *
 * 载荷由调用方给：图片与录音给 URL，笔迹给解析后的文档。
 * 没给载荷时回退为纯文本——**不能渲染的东西不该假装能渲染**。
 */

import type { InkDocument } from "../../domain/ink";
import { inkStrokePaths } from "../../domain/inkSvg";

export type AttachmentPayload =
  | { kind: "image"; url: string }
  | { kind: "audio"; url: string }
  | { kind: "ink"; doc: InkDocument };

/** 图片：普通 `<img>`。 */
function ImageAttachment({ url, alt }: { url: string; alt: string }) {
  return <img src={url} alt={alt} className="ws-md-image" />;
}

/** 录音：原生播放器。浏览器不认 audio/webm 时会提示无法播放——那是环境问题，不该装成图片。 */
function AudioAttachment({ url, alt }: { url: string; alt: string }) {
  return (
    <audio className="ws-md-audio" src={url} controls preload="metadata" aria-label={alt || "录音"} />
  );
}

/**
 * 手写笔迹：按归一化坐标画 SVG。
 *
 * 坐标是 0..1，用 `viewBox="0 0 1 1"` 缩放到显示尺寸——换窗口宽度不会变形。
 * 颜色用**语义名**（ink / accent / muted），由 CSS 决定，深浅主题都看得清。
 */
function InkAttachment({ doc, alt }: { doc: InkDocument; alt: string }) {
  const strokes = inkStrokePaths(doc);
  if (strokes.length === 0) {
    // 空笔迹要说清楚是空的：只显示 alt 的话，用户以为是自己写的字没显示出来。
    return <span className="ws-md-ink-empty">{alt ? `${alt}（空笔迹）` : "手写笔迹（空）"}</span>;
  }
  return (
    <svg
      className="ws-md-ink"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${alt || "手写笔迹"}，${doc.strokes.length} 笔`}
    >
      {strokes.map((stroke, index) => (
        <path
          key={index}
          d={stroke.path}
          className={`ws-md-ink-stroke ws-md-ink-${stroke.color}`}
          strokeWidth={stroke.width}
          fill="none"
        />
      ))}
    </svg>
  );
}

/** 按载荷种类渲染；没有载荷时回退为纯文本。 */
export function AttachmentView({ payload, alt }: { payload: AttachmentPayload | null; alt: string }) {
  if (!payload) return <span>{alt}</span>;
  if (payload.kind === "image") return <ImageAttachment url={payload.url} alt={alt} />;
  if (payload.kind === "audio") return <AudioAttachment url={payload.url} alt={alt} />;
  return <InkAttachment doc={payload.doc} alt={alt} />;
}
