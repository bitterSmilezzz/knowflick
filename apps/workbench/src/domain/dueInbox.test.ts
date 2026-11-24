import { describe, expect, it } from "vitest";
import { collectDueTodos, dueTotals } from "./dueInbox";

const NOW = new Date(2026, 10, 19, 9, 0, 0).getTime();

function note(id: string, title: string, bodyMd: string, extra: Record<string, unknown> = {}) {
  return { id, title, bodyMd, ...extra };
}

describe("跨笔记到期待办（B10）", () => {
  it("聚合多篇笔记的到期待办，逾期在前、再按日期", () => {
    const notes = [
      note("a", "甲", "- [ ] 今天做 📅 2026-11-19"),
      note("b", "乙", "- [ ] 更早的 📅 2026-11-10"),
      note("c", "丙", "- [ ] 将来的 📅 2026-12-01"),
    ];
    const items = collectDueTodos(notes, NOW);
    expect(items.map((i) => i.due)).toEqual(["2026-11-10", "2026-11-19", "2026-12-01"]);
    expect(items[0].state).toBe("overdue");
    expect(items[1].state).toBe("today");
    expect(items[2].state).toBe("upcoming");
    expect(dueTotals(items)).toEqual({ overdue: 1, today: 1 });
  });

  it("跳过已完成的、没日期的、回收站的；归档的照算", () => {
    const body = [
      "- [x] 做完的 📅 2026-11-01",
      "- [ ] 没日期",
      "- [ ] 归档里的 📅 2026-11-18",
    ].join("\n");
    const notes = [
      note("a", "甲", body, { archivedAt: 1 }),
      note("b", "已删", "- [ ] 删掉的 📅 2026-11-01", { isDeleted: true }),
    ];
    const items = collectDueTodos(notes, NOW);
    expect(items).toHaveLength(1);
    expect(items[0].noteId).toBe("a");
    expect(items[0].text).toBe("归档里的");
  });

  it("同一日期按笔记标题排，顺序稳定；代码块里的不算", () => {
    const notes = [
      note("b", "乙", "- [ ] 同一件 📅 2026-11-20"),
      note("a", "甲", "- [ ] 同一件 📅 2026-11-20"),
      note("c", "丙", "```\n- [ ] 示例 📅 2026-11-20\n```"),
    ];
    // 丙那条在代码块里（示例文本），不算待办；剩下按标题拼音序：甲 jiǎ < 乙 yǐ
    expect(collectDueTodos(notes, NOW).map((i) => i.noteTitle)).toEqual(["甲", "乙"]);
  });
});
