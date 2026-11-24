import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NoteBacklinks } from "./NoteBacklinks";

describe("NoteBacklinks", () => {
  it("没有反向链接时整块不渲染", () => {
    const html = renderToStaticMarkup(<NoteBacklinks links={[]} onOpen={() => {}} />);
    expect(html).toBe("");
  });

  it("渲染「被引用（N）」与每一篇的标题，归档的标注出来", () => {
    const html = renderToStaticMarkup(
      <NoteBacklinks
        links={[
          { noteId: "a", title: "甲", snippet: "片段一", archived: false },
          { noteId: "b", title: "乙", snippet: "片段二", archived: true },
        ]}
        onOpen={() => {}}
      />
    );
    expect(html).toContain("被引用（2）");
    expect(html).toContain("《甲》");
    expect(html).toContain("《乙》（已归档）");
    expect(html).toContain('title="片段二"');
  });

  it("点一条把对应笔记 id 交给调用方", () => {
    const onOpen = vi.fn();
    // 静态渲染拿不到事件：直接遍历元素树找到第一个带 onClick 的节点再调用，
    // 验证的是「交出去的是笔记 id」，不依赖 children 的具体层级。
    const tree = NoteBacklinks({ links: [{ noteId: "n-1", title: "甲", snippet: "", archived: false }], onOpen });
    const clickable = findClickable(tree as React.ReactElement);
    expect(clickable).not.toBeNull();
    clickable!.props.onClick();
    expect(onOpen).toHaveBeenCalledWith("n-1");
  });
});

/** 在元素树里找第一个带 onClick 的节点（React.Children.toArray 只拍平一层，所以递归）。 */
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
