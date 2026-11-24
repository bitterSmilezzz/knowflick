/**
 * 正文里插入附件引用（B06）。
 *
 * 此前的做法有两个问题：
 * - **一律追加到正文末尾**：用户把光标放在某段后面想插图，图却跑到最下面；
 * - **说明文字固定写「附件」**：读者（和屏幕阅读器）看到的是一堆「附件」，
 *   分不出哪张是流程图、哪段是录音。
 *
 * 这里改成「插在选区处 + 用素材标题当说明」。仍然是纯函数，可断言。
 */

export interface TextRange {
  text: string;
  start: number;
  end: number;
}

/**
 * 从素材标题里取一个适合当说明文字的短名：去掉扩展名、压掉多余空白、截断。
 *
 * 为什么不用整个标题：附件说明会显示在正文里（图片挂 alt、录音挂 aria-label），
 * 一段长标题会把正文冲散。
 */
export function attachmentAlt(label: string): string {
  const base = label.trim()
    .replace(/\.[A-Za-z0-9]{1,8}$/, "")
    .replaceAll("[", "［")
    .replaceAll("]", "］")
    .replace(/\s+/g, " ")
    .trim();
  if (!base) return "附件";
  return base.length > 40 ? `${base.slice(0, 40)}…` : base;
}

/**
 * 在选区处插入一条附件引用，返回新正文与新选区。
 *
 * 三条边界：
 * - 选区非空时**替换**选中内容（用户选中了一段想换掉，那就是想换掉）；
 * - 插入点前后按需补空行，避免 `![图](…)` 粘在上一行末尾变成行内文字；
 * - 插入后把光标放到引用**之后**，用户可以接着往下写。
 */
export function insertAttachmentRef(
  range: TextRange,
  path: string,
  label: string,
): TextRange {
  const alt = attachmentAlt(label);
  const snippet = `![${alt}](${path})`;
  const before = range.text.slice(0, range.start);
  const after = range.text.slice(range.end);
  // 前面不是行首就补两个换行：Markdown 里图片独占一行才稳。
  const lead = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const tail = after.startsWith("\n\n") ? "" : after === "" || after.startsWith("\n") ? "\n" : "\n\n";
  const inserted = `${lead}${snippet}${tail}`;
  const cursor = before.length + inserted.length + (tail === "" ? 1 : 0);
  return {
    text: `${before}${inserted}${after}`,
    start: cursor,
    end: cursor,
  };
}
