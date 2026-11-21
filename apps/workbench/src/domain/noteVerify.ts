/**
 * 待验证清单（C05）：用户自己标出来的「这条结论还没核实」。
 *
 * 为什么不自动判断：判断一句话是「结论」还是「待验证」需要语义理解，不接模型只能靠猜。
 * 猜错的代价很实在——把用户写的事实标成「可疑」，或者漏掉真正没核实的断言。
 * 所以这里只认**用户显式写的标记**：行末一个 `❓`，与 `📅` 截止日期同一套思路。
 *
 * 契约：
 * - 标记写在行末（`❓` 后允许空白）；行内其它位置的 `❓` 不算，避免正文里正常用这个符号被误判。
 * - 标记是**正文的一部分**：跟着保存、备份、导出、修订历史一起走，不另存状态。
 * - 「已核实」= 把那一行的 `❓` 去掉，正文其余一个字符都不动。
 */

/** 行末的待验证标记。只认行末，正文中间的 `❓` 是普通文字。 */
const VERIFY_MARK = /\s*❓\s*$/;

/** 这一行是否标了待验证。 */
export function needsVerify(text: string): boolean {
  return VERIFY_MARK.test(text);
}

/** 去掉行末的待验证标记（其余原样）。 */
export function textWithoutVerify(text: string): string {
  return text.replace(VERIFY_MARK, "").trimEnd();
}

export interface VerifyItem {
  /** 行号（0 基），用于「已核实」时定点改那一行。 */
  line: number;
  /** 去掉标记后的正文（清单里显示的就是这句断言）。 */
  text: string;
}

/**
 * 正文里所有待验证的行。
 *
 * 空行与只有标记没有内容的行不算：那不是一个「待核实的断言」，是占位符。
 */
export function verifyItems(bodyMd: string): VerifyItem[] {
  const out: VerifyItem[] = [];
  const lines = bodyMd.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!needsVerify(lines[i])) continue;
    const text = textWithoutVerify(lines[i]);
    if (!text.trim()) continue;
    out.push({ line: i, text });
  }
  return out;
}

/** 待验证条数（给正文下方的提示用）。 */
export function verifySummary(bodyMd: string): number {
  return verifyItems(bodyMd).length;
}

/**
 * 把某一行标为「已核实」：只去掉那一行的 `❓`。
 *
 * 行号对不上、或那一行本来就没标记，返回 `changed: false`——调用方据此决定
 * 是否还要写盘（没变就不该多一条修订）。
 */
export function markLineVerified(
  bodyMd: string,
  line: number,
): { body: string; changed: boolean } {
  const lines = bodyMd.split(/\r?\n/);
  const target = lines[line];
  if (target === undefined || !needsVerify(target)) return { body: bodyMd, changed: false };
  lines[line] = textWithoutVerify(target);
  return { body: lines.join("\n"), changed: true };
}
