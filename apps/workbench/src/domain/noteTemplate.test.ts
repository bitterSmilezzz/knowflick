import { describe, expect, it } from "vitest";
import { NOTE_TEMPLATES, instantiateTemplate, renderTemplate, templateVars } from "./noteTemplate";

describe("笔记模板（B05）", () => {
  // 2026-11-19 是周四，第 47 周。
  const NOW = new Date(2026, 10, 19, 9, 0, 0).getTime();

  it("变量替换日期、星期与周号", () => {
    const vars = templateVars(NOW);
    expect(vars.date).toBe("2026-11-19");
    expect(vars.weekday).toBe("周四");
    expect(vars.week).toMatch(/^2026-W\d{2}$/);
    expect(renderTemplate("{{date}} {{weekday}}", NOW)).toBe("2026-11-19 周四");
    // 未知变量原样保留，避免把用户自己写的 {{...}} 吃掉
    expect(renderTemplate("{{unknown}} 与 {{date}}", NOW)).toBe("{{unknown}} 与 2026-11-19");
  });

  it("每个模板都能实例化：标题非空、正文有结构、没有残留变量", () => {
    for (const tpl of NOTE_TEMPLATES) {
      const out = instantiateTemplate(tpl.id, NOW);
      if (tpl.id === "blank") {
        expect(out).toEqual({ title: "", body: "" });
        continue;
      }
      expect(out.title.length).toBeGreaterThan(0);
      expect(out.body).toContain("## ");
      expect(out.body).not.toMatch(/\{\{[^}]+\}\}/);
    }
  });

  it("日记模板带当天的标题与一条待办", () => {
    const out = instantiateTemplate("journal", NOW);
    expect(out.title).toBe("2026-11-19 日记");
    expect(out.body).toContain("- [ ]");
    expect(out.body).toContain("值得记住");
  });
});
