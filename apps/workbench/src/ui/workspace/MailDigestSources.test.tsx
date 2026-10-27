import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MailDigestSources } from "./MailDigestSources";
import { mailDigestSources } from "../../domain/mail";
import type { RawMaterial } from "../../shell/store";

const mail = (id: string, title: string): RawMaterial => ({
  id, title, sourceType: "email", sourceUrl: null, rawText: "正文", contentHash: "",
  metadataJson: JSON.stringify({ mailAccountId: "work", from: "团队 <team@example.com>", date: "2026-10-21" }),
  inboxStatus: "inbox", createdAt: 1, updatedAt: 1,
});

describe("MailDigestSources", () => {
  it("列出编号来源并可跳回原邮件", () => {
    const materials = [mail("a", "预算"), mail("b", "方案")];
    const html = renderToStaticMarkup(<MailDigestSources sources={mailDigestSources(materials)} materials={materials} onOpenMaterial={() => {}} />);
    expect(html).toContain("[邮件 1]");
    expect(html).toContain("[邮件 2]");
    expect(html).toContain("查看原邮件：预算");
    expect(html).not.toContain("disabled");
  });

  it("原件已删除时说明情况且按钮不可用", () => {
    const html = renderToStaticMarkup(<MailDigestSources sources={mailDigestSources([mail("gone", "旧邮件")])} materials={[]} onOpenMaterial={() => {}} />);
    expect(html).toContain("原邮件已不在当前库中");
    expect(html).toContain("disabled");
  });

  it("没有来源时不渲染空壳", () => {
    expect(renderToStaticMarkup(<MailDigestSources sources={[]} materials={[]} onOpenMaterial={() => {}} />)).toBe("");
  });
});
