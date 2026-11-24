import { describe, expect, it } from "vitest";
import { DELETE_CONFIRM_TIMEOUT_MS, deleteConfirmLabels, resolveDeleteClick } from "./deleteConfirm";

/**
 * 不可撤销的删除要二次确认。
 *
 * 背景：删除卡片有二次确认，删除产物有 `window.confirm`，但**删除订阅没有**——
 * 一个「×」图标按钮，点一下订阅就永久消失（硬删除，没有回收站），
 * 而它就挨着「立即抓取」与开关，很容易误点。
 */
describe("删除二次确认", () => {
  it("第一次点击只进入确认态，不执行删除", () => {
    const outcome = resolveDeleteClick(null, "sub-1");
    expect(outcome.confirmed).toBe(false);
    expect(outcome.armedTarget).toBe("sub-1");
  });

  it("第二次点击同一个目标才真的删除", () => {
    const outcome = resolveDeleteClick("sub-1", "sub-1");
    expect(outcome.confirmed).toBe(true);
    expect(outcome.armedTarget).toBeNull();
  });

  it("改点另一个目标只是挪动确认态，不会误删", () => {
    // 这条最容易写错：若确认态不带目标，点了 A 再点 B 会**立刻删掉 B**。
    const outcome = resolveDeleteClick("sub-1", "sub-2");
    expect(outcome.confirmed).toBe(false);
    expect(outcome.armedTarget).toBe("sub-2");
  });

  it("确认态的文案要说清不可撤销", () => {
    const idle = deleteConfirmLabels("我的订阅", false);
    expect(idle.ariaLabel).toBe("删除我的订阅");
    expect(idle.badge).toBeNull();

    const armed = deleteConfirmLabels("我的订阅", true);
    expect(armed.ariaLabel).toBe("确认删除我的订阅");
    // 用户点下去之前就该知道这一下没有回头路。
    expect(armed.title).toContain("无法撤销");
    expect(armed.badge).toBe("确认");
  });

  it("确认有超时上限（否则用户会停在确认态忘了自己在干嘛）", () => {
    expect(DELETE_CONFIRM_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DELETE_CONFIRM_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });
});
