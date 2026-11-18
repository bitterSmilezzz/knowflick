import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BrainAssistantDrawer,
  artifactInProjectKnowledgeScope,
  buildFollowUpHistory,
  buildKnowledgeChatRequestBody,
  buildProfileMemoryPromptContext,
} from "./BrainViews";
import { defaultSettings, type AiSettings } from "../domain/settings";
import type { KnowledgeCard } from "../domain/card";

/**
 * 回答里的引用要能回原件（R4 退出门槛「每个引用可回原件」）。
 *
 * 笔记段落也进回答上下文（R2 分块召回），此前它们**不进引用清单**——
 * 用户看到答案里引用了某篇笔记的段落，却没有任何入口能跳回那篇笔记。
 * 这里锁住：笔记引用出现在引用区，且源笔记被删后标成「已删除」而不是静默失效。
 */

const CHAT_STORE_KEY = "knowflick.workspace.chat";

const settings: AiSettings = { ...defaultSettings };

beforeEach(() => {
  const store: Record<string, string> = {
    [CHAT_STORE_KEY]: JSON.stringify([
      {
        role: "assistant",
        content: "答案正文",
        cited: [
          { id: "card-1", headline: "一张卡片", kind: "card" },
          { id: "note-1", headline: "源笔记", kind: "note" },
        ],
      },
    ]),
  };
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
});
afterEach(() => vi.unstubAllGlobals());

const card = (id: string): KnowledgeCard =>
  ({
    id, headline: "一张卡片", summary: "s", details: "d", category: "c", tags: [], links: [],
    source: "imported", createdAt: 1, editedAt: null, updatedAt: 1, version: 1,
    materialId: null, isFavorite: false, favoritedAt: null, reviewCount: 0, masteryLevel: 0,
    lastReviewedAt: null, repetition: 0, intervalDays: 0, easeFactor: 2.5, stability: 0, difficulty: 0,
  }) as unknown as KnowledgeCard;

function render(notes: Array<{ id: string; title: string }>): string {
  return renderToStaticMarkup(
    <BrainAssistantDrawer
      cards={[card("card-1")]}
      notes={notes}
      settings={settings}
      apiKey="sk-test"
      onOpenCard={() => {}}
      onOpenNote={() => {}}
    />
  );
}

describe("回答里的引用可回原件（R4 门槛）", () => {
  it("笔记引用出现在引用区（此前只有卡片引用）", () => {
    const html = render([{ id: "note-1", title: "源笔记" }]);
    expect(html).toContain("参考来源");
    expect(html).toContain("笔记《源笔记》");
    expect(html).toContain("一张卡片");
  });

  it("源笔记被删后标成「已删除」而不是静默跳到别的条目", () => {
    const html = render([]); // 笔记已不在库里
    expect(html).toContain("笔记《源笔记》（已删除）");
    // 不可点：失效引用不该是能点的 chip
    expect(html).not.toContain("ws-cite-note");
  });

  it("旧格式的引用（没有 kind）仍按卡片渲染，不丢历史引用", () => {
    const store: Record<string, string> = {
      [CHAT_STORE_KEY]: JSON.stringify([
        { role: "assistant", content: "旧答案", cited: [{ id: "card-1", headline: "一张卡片" }] },
      ]),
    };
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    });
    const html = render([]);
    expect(html).toContain("一张卡片");
  });

  it("标明回答曾使用的个人记忆数量", () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => key === CHAT_STORE_KEY ? JSON.stringify([
        { role: "assistant", content: "按我的偏好整理", memoryClaimIds: ["profile-1", "profile-2"] },
      ]) : null,
      setItem: () => {},
      removeItem: () => {},
    });
    const html = render([]);
    expect(html).toContain("本次回答使用了 2 条已确认的个人记忆");
  });
});

