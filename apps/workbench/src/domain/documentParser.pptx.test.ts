import { describe, expect, it } from "vitest";
import { listZipEntries, parsePptxBuffer } from "./documentParser";

/** 构造一个不压缩的 ZIP（stored），只写本地文件头——解析器顺序读本地头即可。 */
function storedZip(entries: Array<[string, string]>): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const [name, content] of entries) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);   // local file header
    view.setUint16(8, 0, true);            // compression = stored
    view.setUint32(18, data.length, true); // compressed size
    view.setUint32(22, data.length, true); // uncompressed size
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    header.set(nameBytes, 30);
    chunks.push(header, data);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

const slide = (...texts: string[]) =>
  `<?xml version="1.0"?><p:sld xmlns:a="x"><p:cSld><p:spTree>` +
  texts.map(t => `<p:sp><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp>`).join("") +
  `</p:spTree></p:cSld></p:sld>`;

describe("PPTX 解析", () => {
  it("按页码提取每页文字", async () => {
    const zip = storedZip([
      ["ppt/slides/slide1.xml", slide("季度复盘", "收入增长 20%")],
      ["ppt/slides/slide2.xml", slide("下一步", "把复购率做上去")],
    ]);
    const doc = await parsePptxBuffer("演示", zip.buffer as ArrayBuffer);
    expect(doc.sections).toHaveLength(2);
    expect(doc.markdown).toContain("## 第 1 页");
    expect(doc.markdown).toContain("收入增长 20%");
    expect(doc.markdown).toContain("## 第 2 页");
    expect(doc.title).toBe("季度复盘");
    expect(doc.wordCount).toBeGreaterThan(0);
  });

  it("按幻灯片编号排序，而不是字符串顺序", async () => {
    // slide10 若按字符串排会跑到 slide2 前面
    const zip = storedZip([
      ["ppt/slides/slide10.xml", slide("第十页")],
      ["ppt/slides/slide2.xml", slide("第二页")],
    ]);
    const doc = await parsePptxBuffer("演示", zip.buffer as ArrayBuffer);
    expect(doc.markdown.indexOf("第二页")).toBeLessThan(doc.markdown.indexOf("第十页"));
  });

  it("还原 XML 实体，不把 &amp; 原样显示", async () => {
    const zip = storedZip([["ppt/slides/slide1.xml", slide("A &amp; B &lt;测试&gt;")]]);
    const doc = await parsePptxBuffer("演示", zip.buffer as ArrayBuffer);
    expect(doc.markdown).toContain("A & B <测试>");
  });

  it("全是图片没有文字时给出可读原因", async () => {
    const zip = storedZip([["ppt/slides/slide1.xml", slide()]]);
    await expect(parsePptxBuffer("演示", zip.buffer as ArrayBuffer)).rejects.toThrow(/没有可提取的文字/);
  });

  it("不是 PPTX 时说明找不到幻灯片", async () => {
    const zip = storedZip([["word/document.xml", "<x/>"]]);
    await expect(parsePptxBuffer("演示", zip.buffer as ArrayBuffer)).rejects.toThrow(/找不到幻灯片/);
  });

  it("能列出压缩包条目", () => {
    const zip = storedZip([["a.xml", "1"], ["b/c.xml", "2"]]);
    expect(listZipEntries(zip)).toEqual(["a.xml", "b/c.xml"]);
  });
});
