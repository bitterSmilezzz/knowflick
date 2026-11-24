import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BulkReplacePreview } from "./BulkReplacePreview";

const hit = {
  id: "a",
  title: "甲",
  count: 2,
  body: "库要建好",
  snippet: { before: "前缀 ", match: "知识库", after: " 后缀" },
};

describe("BulkReplacePreview", () => {
  it("没有命中时整块不渲染", () => {
    expect(renderToStaticMarkup(<BulkReplacePreview hits={[]} query="x" onConfirm={() => {}} onCancel={() => {}} />)).toBe("");
  });

  it("说明改几篇几处，并逐篇给出处数与第一处上下文", () => {
    const html = renderToStaticMarkup(
      <BulkReplacePreview hits={[hit]} query="知识库" onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(html).toContain("将在 1 篇笔记里替换 2 处「知识库」");
    expect(html).toContain("《甲》");
    expect(html).toContain("2 处");
    expect(html).toContain("<mark class=\"nv-snippet-hit\">知识库</mark>");
  });

  it("确认与取消分别回调，组件自己不写库", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const tree = BulkReplacePreview({ hits: [hit], query: "知识库", onConfirm, onCancel }) as React.ReactElement;
    const buttons = findAllClickable(tree);
    expect(buttons).toHaveLength(2);
    buttons[0].props.onClick();
    buttons[1].props.onClick();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

function findAllClickable(node: React.ReactElement | null): React.ReactElement<{ onClick: () => void }>[] {
  if (!node || typeof node !== "object") return [];
  const props = node.props as { onClick?: () => void; children?: React.ReactNode };
  const self = typeof props?.onClick === "function" ? [node as React.ReactElement<{ onClick: () => void }>] : [];
  const kids = React.Children.toArray(props?.children).flatMap((child) =>
    findAllClickable(child as React.ReactElement)
  );
  return [...self, ...kids];
}
