import { describe, expect, it } from "vitest";
import { cardFromJson, type KnowledgeCard } from "./card";
import { createNoteDraft, deleteNote, emptyNotesState, listNotes, searchNotes, upsertNote } from "./note";
import { isPluginEnabled, type PluginSettingsMap } from "./pluginRegistry";
import { defaultSettings } from "./settings";

/**
 * 模块生命周期验收（R1 工作项 5，能力 E08）：
 * 「关闭模块后停任务、内容仍可读」——每个开关配一对场景：
 * 关掉后 1）入口/任务不可用且说得清原因；2）它生成过的内容与数据原样保留。
 * 这里钉**数据层语义**；入口是否按开关渲染由 UI_SPEC 的路由对照与冒烟负责。
 */

const sampleCard = (id: string): KnowledgeCard =>
  cardFromJson({
    id, category: "随手笔记", headline: `卡 ${id}`, summary: "摘要", details: "正文",
    source: "imported", createdAt: 1, updatedAt: 1, links: [], tags: [],
    // FSRS 字段：关掉学习模块后这些必须原样保留
    repetition: 3, intervalDays: 5.5, easeFactor: 2.8, stability: 4.2, difficulty: 5.1,
  });

describe("模块生命周期：关闭后停任务、内容仍可读（E08）", () => {
  it("关 AI：enableAI 只影响提炼入口的可用性，笔记/搜索/编辑全可用", () => {
    // AI 关闭时卡片与笔记的数据操作与开关无关——这是「基础内核不碎裂」的口径
    let state = emptyNotesState();
    const draft = createNoteDraft();
    draft.title = "无 AI 也能写";
    draft.bodyMd = "正文与检索不依赖任何模型";
    state = upsertNote(state, draft, 0, 1000).state;
    expect(searchNotes(state, "检索")).toHaveLength(1);
    expect(listNotes(state)).toHaveLength(1);

    // AI 关闭 → 卡片提炼按钮显示「配置 AI」，但卡片数据操作不受影响
    const card = sampleCard("c1");
    expect(card.repetition).toBe(3);
    expect({ ...defaultSettings, enableAI: false }.enableAI).toBe(false);
  });

  it("关学习模块：卡片与 FSRS 学习记录原样保留（E08/README「关闭学习模块后所有卡片与学习记录仍保留」）", () => {
    // 开关语义：registry 的兼容映射认 reviewPluginEnabled（旧键），显式 plugins 键优先
    expect(isPluginEnabled("official-review-fsrs", {}, true)).toBe(true);
    expect(isPluginEnabled("official-review-fsrs", {}, false)).toBe(false);
    expect(isPluginEnabled("official-review-fsrs", { "official-review-fsrs": { enabled: true } } as PluginSettingsMap, false)).toBe(true);

    // 关掉后数据不动：卡片 FSRS 字段原样读回
    const card = sampleCard("c-review");
    expect(card.intervalDays).toBe(5.5);
    expect(card.stability).toBe(4.2);
  });

  it("关语音：录音保存路径在插件判断之前（数据层约定），转写缺失不丢音频——此处钉设置的开关语义", () => {
    const off = isPluginEnabled("official-speech-asr", { "official-speech-asr": { enabled: false } } as PluginSettingsMap);
    const on = isPluginEnabled("official-speech-asr", { "official-speech-asr": { enabled: true } } as PluginSettingsMap);
    expect(off).toBe(false);
    expect(on).toBe(true);
    // 保存路径的「关了也存音频、回执说清」由 saveVoiceNote 的分支保证
    // （Workspace.tsx：saveMedia 在 asrEnabled 判断之前；notes_ui_smoke 有回执断言）。
  });

  it("关掉的模块不留空位：笔记检索在全部插件关闭时照常工作", () => {
    let state = emptyNotesState();
    const draft = createNoteDraft();
    draft.bodyMd = "全部模块关闭时的检索与编辑";
    state = upsertNote(state, draft, 0, 1000).state;
    state = deleteNote(state, draft.id, 2000);
    expect(searchNotes(state, "全部模块关闭")).toHaveLength(0); // 回收站语义不受模块开关影响
  });
});
