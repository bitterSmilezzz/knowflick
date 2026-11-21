/**
 * 导入 Markdown 为笔记（A03/B05）。
 *
 * 用户手里常有一堆 `.md`（别的工具导出的、剪藏存的），不该只能复制粘贴进来。
 * 这里只做**一件事**：把一段文本加上文件名，变成「标题 + 正文」。
 *
 * 口径：
 * - 标题优先取文首的 `# 标题`（前三行内）；取到了就把那一行从正文里去掉（标题栏已经显示）
 *   ——但正文其余部分**原样保留**，包括它自己的小标题结构。
 * - 没有一级标题就用文件名（去掉扩展名）。
 * - **不解析、不丢弃** YAML front-matter：那是别人的元数据，默默删掉等于改用户内容。
 */

const MAX_TITLE = 80;

/** 从文件名推标题：去掉目录与扩展名，`-`/`_` 换成空格。 */
export function titleFromFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? fileName;
  const stem = base.replace(/\.[^.]+$/, "");
  return stem.replace(/[-_]+/g, " ").trim();
}

export function noteFromMarkdown(raw: string, fileName: string): { title: string; body: string } {
  const text = raw.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  // 只看前几行：标题必须出现在文首附近，正文中间的一级标题是章节标题。
  const headLimit = Math.min(lines.length, 5);
  for (let i = 0; i < headLimit; i++) {
    const m = /^#\s+(.+?)\s*$/.exec(lines[i]);
    if (!m) continue;
    const title = m[1].trim().slice(0, MAX_TITLE);
    const body = [...lines.slice(0, i), ...lines.slice(i + 1)].join("\n").replace(/^\n+/, "");
    return { title: title || titleFromFileName(fileName), body };
  }
  const title = titleFromFileName(fileName).slice(0, MAX_TITLE);
  return { title, body: text.replace(/^\n+/, "") };
}
