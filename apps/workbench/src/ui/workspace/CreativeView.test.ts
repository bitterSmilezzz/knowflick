import { describe, expect, it } from "vitest";
import { buildExportMarkdown, buildOutlineFromEvidence, creativeEvidenceInScope } from "./CreativeView";
import type { KnowledgeCard } from "../../domain/card";
import type { Note } from "../../domain/note";

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
    ["meeting", "会议背景与参与者", "待确认问题"],
    ["reading", "作品与阅读目的", "可应用结论"],
    ["weekly", "本周进展", "需要协作"],
    ["learning", "学习目标与验收", "复盘与调整"],
    ["comparison", "比较对象与范围", "结论与条件"],
    ["marketingPack", "目标受众与场景", "行动提示与合规核对"],
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

  it("项目范围写入 Markdown 导出，并压平项目名换行", () => {
    const md = buildExportMarkdown("标题", "正文", [noteEvidence], "项目《北极\n计划》");
    expect(md).toContain("> 知识范围：项目《北极 计划》");
    expect(md).toContain("knowflick://note/n1");
  });
});

describe("创作台：项目知识范围", () => {
  const notes: Array<Pick<Note, "id" | "title" | "bodyMd" | "isDeleted">> = [
    { id: "n-a", title: "甲笔记", bodyMd: "甲内容", isDeleted: false },
    { id: "n-b", title: "乙笔记", bodyMd: "乙内容", isDeleted: false },
    { id: "n-deleted", title: "已删除", bodyMd: "旧内容", isDeleted: true },
  ];
  const cards: Array<Pick<KnowledgeCard, "id" | "headline" | "summary" | "details">> = [
    { id: "c-a", headline: "甲卡", summary: "甲摘录", details: "甲详情" },
    { id: "c-b", headline: "乙卡", summary: "乙摘录", details: "乙详情" },
  ];

  it("只返回该项目的成员笔记与来源卡片", () => {
    const evidence = creativeEvidenceInScope(cards, notes, "project-a", {
      "project-a": { noteIds: ["n-a", "n-deleted"], cardIds: ["c-a"] },
      "project-b": { noteIds: ["n-b"], cardIds: ["c-b"] },
    }, true);
    expect(evidence.map(({ kind, id }) => `${kind}:${id}`)).toEqual(["note:n-a", "card:c-a"]);
  });

  it("项目或成员索引不可用时按空集处理，不回退到全库候选", () => {
    expect(creativeEvidenceInScope(cards, notes, "project-a", undefined, false)).toEqual([]);
    expect(creativeEvidenceInScope(cards, notes, "project-missing", {}, true)).toEqual([]);
  });

  it("全部知识范围保持全库候选并排除已删除笔记", () => {
    const evidence = creativeEvidenceInScope(cards, notes, "", undefined, false);
    expect(evidence.map(({ kind, id }) => `${kind}:${id}`)).toEqual(["note:n-a", "note:n-b", "card:c-a", "card:c-b"]);
  });
});
