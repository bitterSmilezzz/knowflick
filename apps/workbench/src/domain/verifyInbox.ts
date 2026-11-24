/**
 * 待验证清单的跨笔记汇总（C05）。
 *
 * 单篇正文里能看到自己标了几条（`❓`），但维护是**横向**的：用户需要知道
 * 「整个库还有多少条没核实」，而不是挨篇点开去数。
 *
 * 与引用体检同一套口径：回收站里的笔记不算（它自己都搜不到了），归档的照算。
 */

import { verifyItems } from "./noteVerify";

export interface VerifyInboxItem {
  noteId: string;
  noteTitle: string;
  /** 原文行号（0 基）。 */
  line: number;
  /** 去掉标记后的断言正文。 */
  text: string;
}

interface VerifyNote {
  id: string;
  title: string;
  bodyMd: string;
  isDeleted?: boolean;
}

/**
 * 全库待验证断言，按笔记标题拼音序 + 行号排序。
 *
 * 为什么带行号：用户看到「这条我核实过了」，要能直接改那一行，而不是重新找。
 */
export function collectVerifyItems(notes: readonly VerifyNote[]): VerifyInboxItem[] {
  const out: VerifyInboxItem[] = [];
  for (const note of notes) {
    if (note.isDeleted) continue;
    for (const item of verifyItems(note.bodyMd)) {
      out.push({
        noteId: note.id,
        noteTitle: note.title || "无标题笔记",
        line: item.line,
        text: item.text,
      });
    }
  }
  return out.sort(
    (a, b) => a.noteTitle.localeCompare(b.noteTitle, "zh-CN") || a.line - b.line,
  );
}

/** 汇总：一共几条待验证、涉及几篇笔记。 */
export function verifyTotals(items: readonly VerifyInboxItem[]): { items: number; notes: number } {
  return { items: items.length, notes: new Set(items.map((i) => i.noteId)).size };
}