describe("逐次同意个人记忆（R4/D05）", () => {
  const claim = { id: "profile-1", content: "回答偏好直接简短" };

  it("默认未同意时不把记忆内容放进模型上下文", () => {
    const prompt = buildProfileMemoryPromptContext([claim], false);
    expect(prompt.promptContext).toBe("");
    expect(prompt.memoryClaimIds).toEqual([]);
  });

  it("用户同意本次提问后才包含记忆并记录来源 ID", () => {
    const prompt = buildProfileMemoryPromptContext([claim], true);
    expect(prompt.promptContext).toContain(JSON.stringify([claim.content]));
    expect(prompt.memoryClaimIds).toEqual([claim.id]);
  });

  it("未再次同意或任一记忆已撤销时，不把旧记忆回答带入后续上下文", () => {
    const history = [
      { role: "assistant" as const, content: "你好" },
      { role: "user" as const, content: "我偏好什么？" },
      { role: "assistant" as const, content: "你偏好简短回答。", memoryClaimIds: ["profile-1", "profile-2"] },
      { role: "assistant" as const, content: "另一个没有使用个人记忆的回答。" },
    ];

    expect(buildFollowUpHistory(history, false, new Set(["profile-1", "profile-2"]))).toEqual([
      { role: "user", content: "我偏好什么？" },
      { role: "assistant", content: "另一个没有使用个人记忆的回答。" },
    ]);
    expect(buildFollowUpHistory(history, true, new Set(["profile-1"]))).toEqual([
      { role: "user", content: "我偏好什么？" },
      { role: "assistant", content: "另一个没有使用个人记忆的回答。" },
    ]);
    expect(buildFollowUpHistory(history, true, new Set(["profile-1", "profile-2"]))).toEqual([
      { role: "user", content: "我偏好什么？" },
      { role: "assistant", content: "你偏好简短回答。" },
      { role: "assistant", content: "另一个没有使用个人记忆的回答。" },
    ]);
  });

  it("生成的模型请求只携带本次同意且仍可用的记忆", () => {
    const priorMessages = [
      { role: "assistant" as const, content: "你好" },
      { role: "user" as const, content: "我偏好什么？" },
      { role: "assistant" as const, content: "旧的记忆回答", memoryClaimIds: [claim.id] },
    ];
    const buildRequest = (consented: boolean, availableClaims: typeof claim[]) => JSON.parse(buildKnowledgeChatRequestBody({
      model: "test-model",
      systemPrompt: "system prompt",
      cardContext: "卡片事实",
      noteContext: "",
      artifactContext: "",
      profileMemoryPrompt: buildProfileMemoryPromptContext(availableClaims, consented),
      question: "新的问题",
      priorMessages,
      includeProfileMemory: consented,
      availableProfileMemoryIds: new Set(availableClaims.map(({ id }) => id)),
    })) as { model: string; messages: Array<{ role: string; content: string }>; temperature: number };

    const consentedRequest = buildRequest(true, [claim]);
    expect(consentedRequest.model).toBe("test-model");
    expect(consentedRequest.messages.some((message) => message.content === "旧的记忆回答")).toBe(true);
    expect(consentedRequest.messages.at(-1)?.content).toContain(claim.content);
    expect(consentedRequest.messages.at(-1)?.content).toContain("新的问题");

    const declinedRequest = buildRequest(false, [claim]);
    expect(declinedRequest.messages.some((message) => message.content.includes(claim.content))).toBe(false);
    expect(declinedRequest.messages.some((message) => message.content === "旧的记忆回答")).toBe(false);

    const revokedRequest = buildRequest(true, []);
    expect(revokedRequest.messages.some((message) => message.content.includes(claim.content))).toBe(false);
    expect(revokedRequest.messages.some((message) => message.content === "旧的记忆回答")).toBe(false);
  });

  it("项目记忆请求标明项目范围，且不会带入仅获准全局记忆的旧回答", () => {
    const projectClaim = { id: "project-claim", content: "项目甲决定先完成离线搜索" };
    const priorMessages = [
      { role: "assistant" as const, content: "全局记忆回答", memoryClaimIds: ["global-claim"], memoryScopeLabel: "全局" },
    ];
    const body = JSON.parse(buildKnowledgeChatRequestBody({
      model: "test-model",
      systemPrompt: "system prompt",
      cardContext: "全库卡片参考",
      noteContext: "",
      artifactContext: "",
      profileMemoryPrompt: buildProfileMemoryPromptContext([projectClaim], true, "项目「项目甲」"),
      question: "项目下一步是什么？",
      priorMessages,
      includeProfileMemory: true,
      availableProfileMemoryIds: new Set(["global-claim", "project-claim"]),
    })) as { messages: Array<{ role: string; content: string }> };
    expect(body.messages.some((message) => message.content === "全局记忆回答")).toBe(false);
    expect(body.messages.at(-1)?.content).toContain(JSON.stringify("项目「项目甲」"));
    expect(body.messages.at(-1)?.content).toContain(projectClaim.content);
    expect(body.messages.at(-1)?.content).not.toContain("global-claim");
  });

  it("切换知识范围后，旧范围的问答不会进入追问上下文", () => {
    const history = [
      { role: "assistant" as const, content: "你好" },
      { role: "user" as const, content: "全局问题", knowledgeScopeId: "" },
      { role: "assistant" as const, content: "全局回答", knowledgeScopeId: "" },
      { role: "user" as const, content: "项目甲问题", knowledgeScopeId: "project-a" },
      { role: "assistant" as const, content: "项目甲回答", knowledgeScopeId: "project-a" },
      { role: "user" as const, content: "项目乙问题", knowledgeScopeId: "project-b" },
      { role: "assistant" as const, content: "项目乙回答", knowledgeScopeId: "project-b" },
    ];

    expect(buildFollowUpHistory(history, false, new Set(), new Set(), "project-a")).toEqual([
      { role: "user", content: "项目甲问题" },
      { role: "assistant", content: "项目甲回答" },
    ]);
    expect(buildFollowUpHistory(history, false, new Set())).toEqual([
      { role: "user", content: "全局问题" },
      { role: "assistant", content: "全局回答" },
    ]);
  });

  it("项目产物只在全部来源都属于所选项目时进入检索", () => {
    const scope = { cardIds: new Set(["card-a"]), noteIds: new Set(["note-a"]) };
    const artifact = {
      id: "artifact-a", artifactType: "briefing", title: "简报", contentMarkdown: "内容",
      sourceCardIds: ["card-a"], sourceNoteIds: ["note-a"], createdAt: 1, updatedAt: 1,
    };
    expect(artifactInProjectKnowledgeScope(artifact, scope)).toBe(true);
    expect(artifactInProjectKnowledgeScope({ ...artifact, sourceCardIds: ["card-a", "card-outside"] }, scope)).toBe(false);
    expect(artifactInProjectKnowledgeScope({ ...artifact, sourceCardIds: [], sourceNoteIds: [] }, scope)).toBe(false);
  });

  it("桌面问答默认选择全部知识，并把项目记忆同意单独呈现", () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const html = renderToStaticMarkup(
      <BrainAssistantDrawer
        cards={[card("card-1")]}
        projects={[{ id: "project-a", name: "项目甲", description: "", createdAt: 1, updatedAt: 1, archivedAt: null }]}
        projectsStatus="ready"
        projectKnowledgeScopes={{ "project-a": { cardIds: ["card-1"], noteIds: [] } }}
        projectKnowledgeScopesStatus="ready"
        settings={settings}
        apiKey="sk-test"
        onOpenCard={() => {}}
      />,
    );
    expect(html).toContain('aria-label="本次问答范围"');
    expect(html).toContain("全部知识");
    expect(html).toContain("项目甲");
    expect(html).toContain("本次回答使用已确认的全局记忆");
    expect(html).toContain("先选本次问答的知识范围");
  });
});
