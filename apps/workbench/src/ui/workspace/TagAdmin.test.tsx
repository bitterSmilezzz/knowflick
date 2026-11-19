import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TagAdmin } from "./TagAdmin";

const tags = [
  { tag: "工作", count: 3 },
  { tag: "复盘", count: 1 },
];

describe("TagAdmin", () => {
  it("没有标签时不渲染", () => {
    expect(renderToStaticMarkup(<TagAdmin tags={[]} onRename={() => {}} />)).toBe("");
  });

  it("列出标签与篇数，并把旧标签做成候选", () => {
    const html = renderToStaticMarkup(<TagAdmin tags={tags} onRename={() => {}} />);
    expect(html).toContain("整理标签（2 个）");
    expect(html).toContain('value="工作"');
    expect(html).toContain("工作（3）");
    expect(html).toContain("复盘（1）");
  });

  it("没选旧标签或没填新名字时按钮禁用：不让空重命名跑一趟", () => {
    const html = renderToStaticMarkup(<TagAdmin tags={tags} onRename={() => {}} />);
    expect(html).toContain("disabled");
  });

  it("没有 onRename 时不给按钮（只列出来看）", () => {
    const html = renderToStaticMarkup(<TagAdmin tags={tags} />);
    expect(html).toContain("整理标签（2 个）");
    expect(html).not.toContain("重命名</button>");
  });

  // 交互路径（选标签 → 填名字 → 点重命名）由浏览器冒烟守住：
  // 服务端渲染推进不了组件内部状态，硬在这里断言只会写出永远为真的句子。
  it("说明文字讲清楚合并规则，不让用户以为会留下两个同名标签", () => {
    const html = renderToStaticMarkup(<TagAdmin tags={tags} onRename={() => {}} />);
    expect(html).toContain("不会留下两个同名标签");
    expect(html).toContain("正文一个字都不动");
  });
});
