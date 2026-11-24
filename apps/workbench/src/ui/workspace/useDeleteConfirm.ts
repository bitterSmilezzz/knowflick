import { useCallback, useEffect, useState } from "react";
import { DELETE_CONFIRM_TIMEOUT_MS, resolveDeleteClick } from "./deleteConfirm";

/**
 * 二次确认的 React 外壳。
 *
 * 判定本身在 `deleteConfirm.ts` 的纯函数里（可以在没有 DOM 的环境里测），
 * 这里只负责把状态挂到 React 上。
 */
export interface DeleteConfirm {
  /** 某个目标此刻是否处于「再点一次即删除」的状态。 */
  isArmed: (target: string) => boolean;
  /**
   * 点击删除按钮。
   *
   * 对**同一个**目标的第一次点击只进入确认态；第二次点击才真正执行删除。
   * 对**另一个**目标的点击只是把确认态挪到那个目标上——不会误删。
   * 返回 true 表示**这次点击执行了删除**。
   */
  request: (target: string) => boolean;
  /** 取消确认态。 */
  cancel: () => void;
}

/**
 * 二次确认的状态机。
 *
 * @param onDelete 真正执行删除的回调，参数是确认删除的目标。
 */
export function useDeleteConfirm(onDelete: (target: string) => void | Promise<void>): DeleteConfirm {
  const [armedTarget, setArmedTarget] = useState<string | null>(null);

  // 超时自动收回：否则用户停在「确认」态上，可能过一会儿才发现刚才那个按钮
  // 变成红色了，却不记得是自己点的。
  useEffect(() => {
    if (!armedTarget) return;
    const timer = window.setTimeout(() => setArmedTarget(null), DELETE_CONFIRM_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [armedTarget]);

  const request = useCallback(
    (target: string) => {
      const outcome = resolveDeleteClick(armedTarget, target);
      setArmedTarget(outcome.armedTarget);
      if (outcome.confirmed) void onDelete(target);
      return outcome.confirmed;
    },
    [armedTarget, onDelete],
  );

  const cancel = useCallback(() => setArmedTarget(null), []);

  return { isArmed: (target) => armedTarget === target, request, cancel };
}
