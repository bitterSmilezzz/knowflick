import { describe, expect, it } from "vitest";
import { entriesFor, filterEntries, makeMaterial, materialToCard } from "./model";

describe("workspace collection and capture behavior", () => {
 it("captures plain text and preserves origin while converting to a card", () => {
  const m = makeMaterial({ title: "", text: "  灵感标题\n正文包含中文搜索与 RAG  ", url: "" });
  expect(m.title).toBe("灵感标题"); expect(m.rawText).toBe("灵感标题\n正文包含中文搜索与 RAG");
  const c = materialToCard(m);
  expect(c.materialId).toBe(m.id); expect(c.details).toBe(m.rawText); expect(c.id).not.toBe(m.id);
  expect(entriesFor([m], [c], "inbox")).toHaveLength(1);
  expect(entriesFor([m], [c], "library")).toHaveLength(2);
 });
 it("archive remains discoverable; favorites only include favorited cards", () => {
  const m = { ...makeMaterial({ title: "", text: "原文", url: "" }), inboxStatus: "dismissed" as const };
  const c = { ...materialToCard(m), isFavorite: true };
  expect(entriesFor([m], [c], "inbox")).toHaveLength(0);
  expect(entriesFor([m], [c], "archive")[0].text).toBe("原文");
  expect(entriesFor([m], [c], "favorites")[0].kind).toBe("card");
 });
 it("finds two-character Chinese substrings, body, tags and combined terms", () => {
  const m = makeMaterial({ title: "混合检索实践", text: "正文中记录 SQLite 和向量数据库", url: "https://example.com/note" });
  const c = { ...materialToCard(m), tags: ["离线"], category: "软件" };
  const entries = entriesFor([m], [c], "library");
  expect(filterEntries(entries, "检索 SQLite")).toHaveLength(2);
  expect(filterEntries(entries, "离线")).toHaveLength(1);
  expect(filterEntries(entries, "", "软件", "card")).toHaveLength(1);
  expect(filterEntries(entries, "不存在")).toHaveLength(0);
 });
 it("indexed ids rescue entries the in-memory substring match would miss", () => {
  const m = makeMaterial({ title: "CMP 可行性", text: "共享界面采用 Compose Multiplatform", url: "" });
  const other = makeMaterial({ title: "无关素材", text: "与检索词毫无关系", url: "" });
  const entries = entriesFor([m, other], [], "library");
  // 这个词不在正文里，纯内存匹配不会有结果
  expect(filterEntries(entries, "向量索引")).toHaveLength(0);
  // 索引（FTS5 的分词/前缀口径与 includes 并不等价）说这条素材命中，就把它带进来
  const indexed = filterEntries(entries, "向量索引", "", "all", new Set([m.id]));
  expect(indexed).toHaveLength(1);
  expect(indexed[0].id).toBe(m.id);
  // 索引兜底不该越权：标签/集合筛选仍然生效
  expect(filterEntries(entries, "向量索引", "不存在的分类", "all", new Set([m.id]))).toHaveLength(0);
  expect(filterEntries(entries, "向量索引", "", "card", new Set([m.id]))).toHaveLength(0);
  // 空查询时索引集合不生效，避免把整库都放出来
  expect(filterEntries(entries, "", "", "all", new Set([m.id, other.id]))).toHaveLength(2);
 });
 it("rejects blank input and unsafe sources before saving", () => {
  expect(() => makeMaterial({ title: "", text: " ", url: "" })).toThrow();
  expect(() => makeMaterial({ title: "", text: "正文", url: "javascript:alert(1)" })).toThrow();
  expect(() => makeMaterial({ title: "", text: "正文", url: "https://user:password@example.com" })).toThrow();
 });
});
