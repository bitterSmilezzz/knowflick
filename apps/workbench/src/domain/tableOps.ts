import { withAlign, type ColumnAlign } from "./tableAlign";

/**
 * 表格的行列增删（B01 收尾）。
 *
 * 表格此前只能**插入**：建好之后想加一行、删一列，只能自己数着 `|` 手打。
 * 这里把「光标在哪张表、哪一行、哪一列」算清楚，再按规则增删。
 *
 * 三条硬规则：
 * - **分隔行不能删**：`| --- |` 没了，整块就不再是表格，用户会看到一堆竖线；
 * - **不能删到零列**：Markdown 表格至少要一列；
 * - **列数以表头为准**：手打的表格经常某行少一列，增删时按表头补齐/截断，
 *   否则每做一次操作就多一行错位的格子。
 */

export interface TextSelection {
  text: string;
  start: number;
  end: number;
}

export interface TableBlock {
  /** 表头行号（0 基）。 */
  startLine: number;
  /** 最后一行行号（含）。 */
  endLine: number;
  /** 表头列数。 */
  columns: number;
  /** 光标所在的行号（相对整个正文）。 */
  cursorLine: number;
  /** 光标所在的列号（0 基，已按表头列数夹紧）。 */
  cursorColumn: number;
}

/** 一行是不是表格行：以 `|` 开头、以 `|` 结尾（允许两边空白）。 */
function isTableLine(line: string): boolean {
  const t = line.trim();
  return t.length >= 2 && t.startsWith("|") && t.endsWith("|");
}

/** 分隔行：`| --- | :--: |` 这种只有横线、冒号和空白的行。 */
function isDividerLine(line: string): boolean {
  if (!isTableLine(line)) return false;
  return /^\|[\s:|-]+\|$/.test(line.trim()) && line.includes("-");
}

