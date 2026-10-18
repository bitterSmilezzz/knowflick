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
    expect(pinyinMatchShortText(headline, "xzl", "initials")).toBeGreaterThan(0);
    expect(pinyinMatchShortText(headline, "zulin", "pinyin_full")).toBeGreaterThan(0);
  });
});
