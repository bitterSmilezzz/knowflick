import { describe, expect, it } from "vitest";
import {
  applyNoteReference,
  extractNoteReferences,
  noteReferenceLine,
  referencesNote,
  NOTE_URI_SCHEME,
} from "./noteReference";
import { createNoteDraft } from "./note";

/**
 * 笔记引用的契约（B04 关联 / G01）：
 * 可回原件（带源 id）、可读（普通 Markdown 引用块）、可解析（能读回结构化条目）。
 */

const note = (id: string, title: string, body = "被引用的正文内容") => ({
  ...createNoteDraft(1000),
  id,
  title,
  bodyMd: body,
});

describe("笔记引用（noteReference）", () => {
  it("引用行含标题、片段与可回原件链接", () => {
    const line = noteReferenceLine(note("n1", "源笔记"), "关键结论");
    expect(line).toContain("《源笔记》");
    expect(line).toContain("关键结论");
    expect(line).toContain(`${NOTE_URI_SCHEME}n1`);
  });

  it("片段过长时截断并加省略号", () => {
    const line = noteReferenceLine(note("n1", "源笔记"), "长".repeat(400));
    expect(line.length).toBeLessThan(260);
    expect(line).toContain("…");
  });

  it("插入到正文末尾，保留原内容", () => {
    const body = applyNoteReference("我原来的正文", note("n1", "源笔记"), "片段");
    expect(body).toContain("我原来的正文");
    expect(body).toContain("《源笔记》");
  });

  it("正文为空时只放引用，不留前导空行", () => {
    const body = applyNoteReference("", note("n1", "源笔记"));
    expect(body.startsWith("> 《")).toBe(true);
  });

  it("能解析回结构化引用", () => {
    const body = applyNoteReference("正文", note("n7", "另一篇"), "结论在这里");
    const refs = extractNoteReferences(body);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ noteId: "n7", title: "另一篇", excerpt: "结论在这里" });
  });

  it("解析不出没有回原件链接的伪引用", () => {
    const body = "> 《看起来像引用》：但没有原件链接";
    expect(extractNoteReferences(body)).toHaveLength(0);
  });

  it("反向链接判定：正文是否引用了某篇笔记", () => {
    const body = applyNoteReference("正文", note("n9", "被引用的那篇"));
    expect(referencesNote(body, "n9")).toBe(true);
    expect(referencesNote(body, "n8")).toBe(false);
  });

  it("多篇引用按正文顺序返回", () => {
    let body = applyNoteReference("正文", note("a", "甲篇"));
    body = applyNoteReference(body, note("b", "乙篇"));
    expect(extractNoteReferences(body).map((r) => r.noteId)).toEqual(["a", "b"]);
  });
});

describe("引用的失效识别（源笔记被删后）", () => {
  it("源笔记不在库里时引用仍可解析（带 id，可判断失效）", () => {
    const body = applyNoteReference("正文", note("gone", "已被删除的笔记"));
    const refs = extractNoteReferences(body);
    expect(refs).toHaveLength(1);
    expect(refs[0].noteId).toBe("gone");
    // 引用本身不依赖源笔记还在——失效判断由「库里找不到这个 id」得出
    expect(refs[0].title).toBe("已被删除的笔记");
  });

  it("改标题不破坏引用：解析靠 id，不靠标题", () => {
    const original = note("stable-id", "旧标题");
    let body = applyNoteReference("正文", original);
    // 源笔记改名后重新生成引用：id 不变，标题变了
    const renamed = { ...original, title: "新标题" };
    body = applyNoteReference(body, renamed);
    const refs = extractNoteReferences(body);
    expect(refs.map((r) => r.noteId)).toEqual(["stable-id", "stable-id"]);
    expect(refs[1].title).toBe("新标题");
  });
});
