import { describe, expect, it } from "vitest";
import { buildExportMarkdown, buildOutlineFromEvidence } from "./CreativeView";

/**
 * 创作台的草稿生成与导出（R4/D07）。
 *
 * R4 退出门槛是「创作草稿可以检查、修改与导出」——所以初稿生成**不依赖模型**：
 * 证据本身就能拼出可检查的大纲。没有模型也能走完整条链路。
 */

const noteEvidence = { kind: "note" as const, id: "n1", title: "北极项目决策", excerpt: "采用分阶段上线。" };
const cardEvidence = { kind: "card" as const, id: "c1", title: "一张卡片", excerpt: "卡片里的结论。" };

describe("创作台：按证据生成大纲", () => {
  it("每条证据一个小节，标题与摘录都在", () => {
    const outline = buildOutlineFromEvidence([noteEvidence, cardEvidence]);
    expect(outline).toContain("## 1. 北极项目决策");
    expect(outline).toContain("采用分阶段上线。");
    expect(outline).toContain("## 2. 一张卡片");
    expect(outline).toContain("卡片里的结论。");
  });

  it("无证据时返回空串（不凭空生成内容）", () => {
    expect(buildOutlineFromEvidence([])).toBe("");
  });

  it("无标题的证据有兜底说法，不留空标题", () => {
    const outline = buildOutlineFromEvidence([{ kind: "note", id: "n2", title: "", excerpt: "正文" }]);
    expect(outline).toContain("无标题笔记");
  });

  it("证据没有摘录时说明情况，而不是留一段空白", () => {
    const outline = buildOutlineFromEvidence([{ kind: "card", id: "c2", title: "标题", excerpt: "" }]);
    expect(outline).toContain("这条证据没有正文摘录");
  });

  it.each([
    ["development", "问题与目标", "实施与验证"],
    ["marketing", "受众与需求", "素材与行动提示"],
    ["social", "主题与读者", "结尾与互动"],
    ["research", "研究问题", "局限与待验证"],
  ] as const)("%s 模板提供对应结构并保留全部选中证据", (template, first, last) => {
    const outline = buildOutlineFromEvidence([noteEvidence, cardEvidence], template);
    expect(outline).toContain(`## ${first}`);
    expect(outline).toContain(`## ${last}`);
    expect(outline).toContain("### 1. 北极项目决策");
    expect(outline).toContain("采用分阶段上线。");
    expect(outline).toContain("### 2. 一张卡片");
    expect(outline).toContain("卡片里的结论。");
    expect(outline).toContain("请核对相关证据");
  });

  it("模板也不在无证据时生成内容", () => {
    expect(buildOutlineFromEvidence([], "research")).toBe("");
  });
});

describe("创作台：导出", () => {
  it("导出含标题、正文与证据清单（带可回原件的引用）", () => {
    const md = buildExportMarkdown("我的稿子", "这是正文。", [noteEvidence, cardEvidence]);
    expect(md).toContain("# 我的稿子");
    expect(md).toContain("这是正文。");
    expect(md).toContain("## 证据清单");
    expect(md).toContain("knowflick://note/n1");
    expect(md).toContain("knowflick://card/c1");
  });

  it("无标题时用兜底名", () => {
    const md = buildExportMarkdown("  ", "正文", []);
    expect(md).toContain("# 未命名草稿");
  });

  it("无证据时不生成空的证据清单段", () => {
    const md = buildExportMarkdown("标题", "正文", []);
    expect(md).not.toContain("## 证据清单");
  });
});
