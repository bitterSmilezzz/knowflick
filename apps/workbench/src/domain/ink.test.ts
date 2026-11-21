import { describe, expect, it } from "vitest";
import { addStroke, clearInk, emptyInk, formatDuration, inkTitle, isEmptyInk, normalizePoint, parseInk, undoStroke } from "./ink";

const stroke = (points: Array<[number, number]>) => ({
  points: points.map(([x, y]) => ({ x, y })), width: 0.004, color: "ink" as const,
});

describe("手写笔迹", () => {
  it("坐标归一化并夹紧越界值", () => {
    expect(normalizePoint(50, 30, 100, 60)).toEqual({ x: 0.5, y: 0.5 });
    expect(normalizePoint(-10, 999, 100, 60)).toEqual({ x: 0, y: 1 });
    expect(normalizePoint(10, 10, 0, 0)).toEqual({ x: 1, y: 1 });
  });

  it("单点笔画视为误触，不写入", () => {
    const doc = addStroke(emptyInk(), stroke([[0.1, 0.1]]));
    expect(doc.strokes).toHaveLength(0);
    expect(isEmptyInk(doc)).toBe(true);
  });

  it("撤销按笔回退，清空后为空", () => {
    let doc = addStroke(emptyInk(), stroke([[0.1, 0.1], [0.2, 0.2]]));
    doc = addStroke(doc, stroke([[0.3, 0.3], [0.4, 0.4]]));
    expect(doc.strokes).toHaveLength(2);
    expect(undoStroke(doc).strokes).toHaveLength(1);
    expect(clearInk(doc).strokes).toHaveLength(0);
  });

  it("损坏的存盘数据退回空文档，而不是抛错", () => {
    expect(parseInk(null).strokes).toHaveLength(0);
    expect(parseInk({ version: 2, strokes: [] }).strokes).toHaveLength(0);
    expect(parseInk({ version: 1, strokes: "no" }).strokes).toHaveLength(0);
    expect(parseInk({ version: 1, strokes: [{ points: [{ x: "a", y: 1 }] }] }).strokes).toHaveLength(0);
    expect(parseInk({ version: 1, strokes: [{ points: [{ x: NaN, y: 1 }, { x: 1, y: 1 }] }] }).strokes).toHaveLength(0);
  });

  it("往返可读，且非法颜色/线宽收敛到安全值", () => {
    const doc = { version: 1 as const, width: 800, height: 400,
      strokes: [{ points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }], width: 9, color: "red" as never }] };
    const parsed = parseInk(JSON.parse(JSON.stringify(doc)));
    expect(parsed.strokes).toHaveLength(1);
    expect(parsed.strokes[0].color).toBe("ink");
    expect(parsed.strokes[0].width).toBeLessThanOrEqual(0.05);
    expect(parsed.width).toBe(800);
  });

  it("标题给出可辨认的名字", () => {
    const at = new Date(2026, 9, 21);
    expect(inkTitle(emptyInk(), at)).toContain("手写笔记");
    expect(inkTitle(emptyInk(), at)).toContain("10月21日");
    const withInk = addStroke(emptyInk(), stroke([[0.1, 0.1], [0.2, 0.2]]));
    expect(inkTitle(withInk, at)).toContain("1 笔");
  });

  it("时长不显示假精度", () => {
    expect(formatDuration(0)).toBe("0 秒");
    expect(formatDuration(-5)).toBe("0 秒");
    expect(formatDuration(800)).toBe("1 秒");
    expect(formatDuration(65_000)).toBe("1 分 5 秒");
  });
});
