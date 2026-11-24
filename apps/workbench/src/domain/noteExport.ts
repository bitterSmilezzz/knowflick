/**
 * 批量导出为一份 Markdown 合集（B02）。
 *
 * 单篇导出早就有；真正需要的是「把这次评审的几篇合到一个文件里」——
 * 交给同事、贴进周报、放进别的工具。
 *
 * 口径：
 * - 每篇一个二级标题；标题空着就写「无标题笔记」，**不留空标题行**（那样的文件没法读）。
 * - 篇与篇之间用一条水平线隔开：别人看到的分界与用户看到的一致。
 * - 正文原样保留（不重排、不转义），空正文就只留标题——不编造内容。
 * - 顺序由调用方决定（列表当前排序），本函数不重排：用户看到的顺序就是导出的顺序。
 */

export interface ExportableNote {
  title: string;
  bodyMd: string;
}

const FALLBACK_TITLE = "无标题笔记";

export function combineNotesForExport(notes: readonly ExportableNote[], title = "笔记合集"): string {
  if (notes.length === 0) return `# ${title}\n`;
  const parts = notes.map((note) => {
    const heading = `## ${note.title.trim() || FALLBACK_TITLE}`;
    const body = note.bodyMd.replace(/^\s*\n+/, "").trimEnd();
    return body ? `${heading}\n\n${body}` : heading;
  });
  return [`# ${title}`, "", parts.join("\n\n---\n\n"), ""].join("\n");
}

/** 合集文件名：带上日期，避免一天导两次互相覆盖。 */
export function exportBundleFileName(title: string, now = Date.now()): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  const safe = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim() || "笔记合集";
  return `${safe}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.md`;
}
