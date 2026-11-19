import { describe, expect, it } from "vitest";
import { attachmentKindLabel, attachmentKindOf } from "./attachmentKind";

describe("库内附件的种类判定（B06）", () => {
  it("按目录名认出三种附件", () => {
    expect(attachmentKindOf("media/image/a.png")).toBe("image");
    expect(attachmentKindOf("media/audio/a.webm")).toBe("audio");
    expect(attachmentKindOf("media/ink/a.json")).toBe("ink");
  });

  it("外链与路径穿越不当附件（否则能用正文探测文件系统）", () => {
    expect(attachmentKindOf("https://x/y.png")).toBeNull();
    expect(attachmentKindOf("../../../etc/passwd")).toBeNull();
    expect(attachmentKindOf("media/image/../../secret.png")).toBeNull();
    expect(attachmentKindOf("media/video/a.mp4")).toBeNull();
    expect(attachmentKindOf("media/image/a/b.png")).toBeNull();
    expect(attachmentKindOf("")).toBeNull();
  });

  it("两边空白不影响判定", () => {
    expect(attachmentKindOf("  media/image/a.png  ")).toBe("image");
  });

  it("界面用中文名，不用英文内部名", () => {
    expect(attachmentKindLabel("audio")).toBe("录音");
    expect(attachmentKindLabel("ink")).toBe("手写笔迹");
    expect(attachmentKindLabel("image")).toBe("图片");
  });
});
