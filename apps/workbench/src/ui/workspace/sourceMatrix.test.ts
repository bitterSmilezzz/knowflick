import { describe, expect, it } from "vitest";
import { entriesFor, filterEntries } from "./model";
import { sourceLabel } from "./Icon";
import type { RawMaterial } from "../../shell/store";

/** original 可能是卡片或素材，这里只关心素材。 */
const materialOf = (entry: { original?: unknown }): RawMaterial | null => {
  const original = entry.original as RawMaterial | undefined;
  return original && typeof (original as RawMaterial).sourceType === "string" ? original : null;
};

/**
 * 来源矩阵（不依赖浏览器的那一半）。
 *
 * 浏览器那半在 tools/source_matrix_smoke.mjs（要真实浏览器，CI 跑不了）。
 * 这里覆盖的是**逻辑层**：每种来源的搜索索引、来源标签、分类都要对。
 * 两者合起来才是完整的来源矩阵。
 */
const NOW = 1_700_000_000_000;

const SOURCES: Array<{ kind: string; title: string; text: string; meta: Record<string, unknown>; label: string }> = [
  { kind: "web", title: "剪藏标题", text: "网页剪藏的正文内容", meta: { subject: "剪藏标题" }, label: "example.test" },
  { kind: "email", title: "邮件标题", text: "邮件的正文内容", meta: { from: "someone@example.test", subject: "邮件标题" }, label: "邮件" },
  { kind: "document", title: "报告.docx", text: "文档的正文内容", meta: { fileName: "报告.docx" }, label: "文档" },
  { kind: "image", title: "截图.png", text: "图片素材占位", meta: { fileName: "截图.png", mime: "image/png" }, label: "图片" },
  { kind: "audio", title: "录音.webm", text: "语音转写的正文内容", meta: { fileName: "录音.webm" }, label: "语音" },
  { kind: "ink", title: "手写.json", text: "手写笔迹的占位内容", meta: { fileName: "手写.json" }, label: "手写笔记" },
  { kind: "manual", title: "随手记下的一条闪念", text: "随手记下的一条闪念", meta: {}, label: "随手灵感" },
];

const material = (kind: string, title: string, text: string, meta: Record<string, unknown>): RawMaterial => ({
  id: `src-${kind}`, sourceType: kind, title, sourceUrl: kind === "web" ? "https://example.test/post" : null,
  rawText: text, contentHash: "", mediaPath: null, mediaSizeBytes: 0,
  metadataJson: JSON.stringify(meta), inboxStatus: "inbox", createdAt: NOW, updatedAt: NOW,
});

const all = SOURCES.map((s) => material(s.kind, s.title, s.text, s.meta));
const allEntries = entriesFor(all, [], "library");

describe("来源矩阵：每种来源的搜索索引", () => {
  it("每种来源的正文都能被搜到", () => {
    for (const source of SOURCES) {
      const hits = filterEntries(allEntries, source.text.slice(0, 6));
      expect(hits.length, `${source.kind} 应能被正文搜到`).toBeGreaterThan(0);
      // 光有命中不够——还得是**对的那条**。只断言 >0 的话，
      // 「什么都搜得到」也能通过。
      expect(
        hits.some((hit) => materialOf(hit)?.id === `src-${source.kind}`),
        `${source.kind} 的正文应命中它自己那一条`,
      ).toBe(true);
    }
  });

  it("邮件能按发件人搜到", () => {
    const hits = filterEntries(allEntries, "someone@example.test");
    expect(hits.length).toBeGreaterThan(0);
    expect(materialOf(hits[0])?.sourceType).toBe("email");
  });

  it("文档与图片能按文件名搜到", () => {
    expect(filterEntries(allEntries, "报告.docx").length).toBeGreaterThan(0);
    expect(filterEntries(allEntries, "截图.png").length).toBeGreaterThan(0);
  });

  it("每种来源都有对应的分类（用户在库里据此筛选）", () => {
    const byKind = new Map(allEntries.map((e) => [materialOf(e)?.sourceType, e.category]));
    expect(byKind.get("email")).toBe("邮件");
    expect(byKind.get("web")).toBe("网页剪藏");
    expect(byKind.get("document")).toBe("导入文档");
    expect(byKind.get("image")).toBe("图片");
    expect(byKind.get("audio")).toBe("语音笔记");
    expect(byKind.get("ink")).toBe("手写笔记");
  });
});

describe("来源矩阵：每种来源都有可显示的来源标签", () => {
  it("标签不能是英文内部名，也不能是空", () => {
    for (const source of SOURCES) {
      const meta = JSON.parse(source.meta ? JSON.stringify(source.meta) : "{}") as Record<string, unknown>;
      const subscriptionId = typeof meta.subscriptionId === "string" ? meta.subscriptionId : null;
      const { label } = sourceLabel(
        source.kind,
        source.kind === "web" ? "https://example.test/post" : "",
        subscriptionId,
      );
      expect(label, `${source.kind} 的来源标签不该是内部名`).not.toBe(source.kind);
      expect(label.trim().length, `${source.kind} 的来源标签不该为空`).toBeGreaterThan(0);
    }
  });

  it("手写笔记的标签是中文（此前显示成英文 ink）", () => {
    expect(sourceLabel("ink", "", null).label).toBe("手写笔记");
  });

  it("订阅抓来的内容要标出「订阅」", () => {
    // 按域名分不出来自哪个订阅源，得单独标。
    expect(sourceLabel("web", "https://example.test/post", "sub-1").label).toBe("订阅");
  });
});
