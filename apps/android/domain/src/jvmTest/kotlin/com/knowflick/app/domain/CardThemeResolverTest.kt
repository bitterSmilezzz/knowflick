package com.knowflick.app.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 主题解析器契约测试：领域多图池结构、池内/关键词细分、哈希兜底确定性。
 *
 * 背景：0.8.5 及以前的 Android 端把「分类 → 单张底图」的别名表当作全部逻辑，
 * 冷知识 160 张卡全部落在 `study` 一张图上（实测 214 张种子卡只有 6 种 key），
 * 而排布算法用的是另一套 `bg0..bg41` key 空间，防重排布对真实底图完全失效。
 * 这些测试锁定修复后的两条不变量：池结构完整 + 单分类内高度分散。
 */
class CardThemeResolverTest {

    private fun card(headline: String, category: String = "冷知识", summary: String = "") =
        KnowledgeCard.create(category, headline, summary, "正文", source = CardSource.SEED)

    // ---------- 池结构 ----------

    @Test
    fun allKeysHasNoDuplicateAndPoolsAreSubsetsOfIt() {
        assertEquals(42, CardThemeResolver.allKeys.size)
        assertEquals(CardThemeResolver.allKeys.size, CardThemeResolver.allKeys.toSet().size, "42 键不得重复")

        val pools = mapOf(
            "techPool" to CardThemeResolver.techPool,
            "sciencePool" to CardThemeResolver.sciencePool,
            "humanitiesPool" to CardThemeResolver.humanitiesPool,
            "financePool" to CardThemeResolver.financePool,
        )
        for ((name, pool) in pools) {
            assertEquals(pool.size, pool.toSet().size, "$name 内部不得重复")
            assertTrue(CardThemeResolver.allKeys.containsAll(pool), "$name 必须是 42 键的子集")
        }

        // 领域池声明的容量：计算机与 AI 15 / 自然宇宙科学 15 / 人文心智 10 / 商业财会金融 8
        assertEquals(15, CardThemeResolver.techPool.size)
        assertEquals(15, CardThemeResolver.sciencePool.size)
        assertEquals(10, CardThemeResolver.humanitiesPool.size)
        assertEquals(8, CardThemeResolver.financePool.size)
    }

    @Test
    fun poolUnionPlusSharedKeysCoversEveryKey() {
        val union = (
            CardThemeResolver.techPool +
                CardThemeResolver.sciencePool +
                CardThemeResolver.humanitiesPool +
                CardThemeResolver.financePool
            ).toSet()
        // 四个领域池允许共用「跨领域」底图（math/history/study 等），但不得把某个键排除在
        // 任何领域之外——否则那张图永远不会被语义路径选中，只能靠哈希兜底碰到。
        val uncovered = CardThemeResolver.allKeys.filterNot { it in union }
        assertEquals(
            emptyList(),
            uncovered,
            "以下 key 不属于任何领域池，语义路径永远选不到：$uncovered",
        )
    }

    // ---------- 分类 → 池 ----------

    @Test
    fun financeCategoriesFallBackToFinancePool() {
        // 标题不含任何关键词时，会计/理财分类落到各自的领域池哈希
        val accounting = CardThemeResolver.resolveKey("中级会计", "毫无关联的标题", "")
        assertTrue(accounting in CardThemeResolver.financePool, "中级会计应落在商业财会金融池，实际 $accounting")

        val investing = CardThemeResolver.resolveKey("投资理财", "毫无关联的标题", "")
        assertTrue(investing in CardThemeResolver.financePool, "投资理财应落在商业财会金融池，实际 $investing")
    }

    @Test
    fun techCategoriesFallBackToTechPool() {
        val ai = CardThemeResolver.resolveKey("AI", "毫无关联的标题", "")
        assertTrue(ai in CardThemeResolver.techPool, "AI 应落在计算机与 AI 池，实际 $ai")

        val dev = CardThemeResolver.resolveKey("AI 开发", "毫无关联的标题", "")
        assertTrue(dev in CardThemeResolver.techPool, "AI 开发应落在计算机与 AI 池，实际 $dev")

        // Agent 分支的兜底是固定的 agent 键（与 macOS 一致），而不是哈希
        assertEquals("agent", CardThemeResolver.resolveKey("AI Agent", "毫无关联的标题", ""))
    }

    // ---------- 关键词细分（覆盖单分类内张张不同的关键路径） ----------

