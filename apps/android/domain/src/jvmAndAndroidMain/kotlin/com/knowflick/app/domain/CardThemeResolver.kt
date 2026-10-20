package com.knowflick.app.domain

import java.util.concurrent.ConcurrentHashMap

/**
 * 卡片视觉主题解析器（权威实现移植自 macOS `apps/mac/Sources/KnowFlickCore/Theme/CardThemeResolver.swift`）。
 *
 * 1. 42 张专属摄影底图，划分四大领域多图池：计算机与 AI（15）、自然与宇宙科学（15）、
 *    人文心智与社会哲学（10）、商业财会金融（8）——即使「中级会计」「AI Agent」等单分类内刷卡也张张不同；
 * 2. 分类池之上再做细化语义关键词匹配（AI Agent、网络协议、数据库、量子、相对论、航天、地质、海洋、音乐、哲学等）；
 * 3. 兜底为 42 键确定性哈希（FNV-1a），不使用运行时随机种子；
 * 4. 单卡键缓存：排布算法的候选扫描是 O(n²) 次取键，缓存保证每张卡的关键词匹配只做一次。
 *
 * [allKeys] 与 `shared/assets/bg/<key>.webp` **严格一一对应**（共 42 个文件），
 * 由 `CardThemeResolverTest` 的资产护栏测试守住；池长度不再以字面量 42 硬编码。
 */
object CardThemeResolver {

    /** 42 种视觉底图的全部键（= `shared/assets/bg/` 的文件名集合） */
    val allKeys: List<String> = listOf(
        "physics", "biology", "astronomy", "math", "chemistry", "history", "psychology",
        "neuroscience", "language", "tech", "life", "geography", "ai", "algorithm",
        "datastructure", "architecture", "rust", "python", "coding", "accounting", "study",
        "quantum", "relativity", "optics", "ocean", "meteorology", "geology", "spacecraft",
        "genetics", "ecology", "robotics", "security", "crypto", "database", "network",
        "compiler", "economy", "philosophy", "sociology", "music", "cognitive", "agent",
    )

    /** 计算机与 AI 领域池（15 张不同摄影底图） */
    val techPool: List<String> = listOf(
        "ai", "agent", "algorithm", "datastructure", "architecture", "coding", "tech",
        "python", "rust", "compiler", "database", "network", "security", "crypto", "robotics",
    )

    /** 商业、财会与数理金融领域池（8 张不同摄影底图） */
    val financePool: List<String> = listOf(
        "accounting", "economy", "crypto", "math", "architecture", "tech", "history", "study",
    )

    /** 自然与宇宙科学领域池（15 张不同摄影底图） */
    val sciencePool: List<String> = listOf(
        "physics", "quantum", "relativity", "optics", "biology", "genetics", "ecology",
        "astronomy", "spacecraft", "chemistry", "geography", "geology", "meteorology", "ocean", "math",
    )

    /** 人文、心智与社会哲学领域池（10 张不同摄影底图） */
    val humanitiesPool: List<String> = listOf(
        "history", "philosophy", "sociology", "psychology", "cognitive", "neuroscience",
        "language", "music", "life", "study",
    )

    // ---------- 单卡键缓存 ----------

    private class CachedKey(
        val category: String,
        val headline: String,
        val summary: String,
        val key: String,
    )

    // 键为卡片 id；值同时记录参与解析的三个字段，字段变更（内容被替换）时自动失效。
    private val keyCache = ConcurrentHashMap<String, CachedKey>()

    /** 解析单卡主题键（带缓存；arrange 的高频调用不会重复做关键词匹配） */
    fun forCard(card: KnowledgeCard): String {
        val cached = keyCache[card.id]
        if (cached != null && cached.category == card.category &&
            cached.headline == card.headline && cached.summary == card.summary
        ) {
            return cached.key
        }
        val key = resolveKey(card.category, card.headline, card.summary)
        keyCache[card.id] = CachedKey(card.category, card.headline, card.summary, key)
        return key
    }

