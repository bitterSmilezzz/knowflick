/**
 * 「不可撤销」的删除动作需要二次确认——判定是纯逻辑，单独放这里便于测试。
 *
 * 背景：删除卡片有二次确认（点一下变成「确认」，四秒后自动收回），
 * 删除产物有 `window.confirm`。但**删除订阅没有**——一个 `×` 图标按钮，
 * 点一下订阅就永久消失（`db_delete_subscription` 是硬删除，没有回收站）。
 *
 * 那个 `×` 按钮就在「立即抓取」和开关旁边，小、密、挨着其它控件。
 * 一次误点，用户的订阅源就没了，而且**没有任何提示说它不可撤销**。
 *
 * 这里把「二次确认」做成**共享实现**：卡片删除与订阅删除共用同一套行为，
 * 以后再有第三处不可撤销的删除，直接复用——不会再出现「只有这一处漏了确认」。
 */

/** 删除确认的展示期限：超时自动收回，避免用户停在「确认」态忘了自己在干嘛。 */
export const DELETE_CONFIRM_TIMEOUT_MS = 4000;

/**
 * 一次点击之后的判定结果。
 *
 * `confirmed` 为 true 表示**这次点击执行了删除**；为 false 表示只是进入了确认态。
 */
export interface DeleteOutcome {
  confirmed: boolean;
  /** 此刻处于确认态的目标（没有则 null）。 */
  armedTarget: string | null;
}

/**
 * 判定点一下删除按钮会发生什么。
 *
 * 关键：**确认态是带目标的**。
 * 若不带目标，「点了 A 的删除，再点 B 的删除」会立刻删掉 B——
 * 一次误点就毁了另一个订阅。带目标时，换目标只是把确认态挪过去，不删任何东西。
 *
 * @param armedTarget 此刻处于确认态的目标（没有则 null）。
 * @param target 本次点击针对的目标。
 */
export function resolveDeleteClick(armedTarget: string | null, target: string): DeleteOutcome {
  if (armedTarget === target) {
    return { confirmed: true, armedTarget: null };
  }
  return { confirmed: false, armedTarget: target };
}

/**
 * 删除按钮的展示文案。
 *
 * 确认态要说清**不可撤销**——用户点下去之前就该知道这一下没有回头路。
 */
export function deleteConfirmLabels(label: string, armed: boolean): {
  ariaLabel: string;
  title: string;
  badge: string | null;
} {
  if (!armed) {
    return { ariaLabel: `删除${label}`, title: "删除", badge: null };
  }
  return {
    ariaLabel: `确认删除${label}`,
    title: "再点一次即删除，无法撤销",
    badge: "确认",
  };
}
