import { describe, expect, it } from "vitest";
import { markLineVerified, needsVerify, textWithoutVerify, verifyItems, verifySummary } from "./noteVerify";

describe("待验证标记（C05）", () => {
  it("只认行末的 ❓：正文中间的 ❓ 是普通文字", () => {
    expect(needsVerify("这条结论没核实 ❓")).toBe(true);
    expect(needsVerify("这条结论没核实❓")).toBe(true);
    expect(needsVerify("❓ 开头但行末没有")).toBe(false);
    expect(needsVerify("用 ❓ 表示疑问，句末在这里。")).toBe(false);
    expect(needsVerify("普通一行")).toBe(false);
  });

  it("去掉标记时只动行末，正文其余字符原样", () => {
    expect(textWithoutVerify("A 与 B 有因果关系 ❓")).toBe("A 与 B 有因果关系");
    expect(textWithoutVerify("保留  中间空格 ❓  ")).toBe("保留  中间空格");
    expect(textWithoutVerify("没有标记")).toBe("没有标记");
  });

  it("清单只收有内容的行：空行与只有标记的行不算断言", () => {
    const body = [
      "# 标题",
      "",
      "结论一 ❓",
      "❓",
      "   ❓  ",
      "结论二",
      "结论三 ❓",
    ].join("\n");
    const items = verifyItems(body);
    expect(items.map((i) => i.text)).toEqual(["结论一", "结论三"]);
    expect(items.map((i) => i.line)).toEqual([2, 6]);
    expect(verifySummary(body)).toBe(2);
  });

  it("行号是原文行号：标了「已核实」能定点改对那一行", () => {
    const body = "第一行\n第二行 ❓\n第三行";
    const out = markLineVerified(body, 1);
    expect(out.changed).toBe(true);
    expect(out.body).toBe("第一行\n第二行\n第三行");
  });

  it("那一行本来没标记 / 行号越界 → 不改，调用方据此不多写一条修订", () => {
    const body = "第一行\n第二行";
    expect(markLineVerified(body, 0)).toEqual({ body, changed: false });
    expect(markLineVerified(body, 99)).toEqual({ body, changed: false });
  });

  it("只去掉被点那一行的标记，别的待验证行留着", () => {
    const body = "甲 ❓\n乙 ❓\n丙 ❓";
    const out = markLineVerified(body, 1);
    expect(out.body).toBe("甲 ❓\n乙\n丙 ❓");
    expect(verifySummary(out.body)).toBe(2);
  });

  it("CRLF 正文也能处理，且不会把 \r 留在行末", () => {
    const body = "甲 ❓\r\n乙 ❓";
    const out = markLineVerified(body, 0);
    expect(out.changed).toBe(true);
    expect(out.body.split("\n")[0]).toBe("甲");
  });
});
