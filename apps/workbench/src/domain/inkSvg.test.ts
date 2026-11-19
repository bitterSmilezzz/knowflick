import { describe, expect, it } from "vitest";
import { emptyInk, type InkDocument } from "./ink";
import { inkStrokePath, inkStrokePaths } from "./inkSvg";

const doc: InkDocument = {
  version: 1,
  width: 1000,
  height: 600,
  strokes: [
    { points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.25 }, { x: 1, y: 0.5 }], width: 0.004, color: "ink" },
    { points: [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }], width: 0.008, color: "accent" },
    { points: [{ x: 0.9, y: 0.9 }], width: 0.004, color: "muted" },
  ],
};

describe("手写笔迹的 SVG 路径（B06）", () => {
  it("一笔一条 path：起点 M，后续 L", () => {
    const paths = inkStrokePaths(doc);
    expect(paths).toHaveLength(2);
    expect(paths[0].path).toBe("M0.0000 0.0000 L0.5000 0.2500 L1.0000 0.5000");
    expect(paths[1].path).toBe("M0.2000 0.2000 L0.4000 0.4000");
  });

  it("点数不足两点的笔画不画（误触）", () => {
    expect(inkStrokePath(doc.strokes[2])).toBe("");
  });

  it("颜色用语义名而不是色值——色值由主题决定，写死会在深色主题下看不清", () => {
    const paths = inkStrokePaths(doc);
    expect(paths.map((p) => p.color)).toEqual(["ink", "accent"]);
    expect(paths[0].width).toBe(0.004);
  });

  it("空文档没有笔画", () => {
    expect(inkStrokePaths(emptyInk())).toEqual([]);
  });
});
