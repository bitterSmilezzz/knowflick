import { describe, expect, it } from "vitest";

import { menuActionToPage } from "./menuActions";

describe("原生菜单动作", () => {
  it("把界面页面对应的菜单动作映射到页面", () => {
    expect(menuActionToPage("inbox")).toBe("inbox");
    expect(menuActionToPage("library")).toBe("library");
    expect(menuActionToPage("quiz")).toBe("quiz");
    expect(menuActionToPage("settings")).toBe("settings");
  });

  it("未知动作不跳页", () => {
    expect(menuActionToPage("about")).toBeUndefined();
    expect(menuActionToPage("")).toBeUndefined();
  });

  it("收藏与归档是筛选而不是目的地", () => {
    // 菜单里没有这两个入口：它们是知识库页里的筛选，不是可导航的页。
    expect(menuActionToPage("favorites")).toBeUndefined();
    expect(menuActionToPage("archive")).toBeUndefined();
  });
});
