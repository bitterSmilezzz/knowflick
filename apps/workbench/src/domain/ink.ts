/**
 * 手写笔迹模型：纯数据 + 纯函数，便于测试与跨端复现。
 *
 * 坐标统一用 0..1 的归一化值存盘，这样换窗口尺寸、换设备重绘都不会变形；
 * 渲染时再乘画布尺寸。笔画顺序就是书写顺序，撤销按笔撤回。
 */
export interface InkPoint {
  x: number;
  y: number;
}
export interface InkStroke {
  /** 归一化坐标，0..1。 */
  points: InkPoint[];
  /** 线宽按画布短边归一化，0..1。 */
  width: number;
  /** 颜色用受限的语义名，避免把任意 CSS 值写进素材。 */
  color: InkColor;
}
export type InkColor = "ink" | "accent" | "muted";
export const INK_COLORS: InkColor[] = ["ink", "accent", "muted"];
export const INK_WIDTHS = [0.002, 0.004, 0.008] as const;

export interface InkDocument {
  version: 1;
  width: number;
  height: number;
  strokes: InkStroke[];
}

export function emptyInk(width = 1000, height = 600): InkDocument {
  return { version: 1, width, height, strokes: [] };
}

/** 把指针事件坐标换算成 0..1，越界会夹紧而不是丢弃。 */
export function normalizePoint(x: number, y: number, width: number, height: number): InkPoint {
  const safeW = width > 0 ? width : 1;
  const safeH = height > 0 ? height : 1;
  return {
    x: Math.min(1, Math.max(0, x / safeW)),
    y: Math.min(1, Math.max(0, y / safeH)),
  };
}

/** 追加一笔；少于两个点的笔画（误触）直接忽略。 */
export function addStroke(doc: InkDocument, stroke: InkStroke): InkDocument {
  if (stroke.points.length < 2) return doc;
  return { ...doc, strokes: [...doc.strokes, stroke] };
}

export function undoStroke(doc: InkDocument): InkDocument {
  return doc.strokes.length ? { ...doc, strokes: doc.strokes.slice(0, -1) } : doc;
}

export function clearInk(doc: InkDocument): InkDocument {
  return { ...doc, strokes: [] };
}

export function isEmptyInk(doc: InkDocument): boolean {
  return doc.strokes.length === 0;
}

/**
 * 解析存盘的笔迹。任何结构问题都返回空文档而不是抛错：
 * 一张坏掉的涂鸦不该让整条笔记打不开。
 */
export function parseInk(raw: unknown): InkDocument {
  if (!raw || typeof raw !== "object") return emptyInk();
  const value = raw as Record<string, unknown>;
  if (value.version !== 1 || !Array.isArray(value.strokes)) return emptyInk();
  const strokes: InkStroke[] = [];
  for (const item of value.strokes) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (!Array.isArray(row.points)) continue;
    const points = row.points.flatMap((point): InkPoint[] => {
      if (!point || typeof point !== "object") return [];
      const p = point as Record<string, unknown>;
      if (typeof p.x !== "number" || typeof p.y !== "number") return [];
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return [];
      return [{ x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) }];
    });
    if (points.length < 2) continue;
    const color: InkColor = INK_COLORS.includes(row.color as InkColor) ? (row.color as InkColor) : "ink";
    const width = typeof row.width === "number" && Number.isFinite(row.width)
      ? Math.min(0.05, Math.max(0.0005, row.width))
      : 0.004;
    strokes.push({ points, width, color });
  }
  return {
    version: 1,
    width: typeof value.width === "number" && value.width > 0 ? value.width : 1000,
    height: typeof value.height === "number" && value.height > 0 ? value.height : 600,
    strokes,
  };
}

/** 手写笔记的标题：没有文字输入时给一个可辨认的默认名。 */
export function inkTitle(doc: InkDocument, now = new Date()): string {
  const stamp = `${now.getMonth() + 1}月${now.getDate()}日`;
  return doc.strokes.length ? `手写笔记 · ${stamp}（${doc.strokes.length} 笔）` : `手写笔记 · ${stamp}`;
}

/**
 * 录音时长的可读表示。用于界面与素材标题，避免显示 0.0 秒这种假精度。
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 秒";
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
}
