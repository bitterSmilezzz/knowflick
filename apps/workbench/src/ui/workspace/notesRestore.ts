import { saveNote, createKnowledgeBaseNamed, addNoteToKnowledgeBase } from "./repository";
import { readNotes } from "./repository";
import type { KnowledgeBase, Note } from "../../domain/note";

/**
 * 备份恢复时把笔记与知识库写回当前库（契约 docs/NOTES_MODEL.md「导出与恢复」）。
 *
 * 语义与素材/卡片的恢复一致：**同 id 已存在 → 以备份内容覆盖**
 * （显式恢复是用户动作，不是并发编辑——不走修订冲突拦截，而是拿当前修订号
 * 作为 base_revision 直接覆盖）；不存在 → 新建（base_revision = 0）。
 * 知识库同名已存在时跳过创建但继续挂成员关系（按 id 对齐）。
 *
 * 单条失败不阻断整份恢复（与附件的容错一致）；返回成功写回的条数供回执计数。
 */
export async function restoreNotesBundle(
  notes: Note[],
  knowledgeBases: KnowledgeBase[],
  membership: Record<string, number>,
  dir: string
): Promise<number> {
  const existing = await readNotes(dir);
  let count = 0;

  for (const kb of knowledgeBases) {
    try {
      const clash = existing.knowledgeBases.find((k) => k.id === kb.id || k.name === kb.name);
      if (!clash) await createKnowledgeBaseNamed(kb.id, kb.name, kb.description, dir);
      count++;
    } catch {
      /* 单库失败不阻断 */
    }
  }

  for (const note of notes) {
    try {
      const current = existing.notes.find((n) => n.id === note.id);
      await saveNote(note, current ? current.currentRevision : 0, dir);
      count++;
    } catch {
      /* 单篇失败不阻断 */
    }
  }

  for (const key of Object.keys(membership)) {
    const separator = key.indexOf("\n");
    if (separator <= 0) continue;
    const kbId = key.slice(0, separator);
    const noteId = key.slice(separator + 1);
    try {
      await addNoteToKnowledgeBase(kbId, noteId, dir);
    } catch {
      /* 库或笔记可能在上面那步失败了——成员关系跟着跳过 */
    }
  }

  return count;
}
