import { describe, expect, it } from "vitest";
import { sha256Hex } from "./sha256";

/** 标准测试向量（FIPS 180-4 / NIST），钉住同步实现与规范一致。 */
describe("sha256Hex", () => {
  it("空串", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  it("abc", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("两个块的消息（含 padding 长度跨块）", () => {
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
    );
  });

  it("一百万个 a（多块压力向量）", () => {
    expect(sha256Hex("a".repeat(1_000_000))).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
    );
  });

  it("字节输入与字符串输入一致（UTF-8 编码）", () => {
    const bytes = new TextEncoder().encode("中文内容 bytes 一致性");
    expect(sha256Hex(bytes)).toBe(sha256Hex("中文内容 bytes 一致性"));
  });
});
