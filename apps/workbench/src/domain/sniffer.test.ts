import { describe, expect, it } from "vitest";
import {
  identifyPlatform,
  parseGitHubRepo,
  parseBilibiliBvid,
  formatGitHubPayload,
  formatBilibiliPayload,
} from "./sniffer";

describe("多平台链接智能嗅探测试", () => {
  it("识别不同平台的 URL 域名", () => {
    expect(identifyPlatform("https://github.com/volcengine/OpenViking")).toBe("github");
    expect(identifyPlatform("https://www.bilibili.com/video/BV1xx411c7mD")).toBe("bilibili");
    expect(identifyPlatform("https://mp.weixin.qq.com/s/sample-article")).toBe("generic");
    expect(identifyPlatform("https://v2ex.com/t/123456")).toBe("generic");
  });

  it("正确解析 GitHub 仓库与作者", () => {
    const res = parseGitHubRepo("https://github.com/torvalds/linux");
    expect(res).toEqual({ owner: "torvalds", repo: "linux" });

    const resTrailing = parseGitHubRepo("https://github.com/facebook/react/");
    expect(resTrailing).toEqual({ owner: "facebook", repo: "react" });

    const invalid = parseGitHubRepo("https://github.com/");
    expect(invalid).toBeNull();
  });

  it("正确提取 Bilibili BV号", () => {
    const bvid = parseBilibiliBvid("https://www.bilibili.com/video/BV1xx411c7mD?spm_id_from=333.337");
    expect(bvid).toBe("BV1xx411c7mD");

    const noBvid = parseBilibiliBvid("https://www.bilibili.com/read/cv12345");
    expect(noBvid).toBeNull();
  });

  it("格式化 GitHub API 数据生成知识卡素材", () => {
    const payload = formatGitHubPayload(
      "https://github.com/astral-sh/uv",
      {
        name: "uv",
        description: "An extremely fast Python package and project manager, written in Rust.",
        stargazers_count: 35000,
        language: "Rust",
        html_url: "https://github.com/astral-sh/uv",
        owner: { login: "astral-sh" },
      },
      "Fast Python package manager."
    );

    expect(payload.platform).toBe("github");
    expect(payload.title).toContain("astral-sh/uv");
    expect(payload.title).toContain("★35000");
    expect(payload.tags).toContain("Rust");
    expect(payload.tags).toContain("开源项目");
    expect(payload.content).toContain("README 节选");
  });

  it("格式化 Bilibili API 数据生成知识卡素材", () => {
    const payload = formatBilibiliPayload("https://www.bilibili.com/video/BV123456", {
      title: "深入浅出大模型架构设计",
      desc: "本期视频全面讲解 Transformer 和 MoE 的架构演进...",
      owner: { name: "技术老友" },
      bvid: "BV123456",
    });

    expect(payload.platform).toBe("bilibili");
    expect(payload.title).toBe("B站: 深入浅出大模型架构设计");
    expect(payload.author).toBe("技术老友");
    expect(payload.tags).toContain("B站");
  });
});
