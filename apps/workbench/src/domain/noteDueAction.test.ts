import { describe, expect, it } from "vitest";
import { snoozeTodoInBody, snoozedDate } from "./noteDueAction";

const NOW = new Date(2026, 10, 19, 9, 0, 0).getTime();

describe("到期待办的就地处理（B10）", () => {
  it("逾期很久的从今天起算——从原日期推完可能还是逾期，那不是推迟", () => {
    expect(snoozedDate("2026-08-01", 3, NOW)).toBe("2026-11-22");
  });

  it("未来才到期的从原截止日推——从今天推可能反而提前了", () => {
    expect(snoozedDate("2026-12-01", 3, NOW)).toBe("2026-12-04");
  });

  it("只改那一行的日期标记，其余文字与格式原样", () => {
    const body = "- [ ] 交周报 📅 2026-11-18\n- [ ] 别的 📅 2026-11-20";
    const out = snoozeTodoInBody(body, 0, 3, NOW);
    expect(out.changed).toBe(true);
    expect(out.due).toBe("2026-11-22");
    expect(out.body.split("\n")[0]).toBe("- [ ] 交周报 📅 2026-11-22");
    expect(out.body.split("\n")[1]).toBe("- [ ] 别的 📅 2026-11-20");
  });

  it("没有日期的待办不动：给无期限的待办设日期是另一件事", () => {
    const body = "- [ ] 没日期";
    expect(snoozeTodoInBody(body, 0, 3, NOW)).toEqual({ body, changed: false, due: null });
    // 不是待办行也一样
    expect(snoozeTodoInBody("普通段落", 0, 3, NOW).changed).toBe(false);
  });

  it("保留缩进与已完成标记；列表符号统一成 `-`（与勾选同一套规范化）", () => {
    const body = "  * [x] 做过的 📅 2026-11-19";
    const out = snoozeTodoInBody(body, 0, 7, NOW);
    // `toggleNoteTodo` 早就把 `*` 规范成 `-`；这里保持一致，免得同一行因来源不同而两种写法。
    expect(out.body).toBe("  - [x] 做过的 📅 2026-11-26");
  });
});
