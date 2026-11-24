import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AttachmentView } from "./AttachmentView";

const inkDoc = {
  version: 1 as const,
  width: 1000,
  height: 600,
  strokes: [
    { points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }], width: 0.004, color: "ink" as const },
  ],
};

describe("AttachmentView", () => {
  it("图片用 <img>，并带 alt", () => {
    const html = renderToStaticMarkup(<AttachmentView payload={{ kind: "image", url: "blob:x" }} alt="图一" />);
    expect(html).toContain('<img src="blob:x"');
    expect(html).toContain('alt="图一"');
  });

  it("录音用 <audio controls>，不是图片", () => {
    const html = renderToStaticMarkup(<AttachmentView payload={{ kind: "audio", url: "blob:a" }} alt="录音一" />);
    expect(html).toContain("<audio");
    expect(html).toContain("controls");
    expect(html).toContain('src="blob:a"');
    expect(html).not.toContain("<img");
  });

  it("笔迹画成 SVG，颜色用语义名", () => {
    const html = renderToStaticMarkup(<AttachmentView payload={{ kind: "ink", doc: inkDoc }} alt="笔迹一" />);
    expect(html).toContain("<svg");
    expect(html).toContain("ws-md-ink-ink");
    expect(html).toContain("M0.0000 0.0000 L0.5000 0.5000");
    expect(html).not.toContain("<img");
  });

  it("没有载荷时回退为纯文本——不能渲染的东西不该假装能渲染", () => {
    const html = renderToStaticMarkup(<AttachmentView payload={null} alt="附件一" />);
    expect(html).toContain("附件一");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<audio");
    expect(html).not.toContain("<svg");
  });

  it("空笔迹说清楚是空的", () => {
    const html = renderToStaticMarkup(
      <AttachmentView payload={{ kind: "ink", doc: { version: 1, width: 10, height: 10, strokes: [] } }} alt="笔迹一" />
    );
    expect(html).toContain("空笔迹");
    expect(html).not.toContain("<svg");
  });
});
