import { describe, expect, it } from "vitest";
import { INSIGHT_WINDOW_DAYS, SOURCE_WEIGHTS, senderWeight, sourceInsights, sourceKeyOf, sourceLabelOf, senderKeyOf } from "./insights";
import type { RawMaterial } from "../shell/store";
import type { KnowledgeCard } from "./card";
import { cardFromJson } from "./card";

const NOW = 1_760_000_000_000;
const DAY = 86_400_000;
function mail(id: string, from: string, account = "acct-1", status: RawMaterial["inboxStatus"] = "inbox"): RawMaterial {
  return { id, title: `主题 ${id}`, sourceType: "email", sourceUrl: null, rawText: `正文 ${id}`, contentHash: "",
    metadataJson: JSON.stringify({ mailAccountId: account, from, to: "me@example.test", date: "2026-10-21", messageId: `<${id}@x>` }),
    inboxStatus: status, createdAt: NOW, updatedAt: NOW };
}
function card(id: string, materialId: string | null, extra: Record<string, unknown> = {}): KnowledgeCard {
  // materialId must be inside the object handed to cardFromJson: it is the link
  // back to the material, and dropping it silently loses the "turned into a
  // card" signal — which is exactly the signal this model depends on.
  return cardFromJson({ id, headline: id, summary: "s", details: "d", createdAt: NOW, materialId, ...extra });
}

describe("来源洞察", () => {
  it("只按用户做过的事排序：沉淀 > 收藏 > 复习，无动作排最后", () => {
    const materials = [mail("m1", "甲 <a@x.test>"), mail("m2", "乙 <b@x.test>"), mail("m3", "丙 <c@x.test>")];
    const cards = [card("c1", "m1"), card("c2", "m2", { isFavorite: true }), card("c3", "m3", { reviewCount: 2 })];
    const { ranked } = sourceInsights({ materials, cards, now: NOW });
    const senders = ranked.filter(profile => profile.kind === "mailSender");
    expect(senders.map(profile => profile.key)).toEqual(["sender:a@x.test", "sender:b@x.test", "sender:c@x.test"]);
    expect(senders[0].converted).toBe(1);
    expect(senders[1].favorited).toBe(1);
    expect(senders[2].reviewed).toBe(1);
    expect(senders[0].score).toBeCloseTo(1);
    expect(senders[2].score).toBeGreaterThan(0);
  });

  it("权重与说明都能对上用户的真实动作，可解释", () => {
    const materials = [mail("m1", "甲 <a@x.test>"), mail("m2", "乙 <b@x.test>")];
    const { ranked } = sourceInsights({ materials, cards: [card("c1", "m1")], now: NOW });
    const profile = ranked.find(candidate => candidate.key === "sender:a@x.test");
    expect(profile?.reason).toContain("1 条已沉淀为知识卡");
    const idle = ranked.find(candidate => candidate.key === "sender:b@x.test");
    expect(idle?.reason).toContain("还没有收藏、沉淀或复习");
    expect(SOURCE_WEIGHTS.converted).toBeGreaterThan(SOURCE_WEIGHTS.favorited);
    expect(SOURCE_WEIGHTS.favorited).toBeGreaterThan(SOURCE_WEIGHTS.reviewed);
  });

  it("忽略会扣分，排在无动作来源之后", () => {
    const materials = [mail("m1", "甲 <a@x.test>"), mail("m2", "乙 <b@x.test>", undefined, "dismissed")];
    const { ranked } = sourceInsights({ materials, cards: [], now: NOW });
    const ignored = ranked.find(candidate => candidate.key === "sender:b@x.test");
    const plain = ranked.find(candidate => candidate.key === "sender:a@x.test");
    expect(ignored!.ignored).toBe(1);
    expect(ignored!.score).toBe(0);
    expect(ignored!.reason).toContain("1 条已忽略");
    // Both have no positive signal, but an ignored source must not outrank one
    // the user simply never acted on.
    expect(plain!.score).toBeGreaterThan(ignored!.score);
  });

  it("超过 90 天窗口的旧来源不再影响排序", () => {
    const stale: RawMaterial = { ...mail("old", "旧 <old@x.test>"), createdAt: NOW - 200 * DAY, updatedAt: NOW - 200 * DAY };
    const fresh = mail("new", "新 <new@x.test>");
    const { ranked } = sourceInsights({ materials: [stale, fresh], cards: [], now: NOW });
    expect(ranked.some(profile => profile.key === "sender:old@x.test")).toBe(false);
    expect(ranked.some(profile => profile.key === "sender:new@x.test")).toBe(true);
    expect(INSIGHT_WINDOW_DAYS).toBe(90);
  });

  it("账号级与发件人级分开统计", () => {
    const materials = [mail("m1", "甲 <a@x.test>", "acct-1"), mail("m2", "乙 <b@x.test>", "acct-1")];
    const { ranked } = sourceInsights({ materials, cards: [card("c1", "m1")], now: NOW });
    const account = ranked.find(profile => profile.key === "mail:acct-1");
    const sender = ranked.find(profile => profile.key === "sender:a@x.test");
    expect(account!.itemCount).toBe(2);
    expect(sender!.converted).toBe(1);
  });

  it("订阅与剪藏按来源统计，邮件归纳本身不算来源", () => {
    const sub: RawMaterial = { id: "s1", title: "RSS 条目", sourceType: "web", sourceUrl: "https://blog.example.com/a", rawText: "t", contentHash: "", metadataJson: JSON.stringify({ subscriptionId: "sub-1" }), inboxStatus: "inbox", createdAt: NOW, updatedAt: NOW };
    const digest: RawMaterial = { id: "d1", title: "邮件摘要", sourceType: "email-digest", sourceUrl: null, rawText: "x", contentHash: "", metadataJson: "{}", inboxStatus: "inbox", createdAt: NOW, updatedAt: NOW };
    const { ranked } = sourceInsights({ materials: [sub, digest], cards: [], now: NOW });
    expect(ranked.some(profile => profile.key === "subscription:sub-1")).toBe(true);
    expect(ranked.some(profile => profile.key === "email-digest")).toBe(false);
    expect(sourceKeyOf(sub)).toBe("subscription:sub-1");
    expect(sourceLabelOf("host:blog.example.com")).toBe("blog.example.com");
  });

  it("无正向信号时邮件排序回到时间顺序", () => {
    const materials = [mail("m1", "陌生 <stranger@x.test>"), mail("m2", "熟甲 <a@x.test>")];
    const { ranked } = sourceInsights({ materials, cards: [card("c1", "m2")], now: NOW });
    expect(senderWeight(materials[0], ranked)).toBe(0);
    expect(senderWeight(materials[1], ranked)).toBeGreaterThan(0);
  });

  it("坏元数据不影响统计", () => {
    const broken: RawMaterial = { ...mail("m1", "甲 <a@x.test>"), metadataJson: "broken" };
    const { ranked } = sourceInsights({ materials: [broken], cards: [], now: NOW });
    expect(ranked.length).toBeGreaterThan(0);
    expect(senderKeyOf(broken)).toBeNull();
    expect(sourceKeyOf(broken)).toBe("email");
  });
});

