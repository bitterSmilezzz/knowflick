import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BrainAssistantDrawer } from "./BrainViews";
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
});
