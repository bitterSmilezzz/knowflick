/**
 * 手写笔迹 → SVG 路径（B06）。
 *
 * 为什么不用 canvas：`InkPreview` 用 canvas + effect 绘制，**服务端渲染测不到**，
 * 于是「笔迹到底画成什么样」没有任何断言能守住。纯函数算出的 SVG 路径可以直接断言。
 *
 * 坐标仍是 0..1 的归一化值，渲染时由 `viewBox` 缩放——换窗口尺寸不变形。
 */

import type { InkDocument, InkStroke } from "./ink";

/** 一笔的 SVG path（`M` 起点 + `L` 折线）。点数不足两点的笔画不画（误触）。 */
export function inkStrokePath(stroke: InkStroke): string {
  if (stroke.points.length < 2) return "";
  return stroke.points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(4)} ${point.y.toFixed(4)}`)
    .join(" ");
}

/**
 * 笔迹文档 → 每笔的 path 与颜色名。
 *
 * 颜色用**语义名**（ink / accent / muted）而不是色值：色值由主题决定，
 * 写死颜色会在深色主题下变成看不清的笔画。
 */
export function inkStrokePaths(doc: InkDocument): { path: string; color: string; width: number }[] {
  const out: { path: string; color: string; width: number }[] = [];
  for (const stroke of doc.strokes) {
    const path = inkStrokePath(stroke);
    if (!path) continue;
    out.push({ path, color: stroke.color, width: stroke.width });
  }
  return out;
}
