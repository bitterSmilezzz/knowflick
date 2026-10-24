import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SourceInsightPanel } from "./SourceInsightPanel";
import { cardFromJson, type KnowledgeCard } from "../../domain/card";
import type { RawMaterial } from "../../shell/store";

// The panel computes against the current time, so fixtures must be recent.
const NOW = Date.now();
const mail = (id: string, from: string): RawMaterial => ({
  id, title: id, sourceType: "email", sourceUrl: null, rawText: "正文", contentHash: "",
  metadataJson: JSON.stringify({ mailAccountId: "acct-1", from }),
  inboxStatus: "inbox", createdAt: NOW, updatedAt: NOW,
});
const card = (id: string, materialId: string): KnowledgeCard =>
  cardFromJson({ id, headline: id, summary: "s", details: "d", createdAt: NOW, materialId });

describe("来源贡献面板", () => {
  it("列出有信号的来源并给出可核对的说明", () => {
    const html = renderToStaticMarkup(
      <SourceInsightPanel materials={[mail("m1", "甲 <a@x.test>"), mail("m2", "乙 <b@x.test>")]} cards={[card("c1", "m1")]} enabled onToggle={() => {}} />
    );
    expect(html).toContain("来源贡献");
    expect(html).toContain("a@x.test");
    expect(html).toContain("已沉淀为知识卡");
    expect(html).not.toContain("还没有足够信号");
  });

  it("没有信号时说明如何产生信号，而不是空白", () => {
    const html = renderToStaticMarkup(<SourceInsightPanel materials={[]} cards={[]} enabled onToggle={() => {}} />);
    expect(html).toContain("还没有足够信号");
    expect(html).toContain("转成知识卡");
  });

  it("关闭后说明排序退回时间顺序，开关可操作", () => {
    const html = renderToStaticMarkup(<SourceInsightPanel materials={[]} cards={[]} enabled={false} onToggle={() => {}} />);
    expect(html).toContain("个性化已关闭");
    expect(html).toContain("按时间排列");
    expect(html).toContain('role="switch"');
  });
});
