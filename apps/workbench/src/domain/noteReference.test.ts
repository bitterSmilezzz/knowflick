import { describe, expect, it } from "vitest";
import {
  applyNoteReference,
  extractNoteReferences,
  noteReferenceLine,
  referencesNote,
  referenceStatus,
  NOTE_URI_SCHEME,
} from "./noteReference";

/**
 * 笔记引用的契约（B04 关联 / G01）：
 * 可回原件（带源 id）、可读（普通 Markdown 引用块）、可解析（能读回结构化条目）。
 */

/** 统一形状的引用源（笔记或素材）。 */
const source = (id: string, title: string, body = "被引用的正文内容", kind: "note" | "material" = "note") => ({
  id,
  title,
  bodyMd: body,
  kind,
});

describe("笔记引用（noteReference）", () => {
  it("引用行含标题、片段与可回原件链接", () => {
    const line = noteReferenceLine(source("n1", "源笔记"), "关键结论");
    expect(line).toContain("《源笔记》");
    expect(line).toContain("关键结论");
    expect(line).toContain(`${NOTE_URI_SCHEME}n1`);
  });

  it("片段过长时截断并加省略号", () => {
    const line = noteReferenceLine(source("n1", "源笔记"), "长".repeat(400));
    expect(line.length).toBeLessThan(260);
    expect(line).toContain("…");
  });

  it("插入到正文末尾，保留原内容", () => {
    const body = applyNoteReference("我原来的正文", source("n1", "源笔记"), "片段");
    expect(body).toContain("我原来的正文");
    expect(body).toContain("《源笔记》");
  });

  it("正文为空时只放引用，不留前导空行", () => {
    const body = applyNoteReference("", source("n1", "源笔记"));
    expect(body.startsWith("> 《")).toBe(true);
  });

  it("能解析回结构化引用", () => {
    const body = applyNoteReference("正文", source("n7", "另一篇"), "结论在这里");
    const refs = extractNoteReferences(body);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ noteId: "n7", title: "另一篇", excerpt: "结论在这里" });
  });

  it("解析不出没有回原件链接的伪引用", () => {
    const body = "> 《看起来像引用》：但没有原件链接";
    expect(extractNoteReferences(body)).toHaveLength(0);
  });

  it("反向链接判定：正文是否引用了某篇笔记", () => {
    const body = applyNoteReference("正文", source("n9", "被引用的那篇"));
    expect(referencesNote(body, "n9")).toBe(true);
    expect(referencesNote(body, "n8")).toBe(false);
  });

  it("多篇引用按正文顺序返回", () => {
    let body = applyNoteReference("正文", source("a", "甲篇"));
    body = applyNoteReference(body, source("b", "乙篇"));
    expect(extractNoteReferences(body).map((r) => r.noteId)).toEqual(["a", "b"]);
  });
});

describe("引用的失效识别（源笔记被删后）", () => {
  it("源笔记不在库里时引用仍可解析（带 id，可判断失效）", () => {
    const body = applyNoteReference("正文", source("gone", "已被删除的笔记"));
    const refs = extractNoteReferences(body);
    expect(refs).toHaveLength(1);
    expect(refs[0].noteId).toBe("gone");
    // 引用本身不依赖源笔记还在——失效判断由「库里找不到这个 id」得出
    expect(refs[0].title).toBe("已被删除的笔记");
  });

  it("改标题不破坏引用：解析靠 id，不靠标题", () => {
    const original = source("stable-id", "旧标题");
    let body = applyNoteReference("正文", original);
    // 源笔记改名后重新生成引用：id 不变，标题变了
    const renamed = { ...original, title: "新标题" };
    body = applyNoteReference(body, renamed);
    const refs = extractNoteReferences(body);
    expect(refs.map((r) => r.noteId)).toEqual(["stable-id", "stable-id"]);
    expect(refs[1].title).toBe("新标题");
  });
});

describe("多来源引用与过期判定（R2 第 8 项）", () => {
  const material = (id: string, title: string, body: string) => source(id, title, body, "material");

  it("可以引用素材（不只笔记）", () => {
    const body = applyNoteReference("正文", material("m1", "一封邮件", "邮件里的结论"));
    const refs = extractNoteReferences(body);
    expect(refs).toHaveLength(1);
    expect(refs[0].kind).toBe("material");
    expect(refs[0].noteId).toBe("m1");
    expect(body).toContain("knowflick://material/m1");
  });

  it("引用带内容指纹：源没改 → ok", () => {
    const src = source("n1", "源笔记", "原始内容");
    const body = applyNoteReference("正文", src);
    const refs = extractNoteReferences(body);
    const sources = new Map([["n1", src]]);
    expect(referenceStatus(refs[0], sources)).toBe("ok");
  });

  it("源内容被改过 → changed（可能已过期，需复核）", () => {
    const src = source("n1", "源笔记", "原始内容");
    const body = applyNoteReference("正文", src);
    const refs = extractNoteReferences(body);
    const changed = new Map([["n1", source("n1", "源笔记", "改过的内容")]]);
    expect(referenceStatus(refs[0], changed)).toBe("changed");
  });

  it("源被删 → missing（引用已失效）", () => {
    const src = source("n1", "源笔记", "原始内容");
    const body = applyNoteReference("正文", src);
    const refs = extractNoteReferences(body);
    expect(referenceStatus(refs[0], new Map())).toBe("missing");
  });

  it("只有标题变化不算内容变化（指纹只看正文）", () => {
    const src = source("n1", "源笔记", "原始内容");
    const body = applyNoteReference("正文", src);
    const refs = extractNoteReferences(body);
    const renamed = new Map([["n1", source("n1", "新标题", "原始内容")]]);
    expect(referenceStatus(refs[0], renamed)).toBe("ok");
  });
});
