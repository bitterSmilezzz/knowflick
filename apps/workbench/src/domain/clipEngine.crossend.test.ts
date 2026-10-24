import { describe, expect, it } from "vitest";
import { digest } from "./clipEngine";

/**
 * 剪藏抽取的**行为**跨端一致性（workbench 侧）。
 *
 * `tools/check_clip_parity.py` 比的是规则表（token 表、阈值、字符集窗口）——**表一致不等于行为一致**。
 * 这里用同一份 HTML 直接比抽出来的正文。
 *
 * 对端是 Kotlin：`apps/android/domain/src/jvmTest/.../WebClipEngineCrossEndTest.kt`——
 * 同一份输入、同一串期望。
 */
const html =
  '<html><head><title>量子计算入门 - 某站</title><meta name="description" content="量子比特与叠加态的介绍"></head><body><nav>首页 分类 关于我们 登录 注册</nav><header>某站科技频道</header><article><h1>量子计算入门</h1><p>量子比特是量子计算的基本单位，它与经典比特不同，可以同时处于 0 与 1 的叠加态。</p><p>这种叠加态使得量子计算机在某些问题上具有指数级的加速潜力。</p><p>然而量子退相干是工程上的主要障碍，需要在极低温下运行。</p><footer>扫码关注我们</footer></article><div class="comment">评论区：说得很好</div><footer>版权所有 © 2025 某站</footer></body></html>';

describe("剪藏抽取的跨端行为契约", () => {
  it("同一篇文章两端抽出的元信息与正文完全一致", () => {
    const d = digest(html, "https://example.com/a");
    expect(d).not.toBeNull();
    if (!d) return;

    expect(d.title).toBe("量子计算入门 - 某站");
    expect(d.siteName).toBe("example.com");
    expect(d.description).toBe("量子比特与叠加态的介绍");
    expect(d.truncated).toBe(false);
    expect(d.text).toBe(
      [
        "量子计算入门",
        "量子比特是量子计算的基本单位，它与经典比特不同，可以同时处于 0 与 1 的叠加态。",
        "这种叠加态使得量子计算机在某些问题上具有指数级的加速潜力。",
        "然而量子退相干是工程上的主要障碍，需要在极低温下运行。",
      ].join("\n"),
    );
  });

  it("导航、页眉、页脚与评论区都不进正文", () => {
    const d = digest(html, "https://example.com/a");
    expect(d?.text).not.toContain("首页");
    expect(d?.text).not.toContain("某站科技频道");
    expect(d?.text).not.toContain("扫码关注");
    expect(d?.text).not.toContain("评论区");
    expect(d?.text).not.toContain("版权所有");
  });
});
