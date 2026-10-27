import { restoreNoteFromBackup, createKnowledgeBaseNamed, restoreMembershipFromBackup, readNotes } from "./repository";
import type { KnowledgeBase, Note } from "../../domain/note";

/**
 * 备份恢复时把笔记与知识库写回当前库（契约 docs/NOTES_MODEL.md「导出与恢复」；
 * T04 收口审计 KF-003 / KF-006）。
 *
 * 与旧实现的区别：
 * - **预检先行**：先读现有库，构建 id 映射，再逐条写入——不是边写边撞；
 * - **逐条专用写入**：走 `restoreNoteFromBackup`（保留修订/时间/删除态），
 *   不再借道普通编辑接口；
 * - **同名异 id 的知识库并入既有库**：成员关系经显式 id 映射迁移，
 *   不再出现「跳过建库但按新 id 挂成员」的静默丢失；
 * - **每一条失败都进报告**：返回结构化计数，不捕获错误后继续假成功。
 */
export interface NotesRestoreReport {
  notes: {
    created: number;
    updated: number;
    current: number;
    skippedLocalNewer: number;
    skippedDivergent: number;
    failed: { id: string; error: string }[];
  };
  knowledgeBases: {
    created: number;
    /** 并入既有库（同 id 或同名异 id）的条数。 */
    mapped: number;
    failed: { id: string; error: string }[];
  };
  membership: {
    added: number;
    existing: number;
    failed: { key: string; error: string }[];
  };
}

export function emptyNotesRestoreReport(): NotesRestoreReport {
  return {
    notes: { created: 0, updated: 0, current: 0, skippedLocalNewer: 0, skippedDivergent: 0, failed: [] },
    knowledgeBases: { created: 0, mapped: 0, failed: [] },
    membership: { added: 0, existing: 0, failed: [] },
  };
}

export async function restoreNotesBundle(
  notes: Note[],
  knowledgeBases: KnowledgeBase[],
  membership: Record<string, number>,
  dir: string
): Promise<NotesRestoreReport> {
  const report = emptyNotesRestoreReport();
  const existing = await readNotes(dir);

  // ---------- 预检：知识库 id 映射 ----------
  // 包内 kbId → 落库后实际 kbId。同 id 已存在 → 用既有库（本地名字保留）；
  // 同名异 id → 并入既有库；都没有 → 按包内 id 新建。
  const kbIdMap = new Map<string, string>();
  for (const kb of knowledgeBases) {
    try {
      const byId = existing.knowledgeBases.find((k) => k.id === kb.id);
      if (byId) {
        kbIdMap.set(kb.id, byId.id);
        report.knowledgeBases.mapped++;
        continue;
      }
      const byName = existing.knowledgeBases.find((k) => k.name === kb.name);
      if (byName) {
        kbIdMap.set(kb.id, byName.id);
        report.knowledgeBases.mapped++;
        continue;
      }
      await createKnowledgeBaseNamed(kb.id, kb.name, kb.description, dir);
      kbIdMap.set(kb.id, kb.id);
      report.knowledgeBases.created++;
    } catch (err) {
      report.knowledgeBases.failed.push({ id: kb.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ---------- 笔记：专用恢复写入，逐条处置 ----------
  for (const note of notes) {
    try {
      const action = await restoreNoteFromBackup(note, dir);
      switch (action) {
        case "created":
          report.notes.created++;
          break;
        case "updated":
          report.notes.updated++;
          break;
        case "current":
          report.notes.current++;
          break;
        case "skippedLocalNewer":
          report.notes.skippedLocalNewer++;
          break;
        case "skippedDivergent":
          report.notes.skippedDivergent++;
          break;
      }
    } catch (err) {
      report.notes.failed.push({ id: note.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ---------- 成员关系：经 id 映射迁移，addedAt 保留包内值，逐条处置 ----------
  const entries = Object.keys(membership).flatMap((key) => {
    const separator = key.indexOf("\n");
    if (separator <= 0) {
      report.membership.failed.push({ key, error: "键格式不合法" });
      return [];
    }
    const pkgKbId = key.slice(0, separator);
    const noteId = key.slice(separator + 1);
    const kbId = kbIdMap.get(pkgKbId);
    if (!kbId) {
      // 库建库失败或包里根本没有这个库——如实记失败，不静默丢
      report.membership.failed.push({ key, error: "知识库未能落库，成员关系无法挂载" });
      return [];
    }
    return [{ kbId, noteId, addedAt: membership[key] }];
  });
  const outcomes = await restoreMembershipFromBackup(entries, dir);
  for (const o of outcomes) {
    if (o.action === "added") report.membership.added++;
    else if (o.action === "existing") report.membership.existing++;
    else report.membership.failed.push({ key: `${o.kbId}\n${o.noteId}`, error: o.error ?? "未知失败" });
  }

  return report;
}
