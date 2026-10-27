import { useEffect, useRef } from "react";

/**
 * 模态面板的键盘可达性。
 *
 * 背景：手写/语音面板是手写的 div（不是原生 `<dialog>`），所以**没有**浏览器
 * 自带的焦点陷阱与 Escape 处理。实测：面板打开后连按 12 次 Tab，焦点始终在
 * 侧栏（面板里的「开始录音」「取消」「保存」全部键盘不可达），Escape 也不生效——
 * 而同一个界面里的「记录」模态用的是原生 `<dialog>`，Tab 能进、Escape 能关。
 *
 * 这个钩子把原生 `<dialog>` 的两项能力补到手写模态上：
 * 1. 打开时把焦点移进面板（否则键盘用户根本进不来）；
 * 2. Tab / Shift+Tab 在面板内循环（焦点不会跑到被遮住的底层界面）；
 * 3. Escape 关闭面板。
 *
 * 注意「循环」这一条：面板是 `aria-modal` 的，底层界面**被视觉遮住但仍可聚焦**，
 * 不做循环的话 Tab 会走到看不见的地方——比走不进去更糟。
 */
export function useModalFocus(
  active: boolean,
  onClose: () => void,
  containerRef: React.RefObject<HTMLElement | null>,
) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    // 记住打开前的焦点，关闭后还回去（键盘用户不会「丢失」位置）。
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    // 打开时把焦点移进面板：优先第一个可聚焦控件，否则面板本身。
    const first = focusable()[0];
    (first ?? container).focus?.();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (activeEl === firstItem || !container.contains(activeEl))) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && (activeEl === lastItem || !container.contains(activeEl))) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    // 绑在 document 上：焦点在面板内时事件会冒泡到 document，
    // 绑在容器上则要求焦点必须在容器内才收得到（那正是进不去的原因）。
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previousFocusRef.current?.focus?.();
    };
  }, [active, containerRef, onClose]);
}
