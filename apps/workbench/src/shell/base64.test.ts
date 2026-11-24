import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64 } from "./base64";

describe("附件字节的 base64 契约", () => {
  it("无损往返：空、单字节、全部 256 个字节值、真实文本", async () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    const samples = [
      new Uint8Array(0),
      new Uint8Array([0]),
      all,
      new TextEncoder().encode("手写笔迹 JSON：{\"strokes\":[[1,2],[3,4]]}"),
    ];
    for (const bytes of samples) {
      expect(Array.from(base64ToBytes(await bytesToBase64(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it("分块边界两侧都正确（32 KB 一段，跨段的往返必须完好）", async () => {
    const size = 0x8000 + 123; // 一整段多出一截
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 7 + 13) % 256;
    expect(Array.from(base64ToBytes(await bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it("编码结果与浏览器原生 btoa 对小输入一致，且带标准填充", async () => {
    const encoded = await bytesToBase64(new Uint8Array([104, 105]));
    expect(encoded).toBe(btoa("hi")); // "aGk="：与 Rust 侧 STANDARD 引擎对齐（含 = 填充）
    expect(Array.from(base64ToBytes("aGk="))).toEqual([104, 105]);
  });
});
