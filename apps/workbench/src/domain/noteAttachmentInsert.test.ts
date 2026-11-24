import { describe, expect, it } from "vitest";
import { attachmentAlt, insertAttachmentRef } from "./noteAttachmentInsert";

const at = (text: string, start: number, end = start) => ({ text, start, end });

describe("正文插入附件引用（B06）", () => {
  it("说明文字取标题并去掉扩展名", () => {
    expect(attachmentAlt("流程图.png")).toBe("流程图");
    expect(attachmentAlt("  会议 录音 .webm")).toBe("会议 录音");
    expect(attachmentAlt("")).toBe("附件");
    expect(attachmentAlt(".png")).toBe("附件");
  });

  it("标题中的方括号不会截断 Markdown 附件说明", () => {
    const out = insertAttachmentRef(at("", 0), "media/image/a.png", "  流程图 [新版].png  ");
    expect(out.text).toBe("![流程图 ［新版］](media/image/a.png)\n");
  });

  it("过长的标题截断，避免把正文冲散", () => {
    const long = "很".repeat(60);
    const alt = attachmentAlt(long);
    expect(alt.length).toBe(41);
    expect(alt.endsWith("…")).toBe(true);
  });

  it("插在光标处，不是一律追加到末尾", () => {
    const out = insertAttachmentRef(at("第一段\n\n第三段", 5), "media/image/a.png", "图一.png");
    // 插入点前已有空行 → 不再补前导；后面紧跟文字 → 补一个空行把图片隔成独立段落。
    expect(out.text).toBe("第一段\n\n![图一](media/image/a.png)\n\n第三段");
  });

  it("选区非空时替换选中内容", () => {
    const out = insertAttachmentRef(at("保留[替换我]保留", 2, 6), "media/audio/a.webm", "录音");
    expect(out.text).not.toContain("替换我");
    expect(out.text).toContain("![录音](media/audio/a.webm)");
    expect(out.text.startsWith("保留")).toBe(true);
  });

  it("保留选区后的段落空行，光标位于附件下一行", () => {
    const out = insertAttachmentRef(at("首段\n\n替换这里\n\n末段", 4, 8), "media/image/a.png", "图一");
    expect(out.text).toBe("首段\n\n![图一](media/image/a.png)\n\n末段");
    expect(out.text.slice(out.start)).toBe("\n末段");
    expect(out.start).toBe(out.end);
  });

  it("空正文：不留下多余空行", () => {
    const out = insertAttachmentRef(at("", 0), "media/image/a.png", "图一.png");
    expect(out.text).toBe("![图一](media/image/a.png)\n");
  });

  it("插入后光标落在引用之后，用户能接着写", () => {
    const out = insertAttachmentRef(at("前面", 2), "media/image/a.png", "图一.png");
    expect(out.text.slice(0, out.start).endsWith("![图一](media/image/a.png)\n")).toBe(true);
    expect(out.start).toBe(out.end);
  });
});
