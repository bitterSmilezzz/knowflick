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
 it("rejects blank input and unsafe sources before saving", () => {
  expect(() => makeMaterial({ title: "", text: " ", url: "" })).toThrow();
  expect(() => makeMaterial({ title: "", text: "正文", url: "javascript:alert(1)" })).toThrow();
  expect(() => makeMaterial({ title: "", text: "正文", url: "https://user:password@example.com" })).toThrow();
 });
});