    /** 按当前卡库裁剪缓存（全量重排后调用），避免已删除卡片的条目永久驻留 */
    fun pruneKeyCache(keeping: Set<String>) {
        keyCache.keys.retainAll(keeping)
    }

    /** 清空缓存（测试用） */
    internal fun clearCache() {
        keyCache.clear()
    }

    /**
     * 单卡主题键解析：优先领域池关键词，其次分类池哈希，兜底全库哈希。
     * 顺序与关键词表与 macOS 端逐条对齐，跨端同一张卡得到同一张底图。
     */
    fun resolveKey(category: String, headline: String, summary: String = ""): String {
        val content = (headline + " " + summary).lowercase()
        val cat = category.lowercase()

        // 1. 商业财会与投资金融领域
        if (category.contains("会计") || category.contains("财务")) {
            if (containsAny(content, listOf("算法", "fifo", "先进先出", "加权", "计价"))) return "algorithm"
            if (containsAny(content, listOf("等式", "平衡", "折旧", "试算", "借贷必相等", "计算"))) return "math"
            if (containsAny(content, listOf("负债表", "结构", "骨架", "框架", "准则"))) return "architecture"
            if (containsAny(content, listOf("历史", "古代", "威尼斯", "世界观", "起源"))) return "history"
            if (containsAny(content, listOf("增值税", "现金流", "发票", "系统", "现代金融", "宏观"))) return "economy"
            if (containsAny(content, listOf("准则", "成绩单", "学习", "复习", "快照"))) return "study"
            return financePool[hashIndex(headline, financePool.size)]
        }

        if (category.contains("理财") || category.contains("投资") || category.contains("经济")) {
            if (containsAny(content, listOf("骗局", "承诺", "风险与收益", "贪婪", "情绪", "心理", "偏见", "损失厌恶"))) return "psychology"
            if (containsAny(content, listOf("债券", "国债", "固定利息", "凭证", "借据"))) return "accounting"
            if (containsAny(content, listOf("通货膨胀", "缩水", "货币", "宏观", "大萧条", "周期", "流动性", "利率"))) return "economy"
            if (containsAny(content, listOf("金字塔", "资产配置", "体系", "支柱", "组合", "分散"))) return "architecture"
            if (containsAny(content, listOf("复利", "年化", "收益率", "市盈率", "概率", "统计"))) return "math"
            if (containsAny(content, listOf("加密", "区块链", "比特币", "数字货币", "去中心化", "代币"))) return "crypto"
            if (containsAny(content, listOf("三要素", "掌控", "时间是它", "习惯", "自律"))) return "study"
            if (containsAny(content, listOf("定投", "交易", "散户"))) return "psychology"
            return financePool[hashIndex(headline, financePool.size)]
        }

        // 2. AI、AI Agent、编程与软件工程
        if (cat.contains("agent") || content.contains("智能体")) {
            if (containsAny(content, listOf("多智能体", "协作", "协调", "群体", "机械臂", "自主"))) return "robotics"
            if (containsAny(content, listOf("安全", "护栏", "边界", "闸门", "红线", "越狱"))) return "security"
            if (containsAny(content, listOf("记忆", "检索", "上下文", "向量数据库", "知识库"))) return "database"
            if (containsAny(content, listOf("工具", "function calling", "代码", "执行", "命令行"))) return "coding"
            return "agent"
        }

        if (cat.contains("ai") || category.contains("开发") || category.contains("编程") || category.contains("算法")) {
            if (containsAny(
                    content,
                    listOf("余弦", "几何", "坐标", "向量", "距离", "标尺", "空间", "概率", "确定性", "temperature",
                        "准确率", "召回率", "精确率", "矩阵"),
                )
            ) {
                return "math"
            }
            if (containsAny(content, listOf("流式", "边生成边显示", "网络", "协议", "传输", "http", "连接", "socket", "sse"))) return "network"
            if (containsAny(content, listOf("测试", "回归测试", "护栏", "边界", "安全", "漏洞", "注入", "生命周期"))) return "security"
            if (containsAny(content, listOf("编译", "语法", "词法", "ast", "llvm", "解析器", "字节码", "解释器"))) return "compiler"
            if (containsAny(content, listOf("微调还是提示", "微调", "架构", "微服务", "协作", "本质", "系统", "循环", "策略", "管理"))) return "architecture"
            if (containsAny(content, listOf("function calling", "函数", "调函数", "代码", "工具", "幂等", "接口", "调试", "git", "commit", "token", "计费", "bug"))) return "coding"
            if (containsAny(content, listOf("幻觉", "讨好", "喜欢", "胡说八道", "反馈", "rlhf", "思考", "react", "认知", "偏见", "心理", "反思"))) return "cognitive"
            if (containsAny(content, listOf("rag", "上下文", "检索", "窗口", "知识库", "数据库", "向量数据库", "索引", "二叉树", "链表", "哈希", "快照"))) return "database"
            if (containsAny(content, listOf("人话", "说人话", "语义", "词序"))) return "language"
            if (containsAny(content, listOf("人在回路", "人类", "生活"))) return "life"
            if (containsAny(content, listOf("python", "pip", "asyncio", "gil"))) return "python"
            if (containsAny(content, listOf("rust", "所有权", "借用", "生命周期", "并发"))) return "rust"
            if (containsAny(content, listOf("transformer", "位置编码", "反向传播", "权重", "算法", "注意力", "规划", "步骤", "复杂度", "排序"))) return "algorithm"
            return techPool[hashIndex(headline, techPool.size)]
        }

        // 3. 广域科学、工程与人文多维细化匹配（冷知识等综合大分类）
        // (1) 现代前沿与物理宇宙
        if (containsAny(content, listOf("量子", "纠缠", "叠加", "薛定谔", "自旋", "波粒", "隧穿", "量子力学"))) return "quantum"
        if (containsAny(content, listOf("相对论", "时空", "引力波", "光速不变", "黑洞蒸发", "膨胀", "gps", "双生子", "爱因斯坦"))) return "relativity"
        // 具体学科优先于摘要里的偶然词（如「光」）
        if (containsAny(content, listOf("天文", "宇宙", "星球", "光年", "黑洞", "太阳", "行星", "火星", "月球", "地球自转", "银河", "星系", "恒星", "轨道", "历法", "日食", "月食"))) return "astronomy"
        if (containsAny(content, listOf("光学", "光线", "折射", "反射", "透镜", "彩虹", "棱镜", "光谱", "激光", "干涉", "偏振"))) return "optics"
        if (containsAny(content, listOf("太空", "火箭", "飞船", "航天", "空间站", "探测器", "登月", "阿波罗", "人造卫星", "卫星", "宇航员", "发射"))) return "spacecraft"
        // (2) 地球与生态自然
        if (containsAny(content, listOf("海洋", "鲸", "鲨鱼", "深海", "珊瑚", "海啸", "海底", "水下", "潮汐", "马里亚纳", "海沟", "盐度"))) return "ocean"
        if (containsAny(content, listOf("天气", "暴雨", "台风", "气压", "雷电", "降水", "气象", "云", "风", "季风", "大气", "霜", "雪", "冰雹"))) return "meteorology"
        if (containsAny(content, listOf("地质", "地震", "火山", "化石", "岩石", "矿物", "地壳", "板块", "断层", "恐龙灭绝", "沉积"))) return "geology"
        if (containsAny(content, listOf("生态", "物种", "食物链", "生物多样性", "栖息地", "森林", "共生", "自然保护", "寄生"))) return "ecology"
        if (containsAny(content, listOf("基因", "dna", "rna", "遗传", "突变", "双螺旋", "染色体", "密码子", "孟德尔"))) return "genetics"
        // (3) 人文思辨与心智艺术
        if (containsAny(content, listOf("音乐", "声音", "共振", "乐器", "音调", "声波", "频率", "旋律", "听觉", "音符", "节奏"))) return "music"
        if (containsAny(content, listOf("哲学", "伦理", "苏格拉底", "存在", "认识论", "形而上", "理性", "启蒙", "逻辑", "道德"))) return "philosophy"
        if (containsAny(content, listOf("社会", "群体", "从众", "阶层", "习俗", "家庭", "制度", "文化", "人类学", "分工"))) return "sociology"
        if (containsAny(content, listOf("认知", "错觉", "直觉", "理性与感性", "心智", "意识", "沉浸", "注意力", "心理模型"))) return "cognitive"
        // (4) 经典学科
        if (containsAny(content, listOf("物理", "热力学", "牛顿", "引力", "温度", "冰箱", "能量", "声速", "气压", "电磁", "摩擦", "力学", "浮力", "辐射", "波动", "绝对零度"))) return "physics"
        if (containsAny(content, listOf("化学", "分子", "元素", "原子", "反应", "氧化", "酸", "盐", "晶体", "溶解", "燃烧", "结冰", "水分子", "金属", "催化", "溶液", "挥发", "周期表", "笑气", "麻醉"))) return "chemistry"
        if (containsAny(content, listOf("生物", "动物", "植物", "细胞", "细菌", "物种", "进化", "鸟", "鱼", "昆虫", "猫", "狗", "浆果", "树木", "肌肉", "器官", "骨骼", "血液", "叶绿素", "毒素", "睡眠", "心脏", "母鸡", "鸡蛋", "恐龙", "真菌"))) return "biology"
        if (containsAny(content, listOf("历史", "古代", "世纪", "朝代", "罗马", "埃及", "文明", "皇帝", "战争", "遗迹", "金字塔", "考古", "货币", "丝绸", "帝国", "文物", "封建", "中世纪"))) return "history"
        if (containsAny(content, listOf("脑", "神经", "多巴胺", "记忆", "突触", "大脑", "神经元", "脑电波", "海马体", "大脑皮层", "智商", "痛觉", "味觉", "神经系统"))) return "neuroscience"
        if (containsAny(content, listOf("心理", "情绪", "焦虑", "梦", "哈欠", "安慰剂", "抑郁", "直觉", "催眠", "依赖", "损失厌恶"))) return "psychology"
        if (containsAny(content, listOf("语言", "字", "词", "翻译", "文字", "发音", "词源", "语法", "汉字", "英语", "方言", "拼音", "象形", "修辞", "键盘", "qwerty"))) return "language"
        if (containsAny(content, listOf("数学", "几何", "概率", "拓扑", "素数", "方程", "微积分", "统计", "圆周率", "悖论", "斐波那契", "维度", "证明"))) return "math"
        if (containsAny(content, listOf("地理", "山脉", "河流", "沙漠", "极光", "经纬度", "冰川"))) return "geography"
        if (containsAny(content, listOf("生活", "微波炉", "咖啡", "食物", "保鲜", "烹饪", "茶", "蔬菜", "调料", "保温", "牛奶", "面包"))) return "life"
        if (containsAny(content, listOf("学习", "遗忘", "笔记", "复习", "记忆曲线", "费曼", "卡片盒", "间隔重复", "刻意练习", "深度工作", "习惯"))) return "study"

        // 4. 全库哈希兜底（标题为空时退回分类名，保证仍能得到确定值）
        val targetText = headline.ifEmpty { category }
        return allKeys[hashIndex(targetText, allKeys.size)]
    }

    /**
     * 确定性哈希取模：与 macOS `Int(deterministicHash(text) % UInt64(pool.count))` 口径一致 ——
     * FNV-1a 的 64 位结果按**无符号**语义落桶。Kotlin 的 `%` 对负数会给出负余数，
     * 直接 `(x % n + n) % n` 与无符号取模并不等价（2^64 不是 n 的倍数），
     * 因此用 [java.lang.Long.remainderUnsigned] 实现，保证两端同一张卡落到同一张底图。
     * 池长度取 list 的 size，不再写字面量。
     */
    private fun hashIndex(text: String, poolSize: Int): Int {
        require(poolSize > 0) { "主题图池不能为空" }
        return java.lang.Long.remainderUnsigned(CardArrange.deterministicHash(text), poolSize.toLong()).toInt()
    }

    private fun containsAny(text: String, keywords: List<String>): Boolean {
        for (keyword in keywords) {
            if (text.contains(keyword)) return true
        }
        return false
    }
}
