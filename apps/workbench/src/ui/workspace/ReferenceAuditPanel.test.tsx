import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReferenceAuditPanel } from "./ReferenceAuditPanel";

describe("ReferenceAuditPanel", () => {
  it("没有问题时整块不渲染", () => {
    expect(renderToStaticMarkup(<ReferenceAuditPanel issues={[]} onOpen={() => {}} />)).toBe("");
  });

  it("分别统计失效与过期，并逐条列出", () => {
    const html = renderToStaticMarkup(
      <ReferenceAuditPanel
        issues={[
          { noteId: "a", noteTitle: "甲", targetId: "x", targetTitle: "被删的", status: "missing" },
          { noteId: "b", noteTitle: "乙", targetId: "y", targetTitle: "改过的", status: "changed" },
        ]}
        onOpen={() => {}}
      />
    );
    expect(html).toContain("引用体检：2 处待复核");
    expect(html).toContain("失效 1");
    expect(html).toContain("过期 1");
    expect(html).toContain("《被删的》已不在库里");
    expect(html).toContain("《改过的》的内容改过了");
  });

  it("点条目把引用者笔记 id 交给调用方", () => {
    const onOpen = vi.fn();
    const tree = ReferenceAuditPanel({
      issues: [{ noteId: "n-1", noteTitle: "甲", targetId: "x", targetTitle: "被删的", status: "missing" }],
      onOpen,
    }) as React.ReactElement;
    const clickable = findClickable(tree);
    expect(clickable).not.toBeNull();
    clickable!.props.onClick();
    expect(onOpen).toHaveBeenCalledWith("n-1");
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
