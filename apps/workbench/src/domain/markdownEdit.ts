/**
 * 正文的「可发现编辑动作」（B01）：标题、列表、待办、引用、行内代码、加粗。
 *
 * 全部做成纯函数：输入 `{ text, start, end }`，输出新的文本与选区。
 * 这样「多行加前缀」「再点一次去掉前缀」「没选中文字时插入什么」都能被断言，
 * 而不是只能靠手点去感觉。
 */

export interface TextSelection {
  text: string;
  /** 选区起点（含）。 */
  start: number;
  /** 选区终点（不含）。 */
  end: number;
}

/** 选区覆盖到的整行范围（按 \n 切）。 */
function lineRange(text: string, start: number, end: number): { from: number; to: number } {
  const from = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextBreak = text.indexOf("\n", end);
  const to = nextBreak === -1 ? text.length : nextBreak;
  return { from, to };
}

/**
 * 给选中的每一行加/去前缀（标题、无序列表、待办、引用都用它）。
 *
 * 全都有前缀 → 去掉（再点一次就是取消）；否则一律加上——混合状态下按「加」处理，
 * 因为用户点这个按钮的意图通常是「把这些都变成列表」。
 */
export function toggleLinePrefix(state: TextSelection, prefix: string): TextSelection {
  const { from, to } = lineRange(state.text, state.start, state.end);
  const block = state.text.slice(from, to);
  const lines = block.split("\n");
  const hasAll = lines.every((line) => line.trim().length === 0 || line.startsWith(prefix));
  const next = lines
    .map((line) => {
      if (line.trim().length === 0) return line;
      if (hasAll) return line.startsWith(prefix) ? line.slice(prefix.length) : line;
      return line.startsWith(prefix) ? line : `${prefix}${line}`;
    })
    .join("\n");
  return {
    text: state.text.slice(0, from) + next + state.text.slice(to),
    // 选区跟着行首移动：加了前缀就往后挪，去掉就往前挪，用户不用重新选。
    start: Math.max(from, state.start + (next.length - block.length ? (hasAll ? -prefix.length : prefix.length) : 0)),
    end: Math.max(from, state.end + (next.length - block.length ? (hasAll ? -prefix.length : prefix.length) : 0)),
  };
}

/**
 * 用一对标记包住选区（行内代码、加粗、链接）。
 *
 * 已经被同一对标记包住 → 去掉（再点一次取消）；没选中文字时插入一对标记并把光标放中间，
 * 这样用户能直接开始敲。
 */
export function wrapSelection(state: TextSelection, before: string, after = before): TextSelection {
  const selected = state.text.slice(state.start, state.end);
  const outsideStart = state.start - before.length;
  const outsideEnd = state.end + after.length;
  const alreadyWrapped =
    outsideStart >= 0 &&
    state.text.slice(outsideStart, state.start) === before &&
    state.text.slice(state.end, outsideEnd) === after;
  if (alreadyWrapped) {
    return {
      text: state.text.slice(0, outsideStart) + selected + state.text.slice(outsideEnd),
      start: outsideStart,
      end: outsideStart + selected.length,
    };
  }
  return {
    text: state.text.slice(0, state.start) + before + selected + after + state.text.slice(state.end),
    start: state.start + before.length,
    end: state.start + before.length + selected.length,
  };
}

/** 编辑工具栏的按钮定义：界面与测试共用一份，避免两处各写一遍。 */
export const MARKDOWN_ACTIONS = [
  { id: "heading", label: "标题", kind: "line", value: "## " },
  { id: "list", label: "列表", kind: "line", value: "- " },
  { id: "todo", label: "待办", kind: "line", value: "- [ ] " },
  { id: "quote", label: "引用", kind: "line", value: "> " },
  { id: "code", label: "代码", kind: "wrap", value: "`" },
  { id: "bold", label: "加粗", kind: "wrap", value: "**" },
] as const;

export type MarkdownAction = (typeof MARKDOWN_ACTIONS)[number];

export function applyMarkdownAction(state: TextSelection, action: MarkdownAction): TextSelection {
  return action.kind === "line" ? toggleLinePrefix(state, action.value) : wrapSelection(state, action.value);
}
