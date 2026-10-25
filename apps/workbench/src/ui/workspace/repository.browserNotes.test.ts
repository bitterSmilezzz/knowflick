import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrowserNotesCorruptError,
  clearCorruptedNotesLockAndReset,
  readCorruptedNotesBackup,
  readNotes,
  saveNote,
} from "./repository";
import { createNoteDraft } from "../../domain/note";

/**
 * 浏览器笔记损坏保护（T07，审计 KF-010）：
 * 旧实现 JSON 解析失败或字段非数组直接静默返回空库，
 * 下一次保存把空库写回，导致原始数据永久丢失。
 * 现实现：损坏时隔离备份原始数据、锁定写入拒绝静默覆盖、提供导出恢复。
 */

const storage: Record<string, string> = {};

beforeEach(() => {
  for (const k of Object.keys(storage)) delete storage[k];
  const shell = {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => { storage[k] = v; },
    removeItem: (k: string) => { delete storage[k]; },
  };
  vi.stubGlobal("localStorage", shell);
  clearCorruptedNotesLockAndReset();
});
afterEach(() => {
  clearCorruptedNotesLockAndReset();
  vi.unstubAllGlobals();
});

describe("浏览器笔记损坏保护（KF-010）", () => {
  it("非合法 JSON：抛出 BrowserNotesCorruptError，隔离备份原始数据，拒绝静默覆盖", async () => {
    const broken = "this is not json { [ broken";
    storage["knowflick.notes.v1"] = broken;

    await expect(readNotes("")).rejects.toThrow(BrowserNotesCorruptError);
    // 原始损坏数据被隔离备份
    expect(readCorruptedNotesBackup()).toBe(broken);
    // 依然保存在主 key 里，没有被删掉
    expect(storage["knowflick.notes.v1"]).toBe(broken);

    // 下一次新建保存：必须拒绝覆盖损坏的存储！
    const draft = createNoteDraft();
    draft.title = "新笔记";
    await expect(saveNote(draft, 0, "")).rejects.toThrow(/锁定|损坏/);
    // 原始数据仍完好
    expect(storage["knowflick.notes.v1"]).toBe(broken);
  });

  it("截断的 JSON：拒绝静默当成空库，保留原始字节", async () => {
    const truncated = '{"notes":[{"id":"n1","title":"重要内容';
    storage["knowflick.notes.v1"] = truncated;

    await expect(readNotes("")).rejects.toThrow(BrowserNotesCorruptError);
    expect(readCorruptedNotesBackup()).toBe(truncated);
  });

  it("合法 JSON 但形状错误（notes 字段不是数组）：识别为损坏，不静默置空", async () => {
    const wrongShape = JSON.stringify({ notes: "not-an-array", knowledgeBases: [] });
    storage["knowflick.notes.v1"] = wrongShape;

    await expect(readNotes("")).rejects.toThrow(BrowserNotesCorruptError);
    expect(readCorruptedNotesBackup()).toBe(wrongShape);
  });

  it("notes 条目不是对象或缺少 id：识别为损坏", async () => {
    const corruptEntries = JSON.stringify({ notes: ["invalid-note-string"], knowledgeBases: [] });
    storage["knowflick.notes.v1"] = corruptEntries;

    await expect(readNotes("")).rejects.toThrow(BrowserNotesCorruptError);
  });

  it("正常数据平滑读取，不触发损坏保护", async () => {
    const valid = JSON.stringify({
      notes: [{ id: "n1", title: "正常笔记", bodyMd: "正文", currentRevision: 1 }],
      knowledgeBases: [],
      membership: {},
    });
    storage["knowflick.notes.v1"] = valid;

    const res = await readNotes("");
    expect(res.notes).toHaveLength(1);
    expect(res.notes[0].title).toBe("正常笔记");
    expect(readCorruptedNotesBackup()).toBeNull();
  });

  it("显式重置后允许重新正常写入", async () => {
    storage["knowflick.notes.v1"] = "broken";
    await expect(readNotes("")).rejects.toThrow(BrowserNotesCorruptError);

    // 用户确认重置
    clearCorruptedNotesLockAndReset();
    storage["knowflick.notes.v1"] = "";

    const draft = createNoteDraft();
    draft.title = "新笔记";
    await saveNote(draft, 0, "");
    const res = await readNotes("");
    expect(res.notes).toHaveLength(1);
  });
});
