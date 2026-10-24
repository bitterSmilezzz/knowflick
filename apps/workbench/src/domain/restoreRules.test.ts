import { describe, expect, it } from "vitest";
import { restorableArtifacts, restorableCards, restorableMaterials } from "./restoreRules";
import { cardFromJson } from "./card";
import type { RawMaterial } from "../shell/store";

/**
 * 恢复备份时的入库判定。
 *
 * 这里曾经是**静默丢数据**的地方：恢复时用 `!c.headline || !c.details` 过滤卡片、
 * `|| !m.title` 过滤素材，于是「空标题」「空正文」的条目被悄悄丢弃——
 * 备份里明明写进去了，界面却只说「恢复完成」。
 *
 * 之前这条只有浏览器层的证据（settings_plugins_smoke.mjs），而那套要真实浏览器、
 * **CI 跑不了**。现在规则抽到这里，CI 每次都跑。
 */
const material = (over: Partial<RawMaterial> = {}): RawMaterial => ({
  id: "m1", sourceType: "web", title: "标题", sourceUrl: null, rawText: "正文",
  contentHash: "", mediaPath: null, mediaSizeBytes: 0, metadataJson: "{}",
  inboxStatus: "inbox", createdAt: 1, updatedAt: 1, ...over,
});
const card = (over: Record<string, unknown> = {}) =>
  cardFromJson({ id: "c1", headline: "标题", summary: "摘要", details: "正文", createdAt: 1, ...over });

describe("恢复备份：什么该被放回去", () => {
  it("空标题的素材要恢复（那是用户自己建的）", () => {
    const items = restorableMaterials([material({ id: "m-empty-title", title: "" })]);
    expect(items).toHaveLength(1);
  });

  it("空正文的素材要恢复", () => {
    expect(restorableMaterials([material({ id: "m-empty-body", rawText: "" })])).toHaveLength(1);
  });

  it("没有 id 的素材无法入库，跳过", () => {
    expect(restorableMaterials([material({ id: "" })])).toHaveLength(0);
  });

  it("正文不是字符串的行无法入库，跳过", () => {
    const broken = { ...material(), rawText: 42 } as unknown as RawMaterial;
    expect(restorableMaterials([broken])).toHaveLength(0);
  });

  it("空标题的卡片要恢复", () => {
    expect(restorableCards([card({ id: "c-empty-title", headline: "" })])).toHaveLength(1);
  });

  it("空正文的卡片要恢复", () => {
    expect(restorableCards([card({ id: "c-empty-body", details: "" })])).toHaveLength(1);
  });

  it("没有 id 的卡片跳过", () => {
    expect(restorableCards([card({ id: "" })])).toHaveLength(0);
  });

  it("产物仍要求有标题（它没有正文可退化）", () => {
    const arts = [
      { id: "a1", title: "标题" },
      { id: "a2", title: "" },
      { id: "", title: "标题" },
    ];
    expect(restorableArtifacts(arts)).toHaveLength(1);
  });
});
