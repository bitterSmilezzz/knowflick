import { describe, expect, it } from "vitest";
import { applyMarkdownAction, toggleLinePrefix, wrapSelection, type TextSelection } from "./markdownEdit";

const sel = (text: string, start: number, end = start): TextSelection => ({ text, start, end });

describe("正文编辑动作（B01）", () => {
  it("给选中的行加前缀，再点一次去掉", () => {
    const start = sel("第一行\n第二行", 0, 7);
    const added = toggleLinePrefix(start, "- [ ] ");
    expect(added.text).toBe("- [ ] 第一行\n- [ ] 第二行");
    const removed = toggleLinePrefix(added, "- [ ] ");
    expect(removed.text).toBe("第一行\n第二行");
  });

  it("只在光标所在行生效；空行不动", () => {
    const state = sel("第一行\n\n第三行", 5);
    const out = toggleLinePrefix(state, "> ");
    expect(out.text).toBe("第一行\n\n> 第三行");
  });

  it("包住选区；已包住则取消；没选中就插一对标记并把光标放中间", () => {
    // 选前两个字（JS 按码元算，中文一字符一个码元）
    const wrapped = wrapSelection(sel("写点东西", 0, 2), "`");
    expect(wrapped.text).toBe("`写点`东西");
    expect(wrapped.start).toBe(1);
    expect(wrapped.end).toBe(3);
    const unwrapped = wrapSelection(wrapped, "`");
    expect(unwrapped.text).toBe("写点东西");
    const empty = wrapSelection(sel("abc", 1), "**");
    expect(empty.text).toBe("a****bc");
    expect(empty.start).toBe(3);
    expect(empty.end).toBe(3);
  });

  it("按钮表与动作分派一致：行内动作用前缀、包裹动作加标记", () => {
    const todo = { id: "todo", label: "待办", kind: "line", value: "- [ ] " } as const;
    expect(applyMarkdownAction(sel("做一件事", 0), todo).text).toBe("- [ ] 做一件事");
    const bold = { id: "bold", label: "加粗", kind: "wrap", value: "**" } as const;
    expect(applyMarkdownAction(sel("重点", 0, 2), bold).text).toBe("**重点**");
  });
});
