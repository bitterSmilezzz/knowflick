import { useState } from "react";

/**
 * 暂时不可用、但**必须能被知道**的入口。
 *
 * 为什么不用 `disabled`：
 * 禁用按钮**不接收焦点**、**不派发鼠标事件**。于是：
 * - 键盘用户 Tab 不到它 → 根本不知道它存在；
 * - 鼠标用户点它 → 没有任何反应，也没机会看到 `title` 提示；
 * - `title` 只有**悬停**才显示，键盘根本触发不了悬停。
 *
 * 结果是：界面上出现一个灰掉的入口，**没人知道为什么**。
 * 这正是「导入音频转写」在没有 ASR 插件时的处境——它比「手写 / 语音 / 笔记」
 * 少一个同级入口，用户却找不到任何解释。
 *
 * 所以改成 `aria-disabled`：按钮**照常可聚焦**，但点下去不执行原动作，
 * 而是**说出原因和下一步**（去哪儿开启）。
 */
export function useDisabledExplainer(initial = "") {
  const [explanation, setExplanation] = useState(initial);
  return {
    explanation,
    setExplanation,
    clear: () => setExplanation(""),
  };
}

/**
 * 一个「暂不可用但可聚焦」的入口。
 *
 * `reason` 是不可用的原因，`hint` 是用户能采取的下一步（去哪儿开启）。
 */
export function DisabledEntry({
  label,
  reason,
  hint,
  onExplain,
  className,
  children,
}: {
  label: string;
  reason: string;
  hint?: string;
  onExplain: (message: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const message = hint ? `${reason}：${hint}` : reason;
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      aria-disabled="true"
      title={message}
      onClick={() => onExplain(message)}
    >
      {children}
    </button>
  );
}
