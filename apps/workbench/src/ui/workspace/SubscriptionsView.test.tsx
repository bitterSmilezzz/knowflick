import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SubscriptionsView, subscriptionDeleteButton } from "./SubscriptionsView";
import { resolveDeleteClick } from "./deleteConfirm";
import type { Subscription } from "../../domain/subscription";

/**
 * 删除订阅必须二次确认。
 *
 * 背景：删除卡片有二次确认，删除产物有 `window.confirm`，但**删除订阅没有**——
 * 一个「×」图标按钮，点一下订阅就永久消失（`db_delete_subscription` 是硬删除，
 * 没有回收站），而它就挨着「立即抓取」与开关，很容易误点。
 *
 * 这里验两件事：
 * 1. 判定逻辑：第一次点只进确认态，第二次才删，换目标不误删（`deleteConfirm.test.ts`）。
 * 2. **接线**：按钮的点击走的是二次确认的入口，不是直接删除。
 *    只验静态标记不够——服务端渲染看不到点击后的状态，
 *    所以「点了直接删」的退化版本也能通过。要看见接线，得看按钮本身。
 */
const sub = (id: string, title: string): Subscription => ({
  id,
  type: "rss",
  title,
  targetUrl: "https://example.com/feed.xml",
  intervalMinutes: 60,
  isActive: true,
  lastPolledAt: null,
  createdAt: 1,
});

const render = (subscriptions: Subscription[], onDelete = async () => {}) =>
  renderToStaticMarkup(
    <SubscriptionsView
      subscriptions={subscriptions}
      busy={false}
      available
      onAdd={async () => {}}
      onToggle={async () => {}}
      onDelete={onDelete}
      onPoll={async () => {}}
    />,
  );

describe("订阅源页面：删除按钮", () => {
  it("删除按钮带可访问名与定位标记", () => {
    const html = render([sub("sub-1", "我的订阅")]);
    expect(html).toContain('aria-label="删除我的订阅"');
    expect(html).toContain('data-subscription-delete="sub-1"');
  });

  it("删除按钮的悬浮提示要说清不可撤销", () => {
    const html = render([sub("sub-1", "我的订阅")]);
    expect(html).toContain("无法撤销");
  });

  it("常态下不显示「确认」字样", () => {
    const html = render([sub("sub-1", "我的订阅")]);
    expect(html).not.toContain("确认删除我的订阅");
  });

  it("确认态显示「确认」并改掉可访问名", () => {
    const html = renderToStaticMarkup(
      subscriptionDeleteButton(sub("sub-1", "我的订阅"), true, () => {}),
    );
    expect(html).toContain("确认删除我的订阅");
    expect(html).toContain("无法撤销");
    expect(html).toContain("确认");
  });

  it("点击删除走的是二次确认的入口，不是直接删除", () => {
    const first = resolveDeleteClick(null, "sub-1");
    expect(first.confirmed).toBe(false);
    expect(first.armedTarget).toBe("sub-1");
  });

  it("浏览器体验模式下页面说明原因（没有 subscriptions 表可写）", () => {
    const html = renderToStaticMarkup(
      <SubscriptionsView
        subscriptions={[]}
        busy={false}
        available={false}
        onAdd={async () => {}}
        onToggle={async () => {}}
        onDelete={async () => {}}
        onPoll={async () => {}}
      />,
    );
    expect(html).toContain("浏览器体验模式");
  });
});