    @Test
    fun financeKeywordRefinementsOverridePoolHash() {
        assertEquals("algorithm", CardThemeResolver.resolveKey("中级会计", "先进先出法（FIFO）", ""))
        assertEquals("math", CardThemeResolver.resolveKey("中级会计", "会计等式与借贷必相等", ""))
        assertEquals("architecture", CardThemeResolver.resolveKey("中级会计", "资产负债表的骨架", ""))
        assertEquals("history", CardThemeResolver.resolveKey("中级会计", "复式记账的威尼斯起源", ""))
        assertEquals("economy", CardThemeResolver.resolveKey("中级会计", "增值税与现金流", ""))
        assertEquals("study", CardThemeResolver.resolveKey("中级会计", "考试成绩单与复习", ""))

        assertEquals("psychology", CardThemeResolver.resolveKey("投资理财", "贪婪与损失厌恶", ""))
        assertEquals("accounting", CardThemeResolver.resolveKey("投资理财", "国债是固定利息的借据", ""))
        assertEquals("economy", CardThemeResolver.resolveKey("投资理财", "通货膨胀与利率周期", ""))
        assertEquals("math", CardThemeResolver.resolveKey("投资理财", "复利与年化收益率", ""))
        assertEquals("crypto", CardThemeResolver.resolveKey("投资理财", "区块链与比特币的去中心化", ""))
    }

    @Test
    fun agentAndTechKeywordRefinementsOverridePoolHash() {
        assertEquals("robotics", CardThemeResolver.resolveKey("AI Agent", "多智能体协作与机械臂", ""))
        assertEquals("security", CardThemeResolver.resolveKey("AI Agent", "智能体的安全护栏与越狱", ""))
        assertEquals("database", CardThemeResolver.resolveKey("AI Agent", "智能体的记忆与向量数据库检索", ""))
        assertEquals("coding", CardThemeResolver.resolveKey("AI Agent", "工具调用与命令行执行", ""))
        assertEquals("agent", CardThemeResolver.resolveKey("AI Agent", "智能体的第三种形态", ""))

        assertEquals("math", CardThemeResolver.resolveKey("AI 开发", "余弦距离与向量空间", ""))
        assertEquals("network", CardThemeResolver.resolveKey("AI 开发", "SSE 流式传输与 HTTP 协议", ""))
        assertEquals("security", CardThemeResolver.resolveKey("AI 开发", "回归测试与注入漏洞", ""))
        assertEquals("compiler", CardThemeResolver.resolveKey("AI 开发", "词法分析与字节码解释器", ""))
        assertEquals("python", CardThemeResolver.resolveKey("AI 开发", "Python 的 GIL 与 asyncio", ""))
        assertEquals("rust", CardThemeResolver.resolveKey("AI 开发", "Rust 的所有权与借用", ""))
    }

    @Test
    fun broadScienceAndHumanitiesRefinements() {
        assertEquals("quantum", CardThemeResolver.resolveKey("冷知识", "量子纠缠与叠加态", ""))
        assertEquals("relativity", CardThemeResolver.resolveKey("冷知识", "相对论与引力波", ""))
        assertEquals("astronomy", CardThemeResolver.resolveKey("冷知识", "太阳系行星与银河", ""))
        assertEquals("optics", CardThemeResolver.resolveKey("冷知识", "棱镜折射与光谱", ""))
        assertEquals("spacecraft", CardThemeResolver.resolveKey("冷知识", "阿波罗登月与空间站", ""))
        assertEquals("ocean", CardThemeResolver.resolveKey("冷知识", "马里亚纳海沟与深海珊瑚", ""))
        assertEquals("meteorology", CardThemeResolver.resolveKey("冷知识", "台风与大气压强", ""))
        assertEquals("geology", CardThemeResolver.resolveKey("冷知识", "地震与板块断层", ""))
        assertEquals("ecology", CardThemeResolver.resolveKey("冷知识", "食物链与生物多样性", ""))
        assertEquals("genetics", CardThemeResolver.resolveKey("冷知识", "DNA 双螺旋与密码子", ""))
        assertEquals("music", CardThemeResolver.resolveKey("冷知识", "乐器共鸣与声波频率", ""))
        assertEquals("philosophy", CardThemeResolver.resolveKey("冷知识", "苏格拉底的伦理之问", ""))
        assertEquals("sociology", CardThemeResolver.resolveKey("冷知识", "从众心理与社会分工", ""))
        assertEquals("cognitive", CardThemeResolver.resolveKey("冷知识", "视错觉与心智模型", ""))
        assertEquals("physics", CardThemeResolver.resolveKey("冷知识", "热力学与绝对零度", ""))
        assertEquals("chemistry", CardThemeResolver.resolveKey("冷知识", "催化剂与溶液挥发", ""))
        assertEquals("biology", CardThemeResolver.resolveKey("冷知识", "叶绿素与真菌进化", ""))
        assertEquals("history", CardThemeResolver.resolveKey("冷知识", "罗马帝国的中世纪遗迹", ""))
        assertEquals("neuroscience", CardThemeResolver.resolveKey("冷知识", "多巴胺与海马体", ""))
        assertEquals("psychology", CardThemeResolver.resolveKey("冷知识", "安慰剂效应与焦虑", ""))
        assertEquals("language", CardThemeResolver.resolveKey("冷知识", "象形文字与词源", ""))
        assertEquals("math", CardThemeResolver.resolveKey("冷知识", "斐波那契与素数", ""))
        assertEquals("geography", CardThemeResolver.resolveKey("冷知识", "极光与冰川山脉", ""))
        assertEquals("life", CardThemeResolver.resolveKey("冷知识", "微波炉与咖啡保鲜", ""))
        assertEquals("study", CardThemeResolver.resolveKey("冷知识", "间隔重复与费曼笔记", ""))
    }

