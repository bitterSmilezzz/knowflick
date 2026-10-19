import { describe, expect, it } from "vitest";
import {
  cardToMarkdown,
  markdownToCardPartial,
  generateMarkdownVault,
  createZipArchive,
} from "./markdownExport";
import { extractFileFromZip } from "./documentParser";
import type { KnowledgeCard } from "./card";
import type { RawMaterial } from "../shell/store";

describe("Markdown 标准化导出与往返恢复测试 (M4 数据主权)", () => {
  const sampleCard: KnowledgeCard = {
    id: "card-roundtrip-1",
    category: "AI架构",
    headline: "SQLite-vec 向量检索在端侧的性能边界",
    summary: "在万级条目以内，暴力扫描 p99 仅 12ms",
    details: "通过 SQLite 单文件存储，不需要外部复杂服务，同时结合 FTS5 全文索引。",
    links: [{ title: "SQLite 官网", url: "https://sqlite.org" }],
    source: "imported",
    createdAt: 1700000000000,
    editedAt: null,
    seenAt: 1700000010000,
    swiped: "right",
    isFavorite: true,
    favoritedAt: 1700000010000,
    reviewCount: 2,
    masteryLevel: 1,
    lastReviewedAt: 1700000020000,
    repetition: 2,
    intervalDays: 4.5,
    easeFactor: 2.5,
    stability: 0,
    difficulty: 0,
    subject: null,
    branch: null,
    level: null,
    track: null,
    orderKey: null,
    prereq: [],
    tags: ["SQLite", "向量检索", "端侧架构"],
  };

  const sampleMaterial: RawMaterial = {
    id: "mat-1",
    sourceType: "web",
    title: "Rust 异步运行时分析",
    rawText: "Tokio 与 async-std 的核心调度对比。",
    sourceUrl: "https://example.com/rust",
    cleanedMarkdown: null,
    contentHash: "",
    mediaPath: null,
    mediaSizeBytes: 0,
    metadataJson: "{}",
    inboxStatus: "inbox",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  it("导出为带 Frontmatter 的标准 Markdown 字符串", () => {
    const md = cardToMarkdown(sampleCard);

    expect(md).toContain('id: "card-roundtrip-1"');
    expect(md).toContain('category: "AI架构"');
    expect(md).toContain('tags: ["SQLite", "向量检索", "端侧架构"]');
    expect(md).toContain("# SQLite-vec 向量检索在端侧的性能边界");
    expect(md).toContain("> **摘要**：在万级条目以内，暴力扫描 p99 仅 12ms");
    expect(md).toContain("## 核心内容");
    expect(md).toContain("通过 SQLite 单文件存储");
    expect(md).toContain("- [SQLite 官网](https://sqlite.org)");
  });

  it("能从导出的 Markdown 中无损反向解析关键信息", () => {
    const md = cardToMarkdown(sampleCard);
    const restored = markdownToCardPartial(md);

    expect(restored).not.toBeNull();
    expect(restored?.id).toBe(sampleCard.id);
    expect(restored?.headline).toBe(sampleCard.headline);
    expect(restored?.category).toBe(sampleCard.category);
    expect(restored?.summary).toBe(sampleCard.summary);
    expect(restored?.details).toBe(sampleCard.details);
    expect(restored?.source).toBe(sampleCard.source);
  });

  it("将整库素材与卡片生成分类分层 Markdown 文件体系", () => {
    const vault = generateMarkdownVault([sampleMaterial], [sampleCard]);
    expect(vault.length).toBe(2);

    const cardItem = vault.find((v) => v.path.includes("AI架构"));
    expect(cardItem).toBeDefined();
    expect(cardItem?.path).toBe("AI架构/SQLite-vec 向量检索在端侧的性能边界.md");
    expect(cardItem?.content).toContain("# SQLite-vec 向量检索在端侧的性能边界");

    const matItem = vault.find((v) => v.path.includes("收件箱"));
    expect(matItem).toBeDefined();
    expect(matItem?.path).toBe("收件箱/Rust 异步运行时分析.md");
    expect(matItem?.content).toContain('type: "raw_material"');
  });

  it("创建标准 ZIP 压缩包并能被正确解压读取 (往返自洽验证)", async () => {
    const files = [
      { path: "测试/hello.md", data: "# Hello World\n\n来自测试用例。" },
      { path: "second.txt", data: "纯文本第二项内容。" },
    ];

    const zipBytes = createZipArchive(files);
    expect(zipBytes.length).toBeGreaterThan(100);

    // 使用 documentParser 中的 extractFileFromZip 验证
    const extracted1 = await extractFileFromZip(zipBytes, "测试/hello.md");
    expect(extracted1).toBe("# Hello World\n\n来自测试用例。");

    const extracted2 = await extractFileFromZip(zipBytes, "second.txt");
    expect(extracted2).toBe("纯文本第二项内容。");
  });
});
