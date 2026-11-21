/**
 * 笔记正文的查找/替换与字数统计（B01 编辑增强）。
 *
 * 做成纯函数放这里，不塞进组件：查找位置、大小写策略、替换计数这些判定
 * 是「能被断言的东西」，而 DOM 里的选择行为不是。
 */

/** 字数按「非空白字符」算：中文没有词边界，按字符数才对得上用户直觉。 */
export function countNoteText(text: string): { chars: number; paragraphs: number } {
  const chars = text.replace(/\s/g, "").length;
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;
  return { chars, paragraphs };
}

/**
 * 找出所有匹配的起始位置。
 *
 * 英文大小写不敏感（用户搜 note 应该找到 Note），中文不受影响；
 * 空查询返回空数组——空串匹配所有位置毫无意义，还会让「下一个」跳个不停。
 */
export function findMatches(text: string, query: string): number[] {
  if (!query) return [];
  const hay = text.toLowerCase();
  const needle = query.toLowerCase();
  const hits: number[] = [];
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at === -1) break;
    hits.push(at);
    from = at + needle.length;
    if (from > text.length) break;
  }
  return hits;
}

/** 全部替换：返回新文本与实际替换次数（0 次就别改文本，避免白写一次保存）。 */
export function replaceAllMatches(
  text: string,
  query: string,
  replacement: string
): { text: string; count: number } {
  const hits = findMatches(text, query);
  if (hits.length === 0) return { text, count: 0 };
  let out = "";
  let cursor = 0;
  for (const at of hits) {
    out += text.slice(cursor, at) + replacement;
    cursor = at + query.length;
  }
  out += text.slice(cursor);
  return { text: out, count: hits.length };
}
