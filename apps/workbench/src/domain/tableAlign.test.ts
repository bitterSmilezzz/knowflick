import { describe, expect, it } from "vitest";
import { dividerAlign, parseColumnAligns, withAlign } from "./tableAlign";

describe("表格列对齐（B01）", () => {
  it("分隔符里的冒号决定对齐：左 / 中 / 右 / 默认", () => {
    expect(dividerAlign(":---")).toBe("left");
    expect(dividerAlign(":---:")).toBe("center");
    expect(dividerAlign("---:")).toBe("right");
    expect(dividerAlign("---")).toBeNull();
    expect(dividerAlign("---: ")).toBe("right");
  });

  it("不是分隔符的格子不算对齐声明", () => {
    expect(dividerAlign("")).toBeNull();
    expect(dividerAlign("文字")).toBeNull();
  });

  it("整行解析：每列各自的冒号", () => {
    expect(parseColumnAligns("| :--- | :---: | ---: | --- |")).toEqual(["left", "center", "right", null]);
    // 没有首尾竖线也认
    expect(parseColumnAligns(":--- | ---:")).toEqual(["left", "right"]);
  });

  it("改一列的对齐：生成最短且合法的分隔符", () => {
    expect(withAlign("---", "center")).toBe(":---:");
    expect(withAlign("---", "left")).toBe(":---");
    expect(withAlign("---", "right")).toBe("---:");
    expect(withAlign(":---:", null)).toBe("---");
  });

  it("切回默认时不保留原来的长横线数量：那对渲染毫无意义，留着只会越改越乱", () => {
    expect(withAlign(":--------:", null)).toBe("---");
    expect(withAlign("------", null)).toBe("---");
  });
});
