import { describe, expect, it } from "vitest";
import { countNoteTodos, parseNoteTodos, toggleNoteTodo } from "./noteTodo";

describe("笔记待办（B10）", () => {
  it("解析行首待办，未勾选与已勾选都认", () => {
    const body = [
      "# 今天",
      "- [ ] 第一件事",
      "  - [x] 缩进的第二件事",
      "* [X] 星号标记也认",
      "普通列表项不算",
      "- [ ]",
    ].join("\n");
    const todos = parseNoteTodos(body);
    // 「- [ ]」后面没有文字，不算待办（勾了也不知道要做什么）。
    expect(todos).toHaveLength(3);
    // 行号 1、去掉标记、初始未勾选
    expect(todos[0]).toEqual({ line: 1, text: "第一件事", done: false });
    expect(todos[1].done).toBe(true);
    // 大写 X 也算已完成
    expect(todos[2].done).toBe(true);
    expect(countNoteTodos(todos)).toEqual({ total: 3, done: 2 });
  });

  it("代码块里的待办不是待办", () => {
    const body = [
      "```md",
      "- [ ] 这是示例文本",
      "```",
      "- [ ] 真的待办",
    ].join("\n");
    const todos = parseNoteTodos(body);
    expect(todos).toHaveLength(1);
    expect(todos[0].text).toBe("真的待办");
  });

  it("勾选只改那一行，缩进与标记格式保持原样", () => {
    const body = [
      "- [ ] 第一件事",
      "  - [ ] 缩进的",
      "正文",
    ].join("\n");
    const out = toggleNoteTodo(body, 1);
    expect(out.changed).toBe(true);
    expect(out.body).toBe("- [ ] 第一件事\n  - [x] 缩进的\n正文");
    // 再点一次取消勾选，回到原样。
    const back = toggleNoteTodo(out.body, 1);
    expect(back.body).toBe(body);
  });

  it("勾不存在的行或非待办行都报「没改」", () => {
    expect(toggleNoteTodo("- [ ] 一件事", 99).changed).toBe(false);
    expect(toggleNoteTodo("普通段落", 0).changed).toBe(false);
    expect(toggleNoteTodo("普通段落", 0).body).toBe("普通段落");
  });
});
