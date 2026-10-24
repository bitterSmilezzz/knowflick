import { describe, expect, it } from "vitest";
import {
  parseDocumentFile,
  parseMarkdownOrText,
  parseDocxXml,
  parsePdfBuffer,
} from "./documentParser";

describe("documentParser", () => {
  it("parses Markdown with title and sections correctly", () => {
    const md = `# 项目架构设计\n\n这是引言段落。\n\n## 核心模块\n\n模块A与模块B。\n\n## 部署说明\n\n本地执行脚本。`;
    const doc = parseMarkdownOrText("默认标题", md);
    expect(doc.title).toBe("项目架构设计");
    expect(doc.sections.length).toBe(3);
    expect(doc.sections[0].title).toBe("项目架构设计");
    expect(doc.sections[1].title).toBe("核心模块");
    expect(doc.sections[2].title).toBe("部署说明");
    expect(doc.wordCount).toBeGreaterThan(10);
  });

  it("parses plain text with fallback title", () => {
    const txt = "这是一段简单的纯文本随手笔记，没有使用 Markdown 标题。";
    const doc = parseMarkdownOrText("随笔", txt);
    expect(doc.title).toBe("随笔");
    expect(doc.sections.length).toBe(1);
    expect(doc.markdown).toBe(txt);
  });

  it("parses Docx XML with Heading styles into structured Markdown", () => {
    const docxXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>关于第二大脑的思考</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>第一段正文：知识沉淀与原子化。</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
      <w:r><w:t>离线优先原则</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>数据保存在用户本地磁盘。</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

    const doc = parseDocxXml("文档", docxXml);
    expect(doc.title).toBe("关于第二大脑的思考");
    expect(doc.markdown).toContain("# 关于第二大脑的思考");
    expect(doc.markdown).toContain("## 离线优先原则");
    expect(doc.markdown).toContain("知识沉淀与原子化");
    expect(doc.sections.length).toBe(2);
  });

  it("parses PDF text streams and string escapes", async () => {
    const pdfData = `
%PDF-1.4
1 0 obj << /Length 50 >>
stream
BT
/F1 12 Tf
(KnowFlick Architecture Overview) Tj
[(Local ) 10 (First ) 10 (Design)] TJ
ET
endstream
endobj
%%EOF`;
    const buffer = new TextEncoder().encode(pdfData).buffer;
    const doc = await parsePdfBuffer("系统设计", buffer);
    expect(doc.title).toBe("系统设计");
    expect(doc.markdown).toContain("KnowFlick Architecture Overview");
    expect(doc.markdown).toContain("Local First Design");
  });

  it("parses FlateDecode compressed PDF streams（真实世界的 PDF 几乎都是压缩的）", async () => {
    // 不解压的话，抽出来的不是文档内容，而是 PDF 源码本身
    // （"1.4 1 0 obj Type Catalog…"）——用户导入绝大多数 PDF 会得到一堆乱码。
    // 这份 fixture 是一个真实结构的压缩 PDF（带 xref、/Filter /FlateDecode）。
    const base64 = [
"JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2Jq",
"CjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2Jq",
"CjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIg",
"NzkyXSAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA2MyAvRmls",
"dGVyIC9GbGF0ZURlY29kZSA+PgpzdHJlYW0KeJxzClHQdzNUMDRSCElTMDdSMDcwUAhJUdDwzssv",
"d8vJTM5WcM7PLShKLS5OTVEIcHHTVAjJUnANAQCSzA+RCmVuZHN0cmVhbQplbmRvYmoKeHJlZgow",
"IDUKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAw",
"MDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjAyIDAwMDAwIG4gCnRyYWlsZXIKPDwg",
"L1NpemUgNSAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKMzM2CiUlRU9GCg=="
    ].join("");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const doc = await parsePdfBuffer("压缩文档", bytes.buffer as ArrayBuffer);
    expect(doc.markdown).toContain("KnowFlick Compressed PDF");
    expect(doc.markdown).not.toContain("obj");
    expect(doc.markdown).not.toContain("endstream");
  });

  it("rejects unsupported file extensions with clean message", async () => {
    const buffer = new ArrayBuffer(8);
    await expect(parseDocumentFile("test.exe", buffer)).rejects.toThrow("不支持的文件格式: .exe");
  });
});