/** 把一行拆成单元格文字（去掉首尾竖线，保留内容原样）。 */
function cellsOf(line: string): string[] {
  const t = line.trim();
  return t.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

/** 用单元格拼回一行。 */
function lineOf(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}

/**
 * 找出光标所在的表格块；不在表格里返回 null。
 *
 * 判定要求「表头下一行是分隔行」——只有这样才能确定这是一张真表格，
 * 而不是正文里恰好用竖线排版的几行字。
 */
export function findTableAt(text: string, cursor: number): TableBlock | null {
  const lines = text.split(/\r?\n/);
  // 光标位置 → 行号：数它前面有几个换行。
  const before = text.slice(0, Math.max(0, Math.min(cursor, text.length)));
  const cursorLine = (before.match(/\n/g) ?? []).length;
  if (!isTableLine(lines[cursorLine] ?? "")) return null;
  // 往上找到表格的第一行。
  let start = cursorLine;
  while (start > 0 && isTableLine(lines[start - 1])) start -= 1;
  // 往下找到表格的最后一行。
  let end = cursorLine;
  while (end + 1 < lines.length && isTableLine(lines[end + 1])) end += 1;
  // 第一行必须是表头、第二行必须是分隔行；否则不是表格。
  if (start + 1 > end || !isDividerLine(lines[start + 1])) return null;
  const columns = cellsOf(lines[start]).length;
  if (columns === 0) return null;
  const cursorCells = cellsOf(lines[cursorLine]);
  // 光标所在列：按光标在该行里的字符位置数竖线；数不出来就落到最后一列。
  const lineStart = before.lastIndexOf("\n") + 1;
  const offsetInLine = cursor - lineStart;
  let column = 0;
  for (let i = 0; i < Math.min(offsetInLine, lines[cursorLine].length); i += 1) {
    if (lines[cursorLine][i] === "|") column += 1;
  }
  // 首尾竖线不算列，所以减 1；再按表头列数夹紧（少列的行也不会越界）。
  column = Math.max(0, column - 1);
  if (column > columns - 1) column = columns - 1;
  if (cursorCells.length === 0) column = 0;
  return { startLine: start, endLine: end, columns, cursorLine, cursorColumn: column };
}

/** 把表格里的每一行补齐/截断到 `columns` 列（分隔行除外）。 */
function normalize(lines: string[], start: number, end: number, columns: number): void {
  for (let i = start; i <= end; i += 1) {
    if (isDividerLine(lines[i])) {
      const cells = cellsOf(lines[i]);
      const next = Array.from({ length: columns }, (_, idx) => cells[idx] ?? "---");
      lines[i] = lineOf(next);
      continue;
    }
    const cells = cellsOf(lines[i]);
    const next = Array.from({ length: columns }, (_, idx) => cells[idx] ?? "");
    lines[i] = lineOf(next);
  }
}

/** 光标放回表格附近：`line` 行、`column` 列（列按竖线数推算）。 */
function caretAt(text: string, line: number, column: number): TextSelection {
  const lines = text.split(/\r?\n/);
  let offset = 0;
  for (let i = 0; i < line && i < lines.length; i += 1) offset += lines[i].length + 1;
  const target = lines[line] ?? "";
  // 找到第 column 个单元格的起点：跳过开头的竖线，再跳过 column 个 `|`。
  let seen = 0;
  let pos = 0;
  for (let i = 0; i < target.length; i += 1) {
    if (target[i] === "|") {
      if (seen === column) { pos = i + 1; break; }
      seen += 1;
    }
  }
  const at = offset + Math.min(pos, target.length);
  return { text, start: at, end: at };
}

/** 在光标所在行的上面或下面插一行空单元格。 */
export function insertTableRow(
  state: TextSelection,
  where: "above" | "below",
): TextSelection {
  const table = findTableAt(state.text, state.start);
  if (!table) return state;
  const lines = state.text.split(/\r?\n/);
  // 分隔行上方插行会让表头与分隔行分开，表格就不再成立——一律插到分隔行下面。
  // 所以锚点最早是**第一条数据行**（startLine + 2），光标在表头或分隔行时也照此。
  const anchor = Math.max(table.cursorLine, table.startLine + 2);
  const at = where === "above" ? anchor : anchor + 1;
  lines.splice(at, 0, lineOf(Array.from({ length: table.columns }, () => "")));
  const text = lines.join("\n");
  return caretAt(text, at, 0);
}

/**
 * 删除光标所在的数据行。
 *
 * 表头与分隔行**不删**：删掉任意一行，剩下的就不再是表格。
 * 只剩表头时也不删——一张空表仍然有意义（用户可能正要往里填）。
 */
export function deleteTableRow(state: TextSelection): TextSelection {
  const table = findTableAt(state.text, state.start);
  if (!table) return state;
  // 表头（startLine）与分隔行（startLine+1）都不可删。
  if (table.cursorLine <= table.startLine + 1) return state;
  const lines = state.text.split(/\r?\n/);
  lines.splice(table.cursorLine, 1);
  const text = lines.join("\n");
  const nextLine = Math.min(table.cursorLine, lines.length - 1);
  return caretAt(text, nextLine, 0);
}

/** 在光标所在列的左边或右边插一列空单元格。 */
export function insertTableColumn(
  state: TextSelection,
  where: "left" | "right",
): TextSelection {
  const table = findTableAt(state.text, state.start);
  if (!table) return state;
  const lines = state.text.split(/\r?\n/);
  const insertAt = where === "left" ? table.cursorColumn : table.cursorColumn + 1;
  for (let i = table.startLine; i <= table.endLine; i += 1) {
    const cells = cellsOf(lines[i]);
    const filler = isDividerLine(lines[i]) ? "---" : " ";
    cells.splice(Math.min(insertAt, cells.length), 0, filler);
    lines[i] = lineOf(cells);
  }
  normalize(lines, table.startLine, table.endLine, table.columns + 1);
  const text = lines.join("\n");
  return caretAt(text, table.cursorLine, insertAt);
}

/** 删除光标所在列；只剩一列时不删（Markdown 表格至少要一列）。 */
export function deleteTableColumn(state: TextSelection): TextSelection {
  const table = findTableAt(state.text, state.start);
  if (!table) return state;
  if (table.columns <= 1) return state;
  const lines = state.text.split(/\r?\n/);
  const removeAt = table.cursorColumn;
  for (let i = table.startLine; i <= table.endLine; i += 1) {
    const cells = cellsOf(lines[i]);
    if (removeAt < cells.length) cells.splice(removeAt, 1);
    lines[i] = lineOf(cells);
  }
  normalize(lines, table.startLine, table.endLine, table.columns - 1);
  const text = lines.join("\n");
  const nextColumn = Math.min(removeAt, table.columns - 2);
  return caretAt(text, table.cursorLine, Math.max(0, nextColumn));
}

/**
 * 改某个单元格的文字（B01）。
 *
 * 为什么需要它：现在能整行整列增删，却不能改一个格子里的字——用户只能删掉整行重打。
 *
 * 三条口径：
 * - **表头可以改**（列名写错了要能修），但**分隔行不能改**：那一行的横线是表格的骨架；
 * - 改的只是那一个格子，同行其它格子一个字符都不动；
 * - 内容里的 `|` 必须转义成 `\|`：不转义的话它会变成新的列分隔符，整行立刻错位。
 */
export function setTableCell(
  state: TextSelection,
  value: string,
): TextSelection {
  const table = findTableAt(state.text, state.start);
  if (!table) return state;
  if (isDividerLine(state.text.split(/\r?\n/)[table.cursorLine] ?? "")) return state;
  const lines = state.text.split(/\r?\n/);
  const cells = cellsOf(lines[table.cursorLine]);
  // 竖线进单元格会变成新的列分隔符——转义掉，否则整行错位。
  const safe = value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
  while (cells.length < table.columns) cells.push("");
  cells[table.cursorColumn] = safe;
  lines[table.cursorLine] = lineOf(cells.slice(0, table.columns));
  const text = lines.join("\n");
  return caretAt(text, table.cursorLine, table.cursorColumn);
}

/**
 * 读出光标所在单元格的当前文字（给输入框预填）。
 *
 * 不在表格里、或在分隔行上，都返回 null——调用方据此如实说「这里不能编辑」。
 */
export function tableCellAt(state: TextSelection): { value: string; header: boolean } | null {
  const table = findTableAt(state.text, state.start);
  if (!table) return null;
  const line = state.text.split(/\r?\n/)[table.cursorLine] ?? "";
  if (isDividerLine(line)) return null;
  const cells = cellsOf(line);
  const value = (cells[table.cursorColumn] ?? "").replace(/\\\|/g, "|");
  return { value, header: table.cursorLine === table.startLine };
}

/**
 * 把光标所在列改成某个对齐方式（B01）。
 *
 * 只改分隔行里那一格（`:---` / `:---:` / `---:` / `---`），数据行一个字都不动。
 * 对齐是**声明**，不是数据——数据行没有理由跟着变。
 */
export function setTableColumnAlign(
  state: TextSelection,
  align: ColumnAlign,
): TextSelection {
  const table = findTableAt(state.text, state.start);
  if (!table) return state;
  const lines = state.text.split(/\r?\n/);
  const dividerLine = table.startLine + 1;
  const cells = cellsOf(lines[dividerLine]);
  while (cells.length < table.columns) cells.push("---");
  cells[table.cursorColumn] = withAlign(cells[table.cursorColumn] ?? "---", align);
  lines[dividerLine] = lineOf(cells.slice(0, table.columns));
  const text = lines.join("\n");
  return caretAt(text, table.cursorLine, table.cursorColumn);
}
