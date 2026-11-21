import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VerifyInbox } from "./VerifyInbox";

const item = { noteId: "a", noteTitle: "甲", line: 2, text: "A 与 B 有因果关系" };

describe("VerifyInbox", () => {
  it("没有待验证时整块不渲染", () => {
    expect(renderToStaticMarkup(<VerifyInbox items={[]} onOpen={() => {}} />)).toBe("");
  });

  it("说明条数与涉及篇数，并列出断言原文", () => {
    const html = renderToStaticMarkup(
      <VerifyInbox items={[item, { ...item, noteId: "b", noteTitle: "乙", line: 0, text: "另一条" }]} onOpen={() => {}} />
    );
    expect(html).toContain("待验证：2 条断言（涉及 2 篇笔记）");
    expect(html).toContain("A 与 B 有因果关系");
    expect(html).toContain("《甲》");
  });

  it("超过 8 条只列前 8 条，并说明还有多少", () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ ...item, line: i, text: `断言${i}` }));
    const html = renderToStaticMarkup(<VerifyInbox items={many} onOpen={() => {}} />);
    expect(html).toContain("断言7");
    expect(html).not.toContain("断言8");
    expect(html).toContain("还有 3 条未列出");
  });

  it("给了 onVerified 才出现「已核实」，点了把整条交出去", () => {
    const onVerified = vi.fn();
    const withBtn = renderToStaticMarkup(<VerifyInbox items={[item]} onOpen={() => {}} onVerified={onVerified} />);
    expect(withBtn).toContain("已核实");
    const without = renderToStaticMarkup(<VerifyInbox items={[item]} onOpen={() => {}} />);
    expect(without).not.toContain("已核实");
    const tree = VerifyInbox({ items: [item], onOpen: () => {}, onVerified }) as React.ReactElement;
    const btn = findAllClickable(tree).find(
      (el) => (el.props as { children?: React.ReactNode }).children === "已核实"
    );
    expect(btn).toBeDefined();
    btn!.props.onClick();
    expect(onVerified).toHaveBeenCalledWith(item);
  });

  it("点条目把整条交给调用方（要能定位到那一行）", () => {
    const onOpen = vi.fn();
    const tree = VerifyInbox({ items: [item], onOpen }) as React.ReactElement;
    const open = findAllClickable(tree).find(
      (el) => (el.props as { "aria-label"?: string })["aria-label"] === "打开 甲 第 3 行"
    );
    expect(open).toBeDefined();
    open!.props.onClick();
    expect(onOpen).toHaveBeenCalledWith(item);
  });
});

/** 收集所有带 onClick 的节点：按 aria-label / 文字精确定位，不依赖顺序。 */
function findAllClickable(node: React.ReactElement | null): React.ReactElement<{ onClick: () => void }>[] {
  if (!node || typeof node !== "object") return [];
  const props = node.props as { onClick?: () => void; children?: React.ReactNode };
  const self = typeof props?.onClick === "function" ? [node as React.ReactElement<{ onClick: () => void }>] : [];
  const kids = React.Children.toArray(props?.children).flatMap((child) =>
    findAllClickable(child as React.ReactElement)
  );
  return [...self, ...kids];
}
