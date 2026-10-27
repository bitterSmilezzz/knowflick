import { describe, expect, it } from "vitest";
import { attachmentBlob, attachmentMime, hasReadableAttachment, inlineImageUrl } from "./attachment";
import type { RawMaterial } from "../../shell/store";

function material(extra: Partial<RawMaterial> = {}): RawMaterial {
  return {
    id: "m1",
    sourceType: "audio",
    title: "语音笔记",
    sourceUrl: null,
    rawText: "（语音笔记，3 秒）",
    contentHash: "",
    mediaPath: "media/audio/x.webm",
    mediaSizeBytes: 8,
    metadataJson: JSON.stringify({ mime: "audio/webm" }),
    inboxStatus: "inbox",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...extra,
  };
}

describe("附件读回", () => {
  it("宿主读回来的字节原样变成 Blob（附件是用户自己录的，不能被悄悄改）", async () => {
    // Tauri 对 Vec<u8> 的默认序列化就是数字数组。
    const original = [0x1a, 0x45, 0xdf, 0xa3, 0x00, 0xff, 0x7f, 0x80];
    const blob = attachmentBlob(original, "audio/webm");
    expect(blob.type).toBe("audio/webm");
    expect(blob.size).toBe(original.length);
    const back = new Uint8Array(await blob.arrayBuffer());
    expect([...back]).toEqual(original);
  });

  it("已经是 Uint8Array 也能读回同样的字节", async () => {
    const original = new Uint8Array([1, 2, 3, 250, 251]);
    const blob = attachmentBlob(original, "audio/webm");
    const back = new Uint8Array(await blob.arrayBuffer());
    expect([...back]).toEqual([1, 2, 3, 250, 251]);
  });

  it("字节被截断或错位时要能看出来（读回 8 字节不该变成 9 字节）", async () => {
    const blob = attachmentBlob([1, 2, 3], "audio/webm");
    expect(blob.size).toBe(3);
  });

  it("空字节数组得到空 Blob，而不是抛错", () => {
    const blob = attachmentBlob([], "audio/webm");
    expect(blob.size).toBe(0);
  });

  it("MIME 以存盘时记下的为准", () => {
    expect(attachmentMime(material({ metadataJson: JSON.stringify({ mime: "audio/mp4" }) }))).toBe("audio/mp4");
    // 缺 mime 时按来源类型兜底
    expect(attachmentMime(material({ metadataJson: "{}" }))).toBe("audio/webm");
    expect(attachmentMime(material({ sourceType: "image", metadataJson: "{}" }))).toBe("image/png");
    // metadataJson 坏了也不能崩
    expect(attachmentMime(material({ metadataJson: "not json" }))).toBe("audio/webm");
  });

  it("浏览器体验里的内嵌图片只认 data:image/", () => {
    const ok = material({
      sourceType: "image",
      mediaPath: null,
      metadataJson: JSON.stringify({ dataUrl: "data:image/png;base64,AAAA" }),
    });
    expect(inlineImageUrl(ok)).toBe("data:image/png;base64,AAAA");
    // 非图片的 data URL 不算附件
    const notImage = material({ mediaPath: null, metadataJson: JSON.stringify({ dataUrl: "data:text/plain,x" }) });
    expect(inlineImageUrl(notImage)).toBeNull();
    // metadataJson 坏了
    expect(inlineImageUrl(material({ mediaPath: null, metadataJson: "{" }))).toBeNull();
  });

  it("「有可读附件」不等于「有 mediaPath」——内嵌图片也算", () => {
    expect(hasReadableAttachment(material())).toBe(true);
    expect(hasReadableAttachment(material({
      sourceType: "image",
      mediaPath: null,
      metadataJson: JSON.stringify({ dataUrl: "data:image/png;base64,AAAA" }),
    }))).toBe(true);
    expect(hasReadableAttachment(material({ mediaPath: null, metadataJson: "{}" }))).toBe(false);
  });
});
