import { describe, expect, it } from "vitest";
import { redactSecrets } from "./store";

/**
 * 服务端错误原文不能直接进界面。
 *
 * 邮箱侧早就定了原则：「错误不回显密钥——不把服务端原文透给界面」
 * （docs/EMAIL_INTEGRATION.md）。AI 侧此前把响应原文前 200 字符直接显示，
 * 而部分服务商在 401 里会回显 API key——界面上的密钥一旦被截图就泄露了。
 */
describe("错误原文里的凭据脱敏", () => {
  it("抹掉带常见前缀的 API key", () => {
    const text = "Incorrect API key provided: sk-proj-abc123DEF456ghi789. You can find your API key at ...";
    const out = redactSecrets(text);
    expect(out).not.toContain("sk-proj-abc123DEF456ghi789");
    expect(out).toContain("[已隐藏的密钥]");
  });

  it("抹掉 Bearer 后的整串", () => {
    const out = redactSecrets("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(out).toContain("已隐藏");
  });

  it("抹掉长随机串（多半是凭据）", () => {
    const out = redactSecrets("token=0123456789abcdef0123456789abcdef");
    expect(out).not.toContain("0123456789abcdef0123456789abcdef");
  });

  it("普通错误信息不受影响", () => {
    const text = "模型 120 秒没有响应，已中止。可以先检查网络或换一个更小的模型。";
    expect(redactSecrets(text)).toBe(text);
  });

  it("短词不该被误抹", () => {
    const text = "rate limit exceeded, retry later";
    expect(redactSecrets(text)).toBe(text);
  });

  it("错误消息这条路径上确实不泄露（不是只测工具函数）", async () => {
    // 上面测的是 redactSecrets 这个函数；这里测**真正会进界面的那条路径**：
    // completeChat 收到 401 时构造出的 Error 消息。
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ error: { message: "Incorrect API key provided: {{API_KEY_1uv3bev0}}." } }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;
    try {
      const { completeChat } = await import("./store");
      let message = "";
      try {
        await completeChat("https://api.example.test/v1/chat/completions", "sk-key", "{}");
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message, "应抛出带 401 的错误").toContain("401");
      expect(message, "不该回显密钥：" + message).not.toContain("{{API_KEY_1uv3bev0}}");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