    @Test
    fun subjectKeywordsTakePriorityOverIncidentalWordsInSummary() {
        // 摘要里出现「生活」等宽泛词时，标题的具体学科必须优先（与 macOS 端注释同口径）
        assertEquals(
            "astronomy",
            CardThemeResolver.resolveKey("冷知识", "月球潮汐锁定", "这是日常生活中的常见现象"),
        )
    }

    // ---------- 哈希兜底 ----------

    @Test
    fun hashFallbackIsDeterministicAndCacheConsistent() {
        val a = CardThemeResolver.resolveKey("冷知识", "完全无法归类的标题甲", "")
        val b = CardThemeResolver.resolveKey("冷知识", "完全无法归类的标题甲", "")
        assertEquals(a, b, "相同输入必须得到相同 key（FNV-1a，无随机会话种子）")
        assertTrue(a in CardThemeResolver.allKeys)

        // 空标题退回分类名，仍必须是合法 key（不得越界/抛异常）
        val emptyHeadline = CardThemeResolver.resolveKey("冷知识", "", "")
        assertTrue(emptyHeadline in CardThemeResolver.allKeys)

        // forCard 走缓存，结果必须与直算一致；同卡重复取键也必须稳定
        val subject = card("完全无法归类的标题甲")
        assertEquals(a, CardThemeResolver.forCard(subject))
        assertEquals(a, CardThemeResolver.forCard(subject))
    }

    @Test
    fun cacheInvalidatesWhenCardContentChanges() {
        val original = card("完全无法归类的标题甲")
        val first = CardThemeResolver.forCard(original)
        // 同一 id 但内容变了（编辑卡片）：缓存必须失效并重新解析
        val edited = original.copy(headline = "量子纠缠与叠加态")
        assertEquals("quantum", CardThemeResolver.forCard(edited))
        assertEquals(first, CardThemeResolver.forCard(original))
    }

    @Test
    fun unknownCategoryCardsSpreadAcrossThePoolInsteadOfOneFallbackKey() {
        // 「未知分类不撞已知分类」的口径：未知分类不得全部坍缩到同一个兜底 key
        //（旧实现正是「分类别名命中 → 单张图，未命中 → 另一套 bgN 空间」，两侧都不分散）
        CardThemeResolver.clearCache()
        val keys = (1..200).map { index ->
            CardThemeResolver.forCard(card("未知分类样本 $index"))
        }
        assertTrue(keys.all { it in CardThemeResolver.allKeys })
        val distinct = keys.toSet().size
        assertTrue(distinct >= 30, "200 张未知分类卡应散布到整个 42 键池，实际只有 $distinct 种")
    }

    @Test
    fun sameCategoryCardsGetManyDifferentKeys() {
        CardThemeResolver.clearCache()
        // 同一分类内「张张不同」：用分散的合成标题覆盖 42 键池
        val keys = (1..160).map { index -> CardThemeResolver.forCard(card("冷知识条目 $index")) }
        val distinct = keys.toSet().size
        assertTrue(distinct >= 25, "单分类内 160 张卡至少应映射到 25 种 key，实际 $distinct 种")
    }
}
