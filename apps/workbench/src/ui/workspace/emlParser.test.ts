import { describe, expect, it } from "vitest";
import { parseEml } from "./emlParser";

/**
 * `.eml` 是真实世界格式最复杂的来源之一：MIME 嵌套、base64 正文、
 * quoted-printable、RFC 2047 主题、字符集声明。
 */
describe("解析 .eml 邮件文件", () => {
  it("读出头部：发件人、收件人、主题、日期、Message-ID", () => {
    const eml = [
      "From: 张三 <zhangsan@example.com>",
      "To: 李四 <lisi@example.com>",
      "Subject: 季度报告与后续计划",
      "Date: Tue, 21 Oct 2026 08:30:00 +0800",
      "Message-ID: <abc123@example.com>",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "正文内容",
    ].join("\n");
    const mail = parseEml(eml);
    expect(mail.from).toContain("zhangsan@example.com");
    expect(mail.to).toContain("lisi@example.com");
    expect(mail.subject).toBe("季度报告与后续计划");
    expect(mail.date).toContain("21 Oct 2026");
    expect(mail.messageId).toBe("<abc123@example.com>");
  });

  it("RFC 2047 编码的主题要解出来", () => {
    // 真实导出工具常用 =?UTF-8?B?...?= 编码非 ASCII 标题
    const bytes = new TextEncoder().encode("季度报告");
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    const encoded = "=?UTF-8?B?" + btoa(binary) + "?=";
    const mail = parseEml(`Subject: ${encoded}\n\n正文`);
    expect(mail.subject).toBe("季度报告");
  });

  it("base64 正文要解出来（multipart/mixed）", () => {
    const bodyBytes = new TextEncoder().encode("这是 base64 编码的正文。");
    let bodyBinary = "";
    for (const b of bodyBytes) bodyBinary += String.fromCharCode(b);
    const body = btoa(bodyBinary);
    const eml = [
      "Subject: 测试",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="BB"',
      "",
      "--BB",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      body,
      "--BB--",
    ].join("\n");
    const mail = parseEml(eml);
    expect(mail.text).toContain("base64 编码的正文");
  });

  it("quoted-printable 正文要解出来", () => {
    const eml = [
      "Subject: 测试",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "=E4=B8=AD=E6=96=87=E6=AD=A3=E6=96=87",
    ].join("\n");
    const mail = parseEml(eml);
    expect(mail.text).toContain("中文正文");
  });

  it("只有 HTML 时剥标签取文字", () => {
    const eml = [
      "Subject: 测试",
      'Content-Type: text/html; charset="UTF-8"',
      "",
      "<html><body><p>第一段</p><p>第二段</p></body></html>",
    ].join("\n");
    const mail = parseEml(eml);
    expect(mail.text).toContain("第一段");
    expect(mail.text).toContain("第二段");
    expect(mail.text).not.toContain("<p>");
  });

  it("附件文件名要被认出来，正文不能被附件内容污染", () => {
    const eml = [
      "Subject: 带附件",
      'Content-Type: multipart/mixed; boundary="BB"',
      "",
      "--BB",
      'Content-Type: text/plain; charset="UTF-8"',
      "",
      "这是正文。",
      "--BB",
      "Content-Type: application/pdf; name=\"report.pdf\"",
      "Content-Disposition: attachment; filename=\"report.pdf\"",
      "Content-Transfer-Encoding: base64",
      "",
      "JVBERi0xLjQK",
      "--BB--",
    ].join("\n");
    const mail = parseEml(eml);
    expect(mail.attachments).toEqual(["report.pdf"]);
    expect(mail.text).toContain("这是正文");
    expect(mail.text).not.toContain("JVBERi0");
  });

  it("坏掉的邮件也要给出可用的结果，不抛错", () => {
    const mail = parseEml("这不是一封邮件");
    expect(mail.subject).toBe("（无主题）");
    expect(mail.text).toBe("");
  });

  it("缺主题时给占位，不留空", () => {
    const mail = parseEml("From: a@example.com\n\n正文");
    expect(mail.subject).toBe("（无主题）");
  });
});
