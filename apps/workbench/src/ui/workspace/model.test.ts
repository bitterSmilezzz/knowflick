import { describe, expect, it } from "vitest";
import { entriesFor, filterEntries } from "./model";
import type { RawMaterial } from "../../shell/store";
import { cardFromJson } from "../../domain/card";

const NOW = Date.now();
function material(extra: Partial<RawMaterial>): RawMaterial {
  return { id: "m1", title: "素材", sourceType: "manual", sourceUrl: null, rawText: "正文只有这一段",
    cleanedMarkdown: null, contentHash: "", mediaPath: null, mediaSizeBytes: 0, metadataJson: "{}",
    inboxStatus: "inbox", createdAt: NOW, updatedAt: NOW, ...extra } as RawMaterial;
}
const card = (extra: Record<string, unknown>) => cardFromJson({
  id: "c1", headline: "标题", summary: "一句话结论", details: "详细正文", category: "计算机",
  createdAt: NOW, ...extra });

const search = (materials: RawMaterial[], cards: any[], query: string) =>
  filterEntries(entriesFor(materials, cards, "library"), query).map(entry => entry.id);

describe("搜索覆盖", () => {
  it("能搜到知识卡的摘要（一句话结论常常才是用户记住的东西）", () => {
    const c = card({ summary: "复购率比拉新更重要" });
    expect(search([], [c], "复购率")).toContain("c1");
  });

  it("能搜到卡片的所有链接，而不只是第一条", () => {
    const c = card({ links: [{ title: "一", url: "https://a.example.com" }, { title: "二", url: "https://b.example.com" }] });
    expect(search([], [c], "b.example.com")).toContain("c1");
  });

  it("邮件能按发件人搜到", () => {
    const m = material({ sourceType: "email", title: "项目排期",
      metadataJson: JSON.stringify({ mailAccountId: "work", from: "团队 <team@example.com>" }) });
    expect(search([m], [], "team@example.com")).toContain("m1");
  });

  it("邮件能按附件名搜到", () => {
    const m = material({ sourceType: "email", title: "项目排期",
      metadataJson: JSON.stringify({ mailAccountId: "work", from: "a@b.c", attachmentFilenames: ["方案-v3.pdf"] }) });
    expect(search([m], [], "方案-v3")).toContain("m1");
  });

  it("搜不到的内容就是不该出现", () => {
    const m = material({});
    expect(search([m], [], "完全不存在")).toHaveLength(0);
  });
});
