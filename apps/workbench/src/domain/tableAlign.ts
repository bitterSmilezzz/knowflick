/**
 * 表格列对齐（B01 收尾）。
 *
 * Markdown 用分隔行里的冒号表达对齐：`:---` 左、`:---:` 居中、`---:` 右。
 * 渲染器此前**完全忽略**这些冒号——用户写了 `:---:` 也没有任何效果，
 * 而「我明明写了居中」这种落差比不支持更让人困惑。
 *
 * 这里把分隔行解析成每列的对齐方式，渲染时落到 `<th>/<td>` 的 `align` 上。
 */

export type ColumnAlign = "left" | "center" | "right" | null;

/** 一格分隔符（`---` / `:---` / `:---:` / `---:`）→ 对齐方式。没有冒号就是默认（null）。 */
export function dividerAlign(cell: string): ColumnAlign {
  const t = cell.trim();
  if (!t.includes("-")) return null;
  const left = t.startsWith(":");
  const right = t.endsWith(":");
  if (left && right) return "center";
  if (left) return "left";
  if (right) return "right";
  return null;
}

/**
 * 从分隔行解析出每列的对齐方式。
 *
 * 长度按分隔行自己的列数返回——调用方再按表头列数补齐/截断（表头多出来的列没有对齐声明）。
 */
export function parseColumnAligns(divider: string): ColumnAlign[] {
  const cells = divider.trim().replace(/^\|/, "").replace(/\|\s*$/, "").split("|");
  return cells.map(dividerAlign);
}

/**
 * 把分隔行里的一列改写成指定对齐方式。
 *
 * 生成的分隔符固定写成 `:---:` 这类**最短且合法**的形式，而不是保留原来的横线数量：
 * 横线数量对渲染毫无意义，保留它只会让「切了对齐」之后的分隔行越改越乱。
 */
export function withAlign(_cell: string, align: ColumnAlign): string {
  if (align === "center") return ":---:";
  if (align === "left") return ":---";
  if (align === "right") return "---:";
  // 默认：不带冒号，固定三段。
  // 不保留原来的横线数量——那对渲染毫无意义，留着只会让分隔行越改越长。
  return "---";
}
