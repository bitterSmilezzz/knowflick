import { extractNoteReferences, parseReferenceUri, referenceStatus, type ReferenceSource } from "./noteReference";

/**
 * 引用体检（C05 的底座）：把「库里所有笔记的引用」扫一遍，找出失效与过期的。
 *
 * 在此之前只有打开某一篇时才看得到它自己的引用问题——用户得挨篇点开才知道哪些引用坏了。
 * 这里做一次横向扫描，给「可处理的维护清单」打底。
 *
 * 口径：
 * - 回收站里的笔记不作为**引用者**扫描（它自己都搜不到了），但仍然可以是**被引用方**
 *   ——引用指向一篇已删笔记就是「失效」，这正是要提醒的事。
 * - 已归档笔记照常扫描：归档只是收起，引用坏了照样要知道。
 * - 素材可以是被引用方（多来源引用），条目与笔记一视同仁。
 */

export type ReferenceIssueStatus = "missing" | "changed";

export interface ReferenceIssue {
  /** 引用者（哪篇笔记里有这条引用）。 */
  noteId: string;
  noteTitle: string;
  /** 被引用方（笔记或素材）。 */
  targetId: string;
  targetTitle: string;
  status: ReferenceIssueStatus;
}

interface AuditNote {
  id: string;
  title: string;
  bodyMd: string;
  isDeleted?: boolean;
}

interface AuditMaterial {
  id: string;
  title: string;
  rawText: string;
}

/** 按引用者标题拼音序 + 被引用方标题排序：列表顺序稳定，用户第二次看还在同一处。 */
export function auditReferences(
  notes: readonly AuditNote[],
  materials: readonly AuditMaterial[] = [],
): ReferenceIssue[] {
  const sources = new Map<string, ReferenceSource>();
  for (const n of notes) {
    if (n.isDeleted) continue;
    sources.set(n.id, { id: n.id, title: n.title, bodyMd: n.bodyMd, kind: "note" });
  }
  for (const m of materials) {
    sources.set(m.id, { id: m.id, title: m.title, bodyMd: m.rawText, kind: "material" });
  }

  const issues: ReferenceIssue[] = [];
  for (const note of notes) {
    if (note.isDeleted) continue;
    for (const ref of extractNoteReferences(note.bodyMd)) {
      const status = referenceStatus(ref, sources);
      if (status === "ok") continue;
      issues.push({
        noteId: note.id,
        noteTitle: note.title || "无标题笔记",
        targetId: ref.noteId,
        targetTitle: ref.title || "无标题",
        status,
      });
    }
  }
  return issues.sort(
    (a, b) =>
      a.noteTitle.localeCompare(b.noteTitle, "zh-CN") ||
      a.targetTitle.localeCompare(b.targetTitle, "zh-CN")
  );
}
/**
 * 从正文里删掉指向某个目标的引用块（C05「就地处理」）。
 *
 * 引用块是两行（`> 《标题》：片段` + `> [回原件](uri)`）；删除时两行一起删，
 * 并顺手吸收由此留下的重复空行——否则每删一条就多一片空白。
 *
 * 只删指向 `targetId` 的块；同一篇里引用别的内容原样保留。
 */
export function removeReferenceFromBody(
  bodyMd: string,
  targetId: string,
): { body: string; removed: number } {
  const lines = bodyMd.split("\n");
  const drop = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const quote = /^>\s*《(.+?)》：(.*)$/.exec(lines[i].trim());
    if (!quote) continue;
    let uri: string | null = null;
    let linkLine = -1;
    for (let j = i + 1; j < lines.length && j <= i + 2; j++) {
      const link = /^>\s*\[回原件\]\((.*)\)\s*$/.exec(lines[j]);
      if (link) { uri = link[1]; linkLine = j; break; }
      if (!/^>\s*/.test(lines[j])) break;
    }
    if (!uri || linkLine === -1) continue;
    const parsed = parseReferenceUri(uri);
    if (!parsed || parsed.id !== targetId) continue;
    drop.add(i);
    drop.add(linkLine);
  }
  if (drop.size === 0) return { body: bodyMd, removed: 0 };
  const kept = lines.filter((_, index) => !drop.has(index));
  // 合并连续空行（删除后常见的产物），但保留正文开头的空行语义。
  const out: string[] = [];
  for (const line of kept) {
    if (line.trim() === "" && out.length > 0 && out[out.length - 1].trim() === "") continue;
    out.push(line);
  }
  return { body: out.join("\n"), removed: drop.size / 2 };
}
