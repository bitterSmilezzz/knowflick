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

  it("给了 onRemove 才出现「删除这条引用」，点了把整条问题交出去", () => {
    const onRemove = vi.fn();
    const issue = { noteId: "n-1", noteTitle: "甲", targetId: "gone", targetTitle: "被删的", status: "missing" as const };
    const withRemove = renderToStaticMarkup(
      <ReferenceAuditPanel issues={[issue]} onOpen={() => {}} onRemove={onRemove} />
    );
    expect(withRemove).toContain("删除这条引用");
    const without = renderToStaticMarkup(<ReferenceAuditPanel issues={[issue]} onOpen={() => {}} />);
    expect(without).not.toContain("删除这条引用");
    const tree = ReferenceAuditPanel({ issues: [issue], onOpen: () => {}, onRemove }) as React.ReactElement;
    const clickable = findAllClickable(tree).find((el) => (el.props as { children?: React.ReactNode }).children === "删除这条引用");
    expect(clickable).toBeDefined();
    clickable!.props.onClick();
    expect(onRemove).toHaveBeenCalledWith(issue);
  });

  it("忽略与撤销忽略：忽略的不占待复核数，但仍在折叠区里能撤销", () => {
    const onIgnore = vi.fn();
    const onUnignore = vi.fn();
    const live = { noteId: "n-1", noteTitle: "甲", targetId: "x", targetTitle: "被删的", status: "missing" as const };
    const skipped = { noteId: "n-2", noteTitle: "乙", targetId: "y", targetTitle: "草稿", status: "missing" as const };
    const html = renderToStaticMarkup(
      <ReferenceAuditPanel
        issues={[live]}
        ignored={[skipped]}
        onOpen={() => {}}
        onIgnore={onIgnore}
        onUnignore={onUnignore}
      />
    );
    expect(html).toContain("1 处待复核");
    expect(html).toContain("另有 1 处已忽略");
    expect(html).toContain("已忽略 1 处");
    expect(html).toContain("撤销忽略");
    const tree = ReferenceAuditPanel({
      issues: [live],
      ignored: [skipped],
      onOpen: () => {},
      onIgnore,
      onUnignore,
    }) as React.ReactElement;
    const buttons = findAllClickable(tree);
    const ignoreBtn = buttons.find((el) => (el.props as { children?: React.ReactNode }).children === "忽略");
    const undoBtn = buttons.find((el) => (el.props as { children?: React.ReactNode }).children === "撤销忽略");
    expect(ignoreBtn).toBeDefined();
    expect(undoBtn).toBeDefined();
    ignoreBtn!.props.onClick();
    undoBtn!.props.onClick();
    expect(onIgnore).toHaveBeenCalledWith(live);
    expect(onUnignore).toHaveBeenCalledWith(skipped);
  });

  it("全部被忽略时面板仍在（否则用户再也找不到撤销入口）", () => {
    const skipped = { noteId: "n-2", noteTitle: "乙", targetId: "y", targetTitle: "草稿", status: "missing" as const };
    const html = renderToStaticMarkup(
      <ReferenceAuditPanel issues={[]} ignored={[skipped]} onOpen={() => {}} onUnignore={() => {}} />
    );
    expect(html).toContain("全部 1 处已忽略");
    expect(html).toContain("撤销忽略");
  });

  it("点条目把引用者笔记 id 交给调用方", () => {
    const onOpen = vi.fn();
    const tree = ReferenceAuditPanel({
      issues: [{ noteId: "n-1", noteTitle: "甲", targetId: "x", targetTitle: "被删的", status: "missing" }],
      onOpen,
    }) as React.ReactElement;
    // 按 aria-label 精确取「打开」——加筛选按钮之后，「第一个可点元素」已经不是它了，
    // 用「第一个」会让这条测试在加任何按钮时无声地测到别的东西。
    const open = findAllClickable(tree).find(
      (el) => (el.props as { "aria-label"?: string })["aria-label"] === "打开 甲"
    );
    expect(open).toBeDefined();
    open!.props.onClick();
    expect(onOpen).toHaveBeenCalledWith("n-1");
  });

  it("按类别筛选：按钮显示各类条数，点了把分类交给调用方", () => {
    const onFilter = vi.fn();
    const issues = [
      { noteId: "a", noteTitle: "甲", targetId: "x", targetTitle: "没了", status: "missing" as const },
      { noteId: "b", noteTitle: "乙", targetId: "y", targetTitle: "改过", status: "changed" as const },
      { noteId: "c", noteTitle: "丙", targetId: "z", targetTitle: "又改过", status: "changed" as const },
    ];
    const html = renderToStaticMarkup(<ReferenceAuditPanel issues={issues} onOpen={() => {}} onFilter={onFilter} />);
    expect(html).toContain("全部 3");
    expect(html).toContain("失效 1");
    expect(html).toContain("过期 2");
    const tree = ReferenceAuditPanel({ issues, onOpen: () => {}, onFilter }) as React.ReactElement;
    const changedTab = findAllClickable(tree).find(
      (el) => (el.props as { "aria-label"?: string })["aria-label"] === "只看过期的 2 处"
    );
    expect(changedTab).toBeDefined();
    changedTab!.props.onClick();
    expect(onFilter).toHaveBeenCalledWith("changed");
  });

  it("筛选后只列该类的条目", () => {
    const issues = [
      { noteId: "a", noteTitle: "甲", targetId: "x", targetTitle: "没了", status: "missing" as const },
      { noteId: "b", noteTitle: "乙", targetId: "y", targetTitle: "改过", status: "changed" as const },
    ];
    const html = renderToStaticMarkup(
      <ReferenceAuditPanel issues={issues} filter="changed" onOpen={() => {}} onFilter={() => {}} />
    );
    expect(html).toContain("《乙》");
    expect(html).not.toContain("《甲》");
  });

  it("超过一页时出现翻页，并说明第几页、共几处", () => {
    const onPage = vi.fn();
    const issues = Array.from({ length: 10 }, (_, i) => ({
      noteId: `n${i}`,
      noteTitle: `笔记${i}`,
      targetId: `t${i}`,
      targetTitle: `原件${i}`,
      status: "missing" as const,
    }));
    const html = renderToStaticMarkup(<ReferenceAuditPanel issues={issues} onOpen={() => {}} onPage={onPage} />);
    expect(html).toContain("第 1 / 2 页 · 共 10 处");
    const tree = ReferenceAuditPanel({ issues, onOpen: () => {}, onPage }) as React.ReactElement;
    const next = findAllClickable(tree).find(
      (el) => (el.props as { "aria-label"?: string })["aria-label"] === "下一页"
    );
    expect(next).toBeDefined();
    next!.props.onClick();
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it("只有一页时不显示翻页（没有可翻的东西就不占版面）", () => {
    const issues = [{ noteId: "a", noteTitle: "甲", targetId: "x", targetTitle: "没了", status: "missing" as const }];
    const html = renderToStaticMarkup(<ReferenceAuditPanel issues={issues} onOpen={() => {}} onPage={() => {}} />);
    expect(html).not.toContain("下一页");
  });
});

/** 收集所有带 onClick 的节点：按 aria-label 精确定位，避免「第一个可点元素」随新增按钮漂移。 */
function findAllClickable(node: React.ReactElement | null): React.ReactElement<{ onClick: () => void }>[] {
  if (!node || typeof node !== "object") return [];
  const props = node.props as { onClick?: () => void; children?: React.ReactNode };
  const self = typeof props?.onClick === "function" ? [node as React.ReactElement<{ onClick: () => void }>] : [];
  const kids = React.Children.toArray(props?.children).flatMap((child) =>
    findAllClickable(child as React.ReactElement)
  );
  return [...self, ...kids];
}
