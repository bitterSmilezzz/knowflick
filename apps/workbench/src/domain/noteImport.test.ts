import { describe, expect, it } from "vitest";
import { noteFromMarkdown, titleFromFileName } from "./noteImport";

describe("导入 Markdown（A03/B05）", () => {
  it("取文首的一级标题做标题，并把它从正文里去掉；其余结构原样保留", () => {
    const raw = "# 迁移计划\n\n## 目标\n- 把旧库搬过来\n";
    const out = noteFromMarkdown(raw, "plan.md");
    expect(out.title).toBe("迁移计划");
    expect(out.body).toBe("## 目标\n- 把旧库搬过来\n");
  });

  it("没有一级标题时用文件名；文件名里的短横与下划线换成空格", () => {
    const out = noteFromMarkdown("正文第一行\n第二行", "weekly-review_2026-11.md");
    expect(out.title).toBe("weekly review 2026 11");
    expect(out.body).toBe("正文第一行\n第二行");
    expect(titleFromFileName("/tmp/会议记录.md")).toBe("会议记录");
  });

  it("正文中间的一级标题不算文档标题", () => {
    const raw = "开头\n\n\n\n\n\n# 章节标题\n正文";
    const out = noteFromMarkdown(raw, "doc.md");
    expect(out.title).toBe("doc");
    expect(out.body).toContain("# 章节标题");
  });

  it("不丢弃 YAML front-matter；空文件也能导入（标题来自文件名）", () => {
    const raw = "---\ntags: [a]\n---\n\n正文";
    const out = noteFromMarkdown(raw, "meta.md");
    expect(out.title).toBe("meta");
    expect(out.body).toContain("tags: [a]");
    expect(noteFromMarkdown("   ", "空白.md")).toEqual({ title: "空白", body: "   " });
  });
});
