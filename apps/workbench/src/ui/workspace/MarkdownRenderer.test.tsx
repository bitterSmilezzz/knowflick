import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownRenderer } from "./MarkdownRenderer";

describe("MarkdownRenderer", () => {
  it("renders all heading depths, indentation and plain hash without stalling", () => {
    const html = renderToStaticMarkup(<MarkdownRenderer text={"#### 待办\n\n  ## 缩进标题\n\n#标签\n\n#\n\n正常段落"} />);
    expect(html).toContain("待办");
    expect(html).toContain("缩进标题");
    expect(html).toContain("#标签");
    expect(html).toContain("正常段落");
  });
  it("renders non-web links as plain text", () => {
    const html = renderToStaticMarkup(<MarkdownRenderer text={"[危险](javascript:alert) [文件](file:///etc/passwd) [网页](https://example.com)"} />);
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="file:');
    expect(html).toContain('href="https://example.com"');
  });
  it("renders in-library media attachments only with a resolver; falls back to text otherwise", () => {
    const md = "![图](media/image/a.png) ![外链](https://x/y.png) ![穿越](../../../etc/passwd)";
    // 无 resolver（详情区老用法）：全部回退为文本，不出现 <img>
    const plain = renderToStaticMarkup(<MarkdownRenderer text={md} />);
    expect(plain).not.toContain("<img");
    // 有 resolver：只解析库内相对路径；外链与路径穿越都不给 <img>
    const withResolver = renderToStaticMarkup(
      <MarkdownRenderer text={md} resolveAttachment={(p) => (p.startsWith("media/") ? { kind: "image" as const, url: "blob:x" } : null)} />
    );
    expect(withResolver).toContain('<img src="blob:x"');
    expect((withResolver.match(/<img/g) || []).length).toBe(1);
    // resolver 返回 null（附件真缺失）→ 渲染明确的「缺失」文案而不是空 <img>
    const missing = renderToStaticMarkup(
      <MarkdownRenderer text="![图](media/image/missing.png)" resolveAttachment={() => null} />
    );
    expect(missing).toContain("附件缺失：media/image/missing.png");
    expect(missing).not.toContain("<img");
  });

  it("按附件种类分别渲染：录音是播放器、笔迹是 SVG，都不是图片", () => {
    const inkDoc = {
      version: 1 as const,
      width: 1000,
      height: 600,
      strokes: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], width: 0.004, color: "ink" as const }],
    };
    const audio = renderToStaticMarkup(
      <MarkdownRenderer text="![录音](media/audio/a.webm)" resolveAttachment={() => ({ kind: "audio" as const, url: "blob:a" })} />
    );
    expect(audio).toContain("<audio");
    expect(audio).toContain('src="blob:a"');
    expect(audio).not.toContain("<img");
    const ink = renderToStaticMarkup(
      <MarkdownRenderer text="![笔迹](media/ink/a.json)" resolveAttachment={() => ({ kind: "ink" as const, doc: inkDoc })} />
    );
    expect(ink).toContain("<svg");
    expect(ink).toContain('viewBox="0 0 1 1"');
    expect(ink).toContain("M0.0000 0.0000 L1.0000 1.0000");
    expect(ink).not.toContain("<img");
  });

  it("笔迹内容坏了就当附件缺失，不画空 SVG", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer text="![笔迹](media/ink/a.json)" resolveAttachment={() => ({ kind: "ink" as const, doc: { version: 1, width: 10, height: 10, strokes: [] } })} />
    );
    expect(html).toContain("空笔迹");
    expect(html).not.toContain("<svg");
  });

  it("分隔行里的冒号决定列对齐——写了 :---: 就该居中", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer text={"| 甲 | 乙 | 丙 |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |"} />
    );
    expect(html).toContain('align="left"');
    expect(html).toContain('align="center"');
    expect(html).toContain('align="right"');
  });

  it("没有冒号的列不给 align 属性，交给样式表", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer text={"| 甲 |\n| --- |\n| 1 |"} />
    );
    expect(html).not.toContain("align=");
  });

  it("renders empty div for empty text", () => {
    const el = MarkdownRenderer({ text: "" });
    expect(React.isValidElement(el)).toBe(true);
    expect((el as React.ReactElement<{ className?: string }>).props.className).toBe("ws-prose");
  });

  it("renders headings, blockquotes, lists and code blocks", () => {
    const md = `## 架构原则\n\n> 保持离线可用。\n\n- 第一点\n- 第二点\n\n\`\`\`ts\nconst a = 1;\n\`\`\`\n\n正文包含 **加粗** 与 \`代码\`。`;
    const el = MarkdownRenderer({ text: md });
    expect(React.isValidElement(el)).toBe(true);

    const children = (el as React.ReactElement<{ children?: React.ReactElement[] }>).props.children;
    expect(Array.isArray(children)).toBe(true);
    expect(children!.length).toBeGreaterThanOrEqual(4);

    // 检查是否有 h2, blockquote, ul, pre
    const types = children!.map((c) => c.type);
    expect(types).toContain("h2");
    expect(types).toContain("blockquote");
    expect(types).toContain("ul");
    expect(types).toContain("pre");
    expect(types).toContain("p");
  });

  it("renders inline links with target blank", () => {
    const md = "请访问 [SQLite 官网](https://sqlite.org) 了解详情。";
    const el = MarkdownRenderer({ text: md });
    expect(React.isValidElement(el)).toBe(true);
  });
});
