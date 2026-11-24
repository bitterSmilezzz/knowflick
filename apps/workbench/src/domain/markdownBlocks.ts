/**
 * 表格与链接的编辑动作（B01 收尾）。
 *
 * 前一轮的六个动作只覆盖了「行内标记」与「包裹标记」。表格与链接不是行内标记，
 * 它们需要**知道上下文**：表格要知道有几列，链接要知道 URL 与文字。
 *
 * 这里的两个函数把「上下文」显式传进来，而不是在界面里现场拼字符串——
 * 这样「表格每行列数是否一致」「链接文字从哪来」都能被断言。
 */

export interface TextSelection {
  text: string;
  start: number;
  end: number;
}

/**
 * 插入一个 Markdown 表格：表头 + 分隔行 + 指定行数的空行。
 *
 * 列数由表头的 `|` 分隔数决定；每行给同样多的列——
 * **列数不齐的表格在 Markdown 渲染器里会错位**，宁可在插入时就保证一致。
 */
export function insertTable(state: TextSelection, columns: readonly string[], rows = 2): TextSelection {
  const cols = columns.map((c) => c.trim()).filter(Boolean);
  if (cols.length === 0) return state;
  const header = `| ${cols.join(" | ")} |`;
  const divider = `| ${cols.map(() => "---").join(" | ")} |`;
  const body = Array.from({ length: Math.max(1, rows) }, () => `| ${cols.map(() => " ").join(" | ")} |`);
  const block = [header, divider, ...body].join("\n");
  return insertBlock(state, block);
}

/**
 * 插入一个 Markdown 链接：`[文字](url)`。
 *
 * 文字从哪来：给了 `label` 用它；没给就用**选区里的文字**；再没有就用 URL——
 * 空文字的链接在渲染器里点开什么都看不到。
 * URL 里的 `)` 会被 Markdown 解析截断，所以要转义成 `%29`。
 */
export function insertLink(state: TextSelection, url: string, label?: string): TextSelection {
  const trimmed = url.trim();
  if (!trimmed) return state;
  const selected = state.text.slice(state.start, state.end).trim();
  const text = (label ?? "").trim() || selected || trimmed;
  const safeUrl = trimmed.replace(/\)/g, "%29");
  return insertBlock(state, `[${text}](${safeUrl})`);
}

/**
 * 在选区处插入一段块内容。
 *
 * 选区里有文字时**替换掉它**（链接用它当文字）；前后各留一个空行——
 * 块级内容粘在行中间，Markdown 解析会把那一行当成普通段落。
 */
function insertBlock(state: TextSelection, block: string): TextSelection {
  const before = state.text.slice(0, state.start).replace(/\s+$/, "");
  const after = state.text.slice(state.end).replace(/^\s+/, "");
  const head = before ? `${before}\n\n` : "";
  const tail = after ? `\n\n${after}` : "\n";
  const text = `${head}${block}${tail}`;
  const start = head.length;
  return { text, start, end: start + block.length };
}
