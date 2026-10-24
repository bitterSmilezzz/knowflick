import { afterEach, describe, expect, it, vi } from "vitest";
import { askModel, probeConnection } from "./aiChat";
import { defaultSettings } from "./settings";

// Exercise the real key guard, endpoint construction and browser request path.
// Only the network response is replaced; completeChat is not mocked.
afterEach(() => vi.unstubAllGlobals());

describe("IPv6 本地模型连接", () => {
  it("空密钥能测试连接并提炼出卡，公网仍在请求前拒绝空密钥", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "OK" } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const settings = { ...defaultSettings, baseURL: "http://[::1]:11434/v1", model: "local-model" };

    await probeConnection(settings, "");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [endpoint, options] = fetch.mock.calls[0];
    expect(endpoint).toBe("http://[::1]:11434/v1/chat/completions");
    expect(options.headers).not.toHaveProperty("Authorization");
    expect(JSON.parse(options.body)).toMatchObject({ model: "local-model", max_tokens: 16 });

    const details = "本地模型运行于用户设备，IPv6 回环请求不需要公网服务密钥。".repeat(5);
    fetch.mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify([
        { category: "计算机", headline: "本地模型连接", summary: "回环连接", details },
      ]) } }],
    }), { status: 200 }));
    const cards = await askModel("提炼本地模型使用笔记", settings, "");
    expect(cards).toHaveLength(1);
    expect(cards[0].headline).toBe("本地模型连接");
    expect(cards[0].details).toBe(details);
    expect(fetch).toHaveBeenCalledTimes(2);

    await expect(probeConnection({ ...settings, baseURL: "https://api.example.test/v1" }, ""))
      .rejects.toThrow("未配置 API Key");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
