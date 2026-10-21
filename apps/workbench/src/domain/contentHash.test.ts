import { describe, expect, it } from "vitest";
import { contentHashOf, existingHashes } from "./contentHash";

describe("内容指纹", () => {
  it("同样内容得到同样指纹", () => {
    expect(contentHashOf("一段笔记")).toBe(contentHashOf("一段笔记"));
  });

  it("行尾与首尾空白不影响判断", () => {
    expect(contentHashOf("第一行\r\n第二行")).toBe(contentHashOf("第一行\n第二行"));
    expect(contentHashOf("  内容  ")).toBe(contentHashOf("内容"));
  });

  it("不同内容得到不同指纹", () => {
    expect(contentHashOf("甲")).not.toBe(contentHashOf("乙"));
    expect(contentHashOf("第一行\n第二行")).not.toBe(contentHashOf("第一行\n第二行！"));
    // 首尾空白被忽略是**有意**的：粘贴时常带尾随空格，不该因此判成两份。
    expect(contentHashOf("内容")).toBe(contentHashOf("内容 "));
  });

  it("空内容没有指纹，避免把空素材互相判重", () => {
    expect(contentHashOf("")).toBe("");
    expect(contentHashOf("   \n  ")).toBe("");
  });

  it("长度参与指纹，长文本不因前缀相同而碰撞", () => {
    const a = "a".repeat(100);
    const b = "a".repeat(101);
    expect(contentHashOf(a)).not.toBe(contentHashOf(b));
  });

  it("收集已有指纹时忽略空值", () => {
    const set = existingHashes([{ contentHash: "x" }, { contentHash: "" }, {}, { contentHash: null }]);
    expect([...set]).toEqual(["x"]);
  });
});
