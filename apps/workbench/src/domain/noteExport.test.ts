import { describe, expect, it } from "vitest";
import { combineNotesForExport, exportBundleFileName } from "./noteExport";

describe("批量导出合集（B02）", () => {
  it("每篇一个二级标题，篇间用水平线隔开", () => {
    const md = combineNotesForExport([
      { title: "甲", bodyMd: "甲正文" },
      { title: "乙", bodyMd: "乙正文" },
    ]);
    expect(md).toContain("# 笔记合集");
    expect(md).toContain("## 甲\n\n甲正文");
    expect(md).toContain("---");
    expect(md.indexOf("甲正文")).toBeLessThan(md.indexOf("乙正文"));
  });

  it("空标题写「无标题笔记」；空正文只留标题，不编造内容", () => {
    const md = combineNotesForExport([{ title: "   ", bodyMd: "" }]);
    expect(md).toContain("## 无标题笔记");
    expect(md).not.toContain("## 无标题笔记\n\n\n");
    expect(md.trimEnd().endsWith("## 无标题笔记")).toBe(true);
  });

  it("正文原样保留：不重排、不转义", () => {
    const body = "- 列表\n| 表格 |\n> 引用";
    const md = combineNotesForExport([{ title: "甲", bodyMd: body }]);
    expect(md).toContain(body);
  });

  it("空合集也有标题行；文件名带日期、清掉非法字符", () => {
    expect(combineNotesForExport([])).toBe("# 笔记合集\n");
    const name = exportBundleFileName("评审/合集", new Date(2026, 10, 19).getTime());
    expect(name).toBe("评审 合集-20261119.md");
  });
});
