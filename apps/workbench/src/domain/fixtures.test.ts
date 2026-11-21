import { describe, expect, it } from "vitest";
import { parseDocumentFile } from "./documentParser";
import { parseFeed } from "./subscription";
import { decodeHTML, digest } from "./clipEngine";
import { imageMimeOf, mediaMimeOfExtension } from "./mediaMime";

/**
 * 真实文件回归。
 *
 * 这里的每一个 fixture 都是**真实结构的文件**——不是「能跑的理想样本」：
 *   - PDF：带 xref、/Length，压缩的那份用 FlateDecode（真实世界几乎都是压缩的）
 *   - DOCX / PPTX：真正的 ZIP 容器
 *   - 图片：真的 PNG / JPEG / HEIC 头
 *   - feed：CDATA、HTML 实体、各种日期格式、相对链接、坏条目
 *   - 页面：GBK 编码、meta charset
 *
 * 为什么要专门留一套：30 轮里所有导入验证用的都是理想样本，恰好避开了真实世界的
 * 编码方式——于是漏掉了「压缩 PDF 解析出 PDF 源码」「JPEG 被存成 .png」
 * 「订阅源相对链接点不开」这三个缺陷。它们只能靠真实文件暴露。
 */
// 真实字节以 base64 存放在 bytes.json 里（?raw 导入）。
// 为什么不用 ?url + fetch：vitest 里 fetch 拿不到 dev server 的资源；
// 为什么不用 ?raw 直接导入二进制：raw 会把二进制当 UTF-8 文本处理，字节会坏。
import bytesJson from "./fixtures/bytes.json?raw";

const BASE64 = JSON.parse(bytesJson) as Record<string, string>;

function fixture(name: string): Uint8Array {
  const encoded = BASE64[name];
  if (!encoded) throw new Error(`缺少 fixture：${name}`);
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function fixtureText(name: string): string {
  return new TextDecoder("utf-8").decode(fixture(name));
}

const toArrayBuffer = (bytes: Uint8Array) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

describe("真实文件：文档解析", () => {
  it("DOCX：真实 ZIP 容器，标题层级与正文都要对", async () => {
    const doc = await parseDocumentFile("sample.docx", toArrayBuffer(fixture("sample.docx")));
    expect(doc.markdown).toContain("季度复盘");
    expect(doc.markdown).toContain("增长来自复购");
    expect(doc.markdown).toContain("获取成本远高于维护成本");
  });

  it("PPTX：真实 ZIP 容器，每页内容都要抽出来", async () => {
    const doc = await parseDocumentFile("sample.pptx", toArrayBuffer(fixture("sample.pptx")));
    expect(doc.markdown).toContain("关键结论");
    expect(doc.markdown).toContain("自动化要先做在最痛的地方");
  });

  it("PDF：未压缩流", async () => {
    const doc = await parseDocumentFile("sample.pdf", toArrayBuffer(fixture("sample.pdf")));
    expect(doc.markdown).toContain("KnowFlick Compressed PDF");
  });

  it("PDF：FlateDecode 压缩流——真实世界的 PDF 几乎都是压缩的", async () => {
    // 不解压的话抽出来的是 PDF 源码本身（"1.4 1 0 obj Type Catalog…"），
    // 用户导入绝大多数 PDF 会得到一堆乱码，而流程看起来「成功了」。
    const doc = await parseDocumentFile("sample-compressed.pdf", toArrayBuffer(fixture("sample-compressed.pdf")));
    expect(doc.markdown).toContain("KnowFlick Compressed PDF");
    expect(doc.markdown).not.toContain("obj");
    expect(doc.markdown).not.toContain("endstream");
  });
});

describe("真实文件：订阅源", () => {
  it("RSS：CDATA、实体、各种日期格式、坏条目跳过", () => {
    const items = parseFeed(fixtureText("sample-rss.xml"), "https://example.com/feed.xml");
    expect(items.length).toBe(3);
    expect(items[0].key).toBe("tag:example.com,2026:post-1");
    // content:encoded 优先于 description
    expect(items[0].text).toContain("Full content here");
    // RFC822 与 ISO 两种日期都要能解析
    expect(items[0].publishedAt).toBeTypeOf("number");
    expect(items[2].publishedAt).toBe(Date.parse("2026-10-19T12:00:00Z"));
  });

  it("RSS：相对链接要补成绝对地址", () => {
    // 直接存成素材的「原文链接」的话，相对路径点开是无效地址。
    const items = parseFeed(fixtureText("sample-rss.xml"), "https://example.com/feed.xml");
    expect(items.find((i) => i.title.includes("relative"))?.url).toBe("https://example.com/posts/2");
  });

  it("Atom：entry、urn:uuid 作 key、type=html 的 summary", () => {
    const items = parseFeed(fixtureText("sample-atom.xml"), "https://example.org/feed.xml");
    expect(items.length).toBe(2);
    expect(items[0].url).toBe("https://example.org/entries/1");
    expect(items[0].key).toContain("urn:uuid:");
    expect(items[1].title).toContain("escaped");
  });
});

describe("真实文件：网页剪藏", () => {
  it("UTF-8 页面：标题与正文", () => {
    const html = decodeHTML(new Uint8Array(fixture("sample-page.html")), null);
    const d = digest(html, "https://example.com/post");
    expect(d?.title).toBe("中文标题测试");
    expect(d?.text).toContain("这是第一段中文正文");
  });

  it("GBK 页面：中文不能乱码", () => {
    const bytes = new Uint8Array(fixture("sample-page-gbk.html"));
    const html = decodeHTML(bytes, null);
    expect(html).not.toContain("�");
    const d = digest(html, "https://example.com/post");
    expect(d?.title).toBe("GBK 标题");
    expect(d?.text).toContain("GBK 编码的中文网页正文");
  });
});

describe("真实文件：图片", () => {
  it("扩展名推出的 MIME 要对得上文件真正的格式", () => {
    // MIME 由扩展名推断（浏览器的 File.type 不总是有值）——
    // 判错会让 JPEG 存成 .png，内容与扩展名不符，有些查看器直接打不开。
    const cases: Array<[string, string, string]> = [
      ["sample.png", "png", "image/png"],
      ["sample.jpg", "jpg", "image/jpeg"],
      ["sample.heic", "heic", "image/heic"],
    ];
    for (const [name, fileName, expected] of cases) {
      const bytes = new Uint8Array(fixture(name));
      expect(bytes.byteLength).toBeGreaterThan(0);
      expect(imageMimeOf(fileName, "")).toBe(expected);
      // 反查也要一致：落盘时扩展名由 MIME 决定，恢复时由扩展名反推 MIME
      expect(mediaMimeOfExtension(expected.split("/")[1])).toBe(expected);
    }
  });

  it("文件头的魔数与扩展名一致（防止 fixture 自己造错）", () => {
    const png = new Uint8Array(fixture("sample.png"));
    expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const jpg = new Uint8Array(fixture("sample.jpg"));
    expect([jpg[0], jpg[1]]).toEqual([0xff, 0xd8]);
    const heic = new Uint8Array(fixture("sample.heic"));
    expect(new TextDecoder("latin1").decode(heic.slice(4, 8))).toBe("ftyp");
  });
});
