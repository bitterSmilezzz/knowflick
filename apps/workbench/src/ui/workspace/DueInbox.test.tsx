import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DueInbox } from "./DueInbox";

const overdue = { noteId: "a", noteTitle: "甲", line: 1, text: "交周报", due: "2026-11-18", state: "overdue" as const };
const today = { noteId: "b", noteTitle: "乙", line: 2, text: "回邮件", due: "2026-11-19", state: "today" as const };
const future = { noteId: "c", noteTitle: "丙", line: 3, text: "下个月", due: "2026-12-01", state: "upcoming" as const };

describe("DueInbox", () => {
  it("只有将来的到期项时不渲染（不是今天要处理的事，不占版面）", () => {
    expect(renderToStaticMarkup(<DueInbox items={[future]} onOpen={() => {}} />)).toBe("");
    expect(renderToStaticMarkup(<DueInbox items={[]} onOpen={() => {}} />)).toBe("");
  });

  it("分别报逾期与今天，并列出事项与所属笔记", () => {
    const html = renderToStaticMarkup(<DueInbox items={[overdue, today, future]} onOpen={() => {}} />);
    expect(html).toContain("逾期 1 件");
    expect(html).toContain("今天到期 1 件");
    expect(html).toContain("交周报");
    expect(html).toContain("《甲》");
    expect(html).not.toContain("下个月");
  });

  it("给了 onDone / onSnooze 才出现就地动作，点了把整条交出去", () => {
    const onDone = vi.fn();
    const onSnooze = vi.fn();
    const withActions = renderToStaticMarkup(
      <DueInbox items={[overdue]} onOpen={() => {}} onDone={onDone} onSnooze={onSnooze} />
    );
    expect(withActions).toContain("完成");
    expect(withActions).toContain("推迟三天");
    const withoutActions = renderToStaticMarkup(<DueInbox items={[overdue]} onOpen={() => {}} />);
    expect(withoutActions).not.toContain("推迟三天");
    const tree = DueInbox({ items: [overdue], onOpen: () => {}, onDone, onSnooze }) as React.ReactElement;
    const buttons = findAllClickable(tree);
    const doneBtn = buttons.find((b) => (b.props as { children?: React.ReactNode }).children === "完成");
    const snoozeBtn = buttons.find((b) => (b.props as { children?: React.ReactNode }).children === "推迟三天");
    expect(doneBtn).toBeDefined();
    expect(snoozeBtn).toBeDefined();
    doneBtn!.props.onClick();
    snoozeBtn!.props.onClick();
    expect(onDone).toHaveBeenCalledWith(overdue);
    expect(onSnooze).toHaveBeenCalledWith(overdue);
  });

  it("给了 onReschedule 才出现日期输入，改了把日期交出去", () => {
    const onReschedule = vi.fn();
    const withInput = renderToStaticMarkup(
      <DueInbox items={[overdue]} onOpen={() => {}} onReschedule={onReschedule} />
    );
    expect(withInput).toContain('type="date"');
    // 预填当前截止日期：用户不用先猜原来写的是哪天
    expect(withInput).toContain('value="2026-11-18"');
    const without = renderToStaticMarkup(<DueInbox items={[overdue]} onOpen={() => {}} />);
    expect(without).not.toContain('type="date"');
    const tree = DueInbox({ items: [overdue], onOpen: () => {}, onReschedule }) as React.ReactElement;
    const input = findInput(tree, '改 交周报 的截止日期');
    expect(input).not.toBeNull();
    input!.props.onChange({ target: { value: "2026-12-01" } });
    expect(onReschedule).toHaveBeenCalledWith(overdue, "2026-12-01");
  });

  it("清空日期不触发改动：应用内不做「去掉截止日期」这件事", () => {
    const onReschedule = vi.fn();
    const tree = DueInbox({ items: [overdue], onOpen: () => {}, onReschedule }) as React.ReactElement;
    const input = findInput(tree, '改 交周报 的截止日期');
    input!.props.onChange({ target: { value: "" } });
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it("点一条把笔记 id 交给调用方", () => {
    const onOpen = vi.fn();
    const tree = DueInbox({ items: [overdue], onOpen }) as React.ReactElement;
    const clickable = findClickable(tree);
    expect(clickable).not.toBeNull();
    clickable!.props.onClick();
    expect(onOpen).toHaveBeenCalledWith("a");
  });
});

function findClickable(node: React.ReactElement | null): React.ReactElement<{ onClick: () => void }> | null {
  if (!node || typeof node !== "object") return null;
  const props = node.props as { onClick?: () => void; children?: React.ReactNode };
  if (typeof props?.onClick === "function") return node as React.ReactElement<{ onClick: () => void }>;
  for (const child of React.Children.toArray(props?.children)) {
    const hit = findClickable(child as React.ReactElement);
    if (hit) return hit;
  }
  return null;
}

function findAllClickable(node: React.ReactElement | null): React.ReactElement<{ onClick: () => void }>[] {
  if (!node || typeof node !== "object") return [];
  const props = node.props as { onClick?: () => void; children?: React.ReactNode };
  const self = typeof props?.onClick === "function" ? [node as React.ReactElement<{ onClick: () => void }>] : [];
  const kids = React.Children.toArray(props?.children).flatMap((child) =>
    findAllClickable(child as React.ReactElement)
  );
  return [...self, ...kids];
}

/** 按 aria-label 找 input 元素（日期输入不走 onClick，要单独收集）。 */
function findInput(node: React.ReactElement | null, label: string): React.ReactElement<{ onChange: (e: { target: { value: string } }) => void }> | null {
  if (!node || typeof node !== "object") return null;
  const props = node.props as { "aria-label"?: string; onChange?: (e: { target: { value: string } }) => void; children?: React.ReactNode };
  if (props?.["aria-label"] === label && typeof props.onChange === "function") {
    return node as React.ReactElement<{ onChange: (e: { target: { value: string } }) => void }>;
  }
  for (const child of React.Children.toArray(props?.children)) {
    const hit = findInput(child as React.ReactElement, label);
    if (hit) return hit;
  }
  return null;
}