describe("归档不等于讨厌来源", () => {
  it("归档（processed）不会给来源降权", () => {
    const now = Date.now();
    const archived: RawMaterial = { id: "m1", sourceType: "email", title: "标题", sourceUrl: null,
      rawText: "正文", contentHash: "", mediaPath: null, mediaSizeBytes: 0,
      metadataJson: JSON.stringify({ from: "sender@example.test" }), inboxStatus: "processed",
      createdAt: now, updatedAt: now };
    const { ranked } = sourceInsights({ materials: [archived], cards: [], now });
    const sender = ranked.find(profile => profile.key === "sender:sender@example.test");
    expect(sender?.ignored ?? 0).toBe(0);
    expect(sender?.score ?? 0).toBeGreaterThan(0);
  });

  it("明确忽略（dismissed）才会给来源降权", () => {
    const now = Date.now();
    const ignored: RawMaterial = { id: "m1", sourceType: "email", title: "标题", sourceUrl: null,
      rawText: "正文", contentHash: "", mediaPath: null, mediaSizeBytes: 0,
      metadataJson: JSON.stringify({ from: "sender@example.test" }), inboxStatus: "dismissed",
      createdAt: now, updatedAt: now };
    const { ranked } = sourceInsights({ materials: [ignored], cards: [], now });
    const sender = ranked.find(profile => profile.key === "sender:sender@example.test");
    expect(sender?.ignored).toBe(1);
    expect(sender?.score).toBe(0);
  });
});
