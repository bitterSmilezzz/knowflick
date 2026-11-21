import { Children, isValidElement, type ChangeEvent, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GoalsEvidencePicker } from "./GoalsView";

describe("目标证据选择", () => {
  const notes = [
    { id: "n1", title: "有效笔记", isDeleted: false },
    { id: "n2", title: "已删除笔记", isDeleted: true },
  ];
  const materials = [{ id: "m1", title: "素材" }];

  it("分别列出有效笔记和素材，不提供已删除的笔记", () => {
    const html = renderToStaticMarkup(<GoalsEvidencePicker goalTitle="目标" notes={notes} materials={materials} onSelect={() => {}} />);
    expect(html).toContain("有效笔记");
    expect(html).toContain("素材");
    expect(html).not.toContain("已删除笔记");
  });

  it("两个选择器提交对应的来源类型，即使 id 相同也不会混淆", () => {
    const select = vi.fn();
    const element = GoalsEvidencePicker({ goalTitle: "目标", notes, materials, onSelect: select });
    const selects = Children.toArray(element.props.children).filter(
      (child): child is ReactElement<{ onChange: (e: ChangeEvent<HTMLSelectElement>) => void }> =>
        isValidElement(child) && child.type === "select",
    );
    expect(selects).toHaveLength(2);
    const change = { target: { value: "same-id" } } as ChangeEvent<HTMLSelectElement>;
    selects[0].props.onChange(change);
    selects[1].props.onChange(change);
    expect(select.mock.calls).toEqual([["same-id", "note"], ["same-id", "material"]]);
  });
});
