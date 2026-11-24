import { describe, expect, it, beforeEach } from "vitest";
import { deterministicHash } from "./cardArrange";
import {
  allKeys,
  clearThemeCache,
  financePool,
  humanitiesPool,
  resolveThemeKey,
  sciencePool,
  techPool,
  themeKeyForCard,
} from "./cardTheme";
import { cardFromJson } from "./card";

function card(headline: string, category = "冷知识") {
  return cardFromJson({ id: `id-${headline}`, headline, category, summary: "" });
}

describe("card theme", () => {
  beforeEach(() => clearThemeCache());

  it("matches cross-platform FNV anchors", () => {
    expect(deterministicHash("knowflick").toString()).toBe("10604710463354862449");
    expect(deterministicHash("量子纠缠").toString()).toBe("18303554525994447684");
  });

  it("keeps pool structure aligned with Kotlin", () => {
    expect(allKeys.length).toBe(42);
    expect(new Set(allKeys).size).toBe(42);
    expect(techPool.length).toBe(15);
    expect(sciencePool.length).toBe(15);
    expect(humanitiesPool.length).toBe(10);
    expect(financePool.length).toBe(8);
    const union = new Set([...techPool, ...sciencePool, ...humanitiesPool, ...financePool]);
    expect(allKeys.every((key) => union.has(key))).toBe(true);
    for (const pool of [techPool, sciencePool, humanitiesPool, financePool]) {
      expect(pool.every((key) => allKeys.includes(key as typeof allKeys[number]))).toBe(true);
    }
  });

  it("routes categories into domain pools", () => {
    expect(financePool).toContain(resolveThemeKey("中级会计", "毫无关联的标题"));
    expect(financePool).toContain(resolveThemeKey("投资理财", "毫无关联的标题"));
    expect(techPool).toContain(resolveThemeKey("AI", "毫无关联的标题"));
    expect(techPool).toContain(resolveThemeKey("AI 开发", "毫无关联的标题"));
    expect(resolveThemeKey("AI Agent", "毫无关联的标题")).toBe("agent");
  });

  it("resolves headline keywords within finance and tech", () => {
    expect(resolveThemeKey("中级会计", "先进先出法（FIFO）")).toBe("algorithm");
    expect(resolveThemeKey("中级会计", "会计等式与借贷必相等")).toBe("math");
    expect(resolveThemeKey("投资理财", "复利与年化收益率")).toBe("math");
    expect(resolveThemeKey("投资理财", "区块链与比特币的去中心化")).toBe("crypto");
    expect(resolveThemeKey("AI 开发", "Rust 的所有权与借用")).toBe("rust");
    expect(resolveThemeKey("AI Agent", "智能体的记忆与向量数据库检索")).toBe("database");
  });

  it("prefers subject keywords over incidental summary words", () => {
    expect(resolveThemeKey("冷知识", "月球潮汐锁定", "这是日常生活中的常见现象")).toBe("astronomy");
  });

  it("caches per card until content changes", () => {
    const a = resolveThemeKey("冷知识", "完全无法归类的标题甲");
    expect(a).toBe(resolveThemeKey("冷知识", "完全无法归类的标题甲"));
    expect(allKeys).toContain(a);
    const subject = card("完全无法归类的标题甲");
    expect(themeKeyForCard(subject)).toBe(a);
    const edited = { ...subject, headline: "量子纠缠与叠加态" };
    expect(themeKeyForCard(edited)).toBe("quantum");
    expect(themeKeyForCard(subject)).toBe(a);
  });

  it("spreads unknown categories across the pool", () => {
    clearThemeCache();
    const keys = Array.from({ length: 200 }, (_, index) => themeKeyForCard(card(`未知分类样本 ${index}`, "未知分类")));
    expect(keys.every((key) => allKeys.includes(key as typeof allKeys[number]))).toBe(true);
    expect(new Set(keys).size).toBeGreaterThanOrEqual(30);
  });
});
