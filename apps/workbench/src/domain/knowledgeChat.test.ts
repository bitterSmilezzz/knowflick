import { describe, expect, it } from "vitest";
import { buildKnowledgeChatBody, questionTokens, selectKnowledgeNotes } from "./knowledgeChat";

function note(id: string, title: string, body: string, updatedAt = 1) {
  return { id, title, body, deleted: false, updatedAt };
}

describe("知识问答检索", () => {
  it("中文按二字片段、英文按词拆词", () => {
    const tokens = questionTokens("Go 性能如何？");
    expect(tokens).toContain("go");
    expect(tokens).toContain("性能");
    expect(tokens).not.toContain("？");
  });

  it("只返回命中的笔记，按命中数排序", () => {
    const notes = [note("a", "架构笔记", "讨论 Go 服务的性能与并发"), note("b", "菜谱", "红烧肉做法"), note("c", "性能记录", "性能性能")];
    const picked = selectKnowledgeNotes(notes, "Go 性能", 2);
    expect(picked.map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("没有命中时返回空数组，不用无关资料凑数", () => {
    expect(selectKnowledgeNotes([note("a", "菜谱", "红烧肉")], "量子计算")).toEqual([]);
  });

  it("请求体包含系统提示、参考资料与问题", () => {
    const body = JSON.parse(buildKnowledgeChatBody("m", [{ id: "a", title: "架构笔记", excerpt: "正文" }], "怎么优化？"));
    expect(body.model).toBe("m");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].content).toContain("[笔记 1] 标题: 架构笔记");
    expect(body.messages[1].content).toContain("怎么优化？");
  });

  it("卡片与笔记片段作为附加参考资料进入请求体，引用提示同步提到", () => {
    const body = JSON.parse(buildKnowledgeChatBody("m", [{ id: "a", title: "架构笔记", excerpt: "正文" }], "怎么优化？", [], [
      { kind: "card", title: "卡片标题", body: "卡片正文" },
      { kind: "chunk", title: "来源笔记", body: "片段内容" },
    ]));
    expect(body.messages[1].content).toContain("[笔记 1] 标题: 架构笔记");
    expect(body.messages[1].content).toContain("[卡片 1] 标题: 卡片标题");
    expect(body.messages[1].content).toContain("[笔记片段 1] 来源: 来源笔记");
    expect(body.messages[0].content).toContain("【卡片 1】");
  });

  it("没有笔记命中但有卡片或片段时，上下文仍非空", () => {
    const body = JSON.parse(buildKnowledgeChatBody("m", [], "怎么优化？", [], [{ kind: "card", title: "卡片标题", body: "卡片正文" }]));
    expect(body.messages[1].content).toContain("[卡片 1] 标题: 卡片标题");
    expect(body.messages[1].content).not.toContain("[笔记 1]");
  });
});