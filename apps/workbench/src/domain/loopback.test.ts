import { describe, expect, it } from "vitest";
import { isLoopbackHost, requiresKey } from "./ingest";

/**
 * 回环判定：本地部署的服务（Ollama、本地网关）用。
 *
 * 口径必须与安卓端 `LoopbackHost`、桌面壳 `is_loopback_host` 一致
 * （ADR-0002 §3：同一份 settings.json 在两端行为相同）。
 * 安卓侧有镜像用例 `LoopbackHostTest.kt`，两组用例用同一批地址。
 */
describe("isLoopbackHost：本机回环判定", () => {
  it("127.0.0.1 是回环", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
  });

  it("localhost 是回环", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("LOCALHOST")).toBe(true);
  });

  it("IPv6 回环的各种写法都是回环", () => {
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("0:0:0:0:0:0:0:1")).toBe(true);
    expect(isLoopbackHost("[0:0:0:0:0:0:0:1]")).toBe(true);
  });

  it("未指定地址不是回环", () => {
    expect(isLoopbackHost("::")).toBe(false);
    expect(isLoopbackHost("[::]")).toBe(false);
  });

  it("IPv4 映射写法不是回环（Rust 端也不认）", () => {
    expect(isLoopbackHost("::ffff:127.0.0.1")).toBe(false);
    expect(isLoopbackHost("[::ffff:7f00:1]")).toBe(false);
  });

  it("普通 IPv6 与内网地址不是回环", () => {
    expect(isLoopbackHost("[2001:db8::1]")).toBe(false);
    expect(isLoopbackHost("192.168.1.10")).toBe(false);
    expect(isLoopbackHost("10.0.0.1")).toBe(false);
    expect(isLoopbackHost("example.com")).toBe(false);
  });

  it("空值与畸形输入不算回环，也不该抛错", () => {
    expect(isLoopbackHost("")).toBe(false);
    expect(isLoopbackHost("   ")).toBe(false);
    expect(isLoopbackHost("not a host")).toBe(false);
  });
});

describe("requiresKey：本地地址不需要密钥", () => {
  it("回环地址免密钥", () => {
    expect(requiresKey("http://127.0.0.1:11434/v1")).toBe(false);
    expect(requiresKey("http://localhost:11434/v1")).toBe(false);
    expect(requiresKey("http://[::1]:11434/v1")).toBe(false);
    expect(requiresKey("http://[0:0:0:0:0:0:0:1]:11434/v1")).toBe(false);
  });

  it("公网地址要密钥", () => {
    expect(requiresKey("https://api.example.test/v1")).toBe(true);
    expect(requiresKey("http://[2001:db8::1]:11434/v1")).toBe(true);
  });
});
