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
