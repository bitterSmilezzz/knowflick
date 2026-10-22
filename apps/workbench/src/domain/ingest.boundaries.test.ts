import { describe, expect, it } from "vitest";
import { assertFetchableUrl, completionURL, requiresKey, transformPrompt } from "./ingest";

/**
 * 导入与剪藏这条主线上的**边界判定**。
 *
 * 这几个函数此前没有任何测试覆盖（`normalizeHeadline` 只被「去重」那条间接
 * 测到）。它们都是纯逻辑、边界明确、且出错时用户直接吃亏，所以补上。
 */

describe("assertFetchableUrl：能抓取的链接", () => {
  it("接受 https 链接", () => {
    expect(assertFetchableUrl("https://example.test/post").protocol).toBe("https:");
  });

  it("接受 http 但只限本机地址", () => {
    expect(assertFetchableUrl("http://localhost:8080/x").hostname).toBe("localhost");
    expect(assertFetchableUrl("http://127.0.0.1:3000/x").hostname).toBe("127.0.0.1");
    expect(assertFetchableUrl("http://[::1]:8080/x").hostname).toBe("[::1]");
    expect(assertFetchableUrl("http://[0:0:0:0:0:0:0:1]:8080/x").hostname).toBe("[::1]");
  });

  it("拒绝非本机的 http 链接（防止把内网请求打出去）", () => {
    expect(() => assertFetchableUrl("http://example.test/x")).toThrow(/只有本机地址/);
    expect(() => assertFetchableUrl("http://[2001:db8::1]/x")).toThrow(/只有本机地址/);
    expect(() => assertFetchableUrl("http://[::]/x")).toThrow(/只有本机地址/);
  });

  it("拒绝带账号密码的链接", () => {
    expect(() => assertFetchableUrl("https://user:pass@example.test/")).toThrow(/账号密码/);
  });

  it("拒绝非 http(s) 协议", () => {
    expect(() => assertFetchableUrl("file:///etc/passwd")).toThrow(/只接受/);
    expect(() => assertFetchableUrl("javascript:alert(1)")).toThrow(/只接受/);
  });

  it("非法 URL 报明确错误而不是抛原始异常", () => {
    expect(() => assertFetchableUrl("不是链接")).toThrow();
  });

  it("首尾空格不影响判断", () => {
    expect(assertFetchableUrl("  https://example.test/x  ").hostname).toBe("example.test");
  });
});

describe("completionURL：拼出可用的 API 地址", () => {
  it("裸域名补成 /v1/chat/completions", () => {
    expect(completionURL("https://api.example.test")).toBe(
      "https://api.example.test/v1/chat/completions",
    );
  });

  it("已有 /v1 时不重复补", () => {
    expect(completionURL("https://api.example.test/v1")).toBe(
      "https://api.example.test/v1/chat/completions",
    );
  });

  it("已以 /chat/completions 结尾时原样保留", () => {
    expect(completionURL("https://api.example.test/v1/chat/completions")).toBe(
      "https://api.example.test/v1/chat/completions",
    );
  });

  it("尾部多余的斜杠不该拼出双斜杠", () => {
    expect(completionURL("https://api.example.test/v1/")).toBe(
      "https://api.example.test/v1/chat/completions",
    );
  });

  it("查询串与片段被去掉（不该带进请求地址）", () => {
    expect(completionURL("https://api.example.test/v1?key=abc#frag")).toBe(
      "https://api.example.test/v1/chat/completions",
    );
  });

  it("非 http(s) 地址给出中文错误", () => {
    expect(() => completionURL("ftp://api.example.test")).toThrow(/HTTP\(S\)/);
  });
});

describe("requiresKey：本地地址不需要 API 密钥", () => {
  it("公网地址需要密钥", () => {
    expect(requiresKey("https://api.example.test/v1")).toBe(true);
    expect(requiresKey("http://[2001:db8::1]:1234/v1")).toBe(true);
    expect(requiresKey("http://[::]:1234/v1")).toBe(true);
  });

  it("本机地址不需要密钥", () => {
    expect(requiresKey("http://localhost:1234/v1")).toBe(false);
    expect(requiresKey("http://127.0.0.1:1234/v1")).toBe(false);
    expect(requiresKey("http://[::1]:1234/v1")).toBe(false);
    expect(requiresKey("http://[0:0:0:0:0:0:0:1]:1234/v1")).toBe(false);
  });
});

describe("transformPrompt：给模型的提示词", () => {
  it("短文不出现长文切片提示", () => {
    expect(transformPrompt("短笔记")).not.toContain("长文智能切片提示");
  });

  it("超过 3000 字的原文要求切片成 3-5 张", () => {
    expect(transformPrompt("长".repeat(3001))).toContain("长文智能切片提示");
  });

  it("恰好 3000 字不算长文", () => {
    expect(transformPrompt("长".repeat(3000))).not.toContain("长文智能切片提示");
  });

  it("始终要求只输出 JSON 数组", () => {
    expect(transformPrompt("任意内容")).toContain("JSON");
  });
});
