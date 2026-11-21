import { describe, expect, it } from "vitest";
import { dueDateOf, dueStateOf, dueSummary, todoTextWithoutDue, todosWithDue } from "./noteDue";
import { parseNoteTodos } from "./noteTodo";

// 2026-11-19 09:00 本地时间
const NOW = new Date(2026, 10, 19, 9, 0, 0).getTime();

describe("待办截止日期（B10）", () => {
  it("从待办行末尾解析 📅 日期；非法日期不猜", () => {
    expect(dueDateOf("交周报 📅 2026-11-20")).toBe("2026-11-20");
    expect(todoTextWithoutDue("交周报 📅 2026-11-20")).toBe("交周报");
    expect(dueDateOf("交周报")).toBeNull();
    // 2026 不是闰年，2 月 30 日不存在：宁可当没有日期，也不要显示一个假截止
    expect(dueDateOf("写点东西 📅 2026-02-30")).toBeNull();
    expect(dueDateOf("写点东西 📅 2026-13-01")).toBeNull();
  });

  it("到期状态按本地日比较：逾期、今天、将来", () => {
    expect(dueStateOf("2026-11-18", NOW)).toBe("overdue");
    expect(dueStateOf("2026-11-19", NOW)).toBe("today");
    expect(dueStateOf("2026-11-20", NOW)).toBe("upcoming");
  });

  it("只统计未完成且带日期的待办，按日期升序；已完成的不算逾期", () => {
    const body = [
      "- [ ] 早的 📅 2026-11-18",
      "- [x] 做完的 📅 2026-11-01",
      "- [ ] 没日期的",
      "- [ ] 晚的 📅 2026-11-25",
    ].join("\n");
    const items = todosWithDue(parseNoteTodos(body));
    expect(items.map((i) => i.due)).toEqual(["2026-11-18", "2026-11-25"]);
    expect(dueSummary(body, NOW)).toEqual({ overdue: 1, today: 0 });
  });

  it("今天的算 today，不算逾期", () => {
    const body = ["- [ ] 今天到期 📅 2026-11-19", "- [ ] 昨天 📅 2026-11-18"].join("\n");
    expect(dueSummary(body, NOW)).toEqual({ overdue: 1, today: 1 });
  });
});
