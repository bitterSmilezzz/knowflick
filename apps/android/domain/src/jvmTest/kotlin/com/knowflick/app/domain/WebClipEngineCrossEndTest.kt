package com.knowflick.app.domain

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 剪藏抽取的**行为**跨端一致性（Kotlin 侧）。
 *
 * `tools/check_clip_parity.py` 比的是规则表（token 表、阈值、字符集窗口）——**表一致不等于行为一致**：
 * 候选块怎么挑、节点按什么顺序丢、行怎么折，流程上仍可能分叉。这里用同一份 HTML 直接比**抽出来的正文**。
 *
 * 期望值取自 workbench 侧同一份输入的实际输出（`apps/workbench/src/domain/clipEngine.ts` 的 `digest`）。
 * 对端：`apps/workbench/src/domain/clipEngine.crossend.test.ts`。
 */
class WebClipEngineCrossEndTest {

    private val html = """<html><head><title>量子计算入门 - 某站</title><meta name="description" content="量子比特与叠加态的介绍"></head><body><nav>首页 分类 关于我们 登录 注册</nav><header>某站科技频道</header><article><h1>量子计算入门</h1><p>量子比特是量子计算的基本单位，它与经典比特不同，可以同时处于 0 与 1 的叠加态。</p><p>这种叠加态使得量子计算机在某些问题上具有指数级的加速潜力。</p><p>然而量子退相干是工程上的主要障碍，需要在极低温下运行。</p><footer>扫码关注我们</footer></article><div class="comment">评论区：说得很好</div><footer>版权所有 © 2025 某站</footer></body></html>"""

    @Test
    fun articleBodyIsExtractedIdenticallyOnBothSides() {
        val digest = WebClipEngine.digest(html, "https://example.com/a") ?: error("应能抽到正文")

        assertEquals("量子计算入门 - 某站", digest.title)
        assertEquals("example.com", digest.siteName)
        assertEquals("量子比特与叠加态的介绍", digest.description)
        assertEquals(false, digest.truncated)
        assertEquals(
            "量子计算入门\n" +
                "量子比特是量子计算的基本单位，它与经典比特不同，可以同时处于 0 与 1 的叠加态。\n" +
                "这种叠加态使得量子计算机在某些问题上具有指数级的加速潜力。\n" +
                "然而量子退相干是工程上的主要障碍，需要在极低温下运行。",
            digest.text,
        )
    }
}
