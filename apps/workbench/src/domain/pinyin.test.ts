import { describe, expect, it } from "vitest";
import { phonetics, pinyinMatchShortText } from "./pinyin";

describe("pinyin", () => {
  it("matches kotlin dictionary anchors", () => {
    expect(phonetics("中子星").initials).toBe("zzx");
    expect(phonetics("新租赁").initials).toBe("xzl");
    expect(phonetics("人工智能").initials).toBe("rgzn");
    expect(phonetics("中子星").full).toBe("zhongzixing");
    expect(phonetics("人工智能").full).toBe("rengongzhineng");
    expect(phonetics("新租赁").full).toContain("zulin");
  });

  it("scores initials and full pinyin like the shared engine", () => {
    const headline = "新租赁准则下承租人不再区分经营融资租赁";
    const initials = pinyinMatchShortText(headline, "xzl", "initials");
    const full = pinyinMatchShortText(headline, "zulin", "pinyin_full");
    expect(initials).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(0);
    // 分数本身也要对：首字母缩写应高于全拼（更精确的匹配给更高分），
    // 否则「随便给个正数」也能通过。
    expect(initials).toBeGreaterThan(full);
    // 不相关的查询不该有分
    expect(pinyinMatchShortText(headline, "zzzz", "initials")).toBe(0);
  });
});
