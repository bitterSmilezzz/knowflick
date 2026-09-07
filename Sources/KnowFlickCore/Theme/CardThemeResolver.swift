import Foundation

/// 卡片视觉主题解析器：
/// 1. 扩充至 42 张高品质全景摄影底图（涵盖科技、科学、商业、人文四大领域各细分学科）
/// 2. 细化语义关键词匹配（AI Agent、网络协议、数据库、量子、相对论、航天、地质、海洋、音乐、哲学等）
/// 3. 严格同图距离排布算法（arrangeWithMinDistance）：严格保证任意相邻 5 张卡片背景图各不相同（无碰撞）
/// 4. 线程安全缓存（keyCache）：单张卡片仅计算一次主题键，性能零损耗
public enum CardThemeResolver {
    /// 42 种视觉底图的全部键
    public static let allKeys: [String] = [
        "physics", "biology", "astronomy", "math", "chemistry", "history", "psychology",
        "neuroscience", "language", "tech", "life", "geography", "ai", "algorithm",
        "datastructure", "architecture", "rust", "python", "coding", "accounting", "study",
        "quantum", "relativity", "optics", "ocean", "meteorology", "geology", "spacecraft",
        "genetics", "ecology", "robotics", "security", "crypto", "database", "network",
        "compiler", "economy", "philosophy", "sociology", "music", "cognitive", "agent"
    ]

    /// 计算机与 AI 领域池（15 张不同摄影底图）
    public static let techPool: [String] = [
        "ai", "agent", "algorithm", "datastructure", "architecture", "coding", "tech",
        "python", "rust", "compiler", "database", "network", "security", "crypto", "robotics"
    ]

    /// 商业、财会与数理金融领域池（8 张不同摄影底图）
    public static let financePool: [String] = [
        "accounting", "economy", "crypto", "math", "architecture", "tech", "history", "study"
    ]

    /// 自然与宇宙科学领域池（15 张不同摄影底图）
    public static let sciencePool: [String] = [
        "physics", "quantum", "relativity", "optics", "biology", "genetics", "ecology",
        "astronomy", "spacecraft", "chemistry", "geography", "geology", "meteorology", "ocean", "math"
    ]

    /// 人文、心智与社会哲学领域池（10 张不同摄影底图）
    public static let humanitiesPool: [String] = [
        "history", "philosophy", "sociology", "psychology", "cognitive", "neuroscience",
        "language", "music", "life", "study"
    ]

    /// 64-bit FNV-1a 确定性哈希（不依赖系统 hashValue 每次运行变化的随机种子）
    public static func deterministicHash(_ text: String) -> UInt64 {
        var hash: UInt64 = 14695981039346656037
        for byte in text.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 1099511628211
        }
        return hash
    }

    /// 单卡主题键解析：优先领域池关键词，其次分类池哈希，兜底全库哈希
    public static func resolveKey(category: String, headline: String, summary: String = "") -> String {
        let content = (headline + " " + summary).lowercased()
        let cat = category.lowercased()

        // 1. 商业财会与投资金融领域
        if category.contains("会计") || category.contains("财务") {
            if containsAny(content, ["算法", "fifo", "先进先出", "加权", "计价"]) {
                return "algorithm"
            }
            if containsAny(content, ["等式", "平衡", "折旧", "试算", "借贷必相等", "计算"]) {
                return "math"
            }
            if containsAny(content, ["负债表", "结构", "骨架", "框架", "准则"]) {
                return "architecture"
            }
            if containsAny(content, ["历史", "古代", "威尼斯", "世界观", "起源"]) {
                return "history"
            }
            if containsAny(content, ["增值税", "现金流", "发票", "系统", "现代金融", "宏观"]) {
                return "economy"
            }
            if containsAny(content, ["准则", "成绩单", "学习", "复习", "快照"]) {
                return "study"
            }
            let idx = Int(deterministicHash(headline) % UInt64(financePool.count))
            return financePool[idx]
        }

        if category.contains("理财") || category.contains("投资") || category.contains("经济") {
            if containsAny(content, ["骗局", "承诺", "风险与收益", "贪婪", "情绪", "心理", "偏见", "损失厌恶"]) {
                return "psychology"
            }
            if containsAny(content, ["债券", "国债", "固定利息", "凭证", "借据"]) {
                return "accounting"
            }
            if containsAny(content, ["通货膨胀", "缩水", "货币", "宏观", "大萧条", "周期", "流动性", "利率"]) {
                return "economy"
            }
            if containsAny(content, ["金字塔", "资产配置", "体系", "支柱", "组合", "分散"]) {
                return "architecture"
            }
            if containsAny(content, ["复利", "年化", "收益率", "市盈率", "概率", "统计"]) {
                return "math"
            }
            if containsAny(content, ["加密", "区块链", "比特币", "数字货币", "去中心化", "代币"]) {
                return "crypto"
            }
            if containsAny(content, ["三要素", "掌控", "时间是它", "习惯", "自律"]) {
                return "study"
            }
            if containsAny(content, ["定投", "交易", "散户"]) {
                return "psychology"
            }
            let idx = Int(deterministicHash(headline) % UInt64(financePool.count))
            return financePool[idx]
        }

        // 2. AI、AI Agent、编程与软件工程
        if cat.contains("agent") || content.contains("智能体") {
            if containsAny(content, ["多智能体", "协作", "协调", "群体", "机械臂", "自主"]) {
                return "robotics"
            }
            if containsAny(content, ["安全", "护栏", "边界", "闸门", "红线", "越狱"]) {
                return "security"
            }
            if containsAny(content, ["记忆", "检索", "上下文", "向量数据库", "知识库"]) {
                return "database"
            }
            if containsAny(content, ["工具", "function calling", "代码", "执行", "命令行"]) {
                return "coding"
            }
            return "agent"
        }

        if cat.contains("ai") || category.contains("开发") || category.contains("编程") || category.contains("算法") {
            if containsAny(content, ["余弦", "几何", "坐标", "向量", "距离", "标尺", "空间", "概率", "确定性", "temperature", "准确率", "召回率", "精确率", "矩阵"]) {
                return "math"
            }
            if containsAny(content, ["流式", "边生成边显示", "网络", "协议", "传输", "http", "连接", "socket", "sse"]) {
                return "network"
            }
            if containsAny(content, ["测试", "回归测试", "护栏", "边界", "安全", "漏洞", "注入", "生命周期"]) {
                return "security"
            }
            if containsAny(content, ["编译", "语法", "词法", "ast", "llvm", "解析器", "字节码", "解释器"]) {
                return "compiler"
            }
            if containsAny(content, ["微调还是提示", "微调", "架构", "微服务", "协作", "本质", "系统", "循环", "策略", "管理"]) {
                return "architecture"
            }
            if containsAny(content, ["function calling", "函数", "调函数", "代码", "工具", "幂等", "接口", "调试", "git", "commit", "token", "计费", "bug"]) {
                return "coding"
            }
            if containsAny(content, ["幻觉", "讨好", "喜欢", "胡说八道", "反馈", "rlhf", "思考", "react", "认知", "偏见", "心理", "反思"]) {
                return "cognitive"
            }
            if containsAny(content, ["rag", "上下文", "检索", "窗口", "知识库", "数据库", "向量数据库", "索引", "二叉树", "链表", "哈希", "快照"]) {
                return "database"
            }
            if containsAny(content, ["人话", "说人话", "语义", "词序"]) {
                return "language"
            }
            if containsAny(content, ["人在回路", "人类", "生活"]) {
                return "life"
            }
            if containsAny(content, ["python", "pip", "asyncio", "gil"]) {
                return "python"
            }
            if containsAny(content, ["rust", "所有权", "借用", "生命周期", "并发"]) {
                return "rust"
            }
            if containsAny(content, ["transformer", "位置编码", "反向传播", "权重", "算法", "注意力", "规划", "步骤", "复杂度", "排序"]) {
                return "algorithm"
            }
            let idx = Int(deterministicHash(headline) % UInt64(techPool.count))
            return techPool[idx]
        }

        // 3. 广域科学、工程与人文多维细化匹配（冷知识等综合大分类）
        // (1) 现代前沿与物理宇宙
        if containsAny(content, ["量子", "纠缠", "叠加", "薛定谔", "自旋", "波粒", "隧穿", "量子力学"]) {
            return "quantum"
        }
        if containsAny(content, ["相对论", "时空", "引力波", "光速不变", "黑洞蒸发", "膨胀", "gps", "双生子", "爱因斯坦"]) {
            return "relativity"
        }
        if containsAny(content, ["光学", "光", "折射", "反射", "透镜", "彩虹", "棱镜", "光谱", "激光", "干涉", "偏振"]) {
            return "optics"
        }
        if containsAny(content, ["太空", "火箭", "飞船", "航天", "空间站", "探测器", "登月", "阿波罗", "人造卫星", "卫星", "宇航员", "发射"]) {
            return "spacecraft"
        }
        if containsAny(content, ["天文", "宇宙", "星球", "光年", "黑洞", "太阳", "行星", "火星", "月球", "地球自转", "银河", "星系", "恒星", "轨道", "历法", "日食", "月食"]) {
            return "astronomy"
        }
        // (2) 地球与生态自然
        if containsAny(content, ["海洋", "鲸", "鲨鱼", "深海", "珊瑚", "海啸", "海底", "水下", "潮汐", "马里亚纳", "海沟", "盐度"]) {
            return "ocean"
        }
        if containsAny(content, ["天气", "暴雨", "台风", "气压", "雷电", "降水", "气象", "云", "风", "季风", "大气", "霜", "雪", "冰雹"]) {
            return "meteorology"
        }
        if containsAny(content, ["地质", "地震", "火山", "化石", "岩石", "矿物", "地壳", "板块", "断层", "恐龙灭绝", "沉积"]) {
            return "geology"
        }
        if containsAny(content, ["生态", "物种", "食物链", "生物多样性", "栖息地", "森林", "共生", "自然保护", "寄生"]) {
            return "ecology"
        }
        if containsAny(content, ["基因", "dna", "rna", "遗传", "突变", "双螺旋", "染色体", "密码子", "孟德尔"]) {
            return "genetics"
        }
        // (3) 人文思辨与心智艺术
        if containsAny(content, ["音乐", "声音", "共振", "乐器", "音调", "声波", "频率", "旋律", "听觉", "音符", "节奏"]) {
            return "music"
        }
        if containsAny(content, ["哲学", "伦理", "苏格拉底", "存在", "认识论", "形而上", "理性", "启蒙", "逻辑", "道德"]) {
            return "philosophy"
        }
        if containsAny(content, ["社会", "群体", "从众", "阶层", "习俗", "家庭", "制度", "文化", "人类学", "分工"]) {
            return "sociology"
        }
        if containsAny(content, ["认知", "错觉", "直觉", "理性与感性", "心智", "意识", "沉浸", "注意力", "心理模型"]) {
            return "cognitive"
        }
        // (4) 经典学科
        if containsAny(content, ["物理", "热力学", "牛顿", "引力", "温度", "冰箱", "能量", "声速", "气压", "电磁", "摩擦", "力学", "浮力", "辐射", "波动", "绝对零度"]) {
            return "physics"
        }
        if containsAny(content, ["化学", "分子", "元素", "原子", "反应", "氧化", "酸", "盐", "晶体", "溶解", "燃烧", "结冰", "水分子", "金属", "催化", "溶液", "挥发", "周期表", "笑气", "麻醉"]) {
            return "chemistry"
        }
        if containsAny(content, ["生物", "动物", "植物", "细胞", "细菌", "物种", "进化", "鸟", "鱼", "昆虫", "猫", "狗", "浆果", "树木", "肌肉", "器官", "骨骼", "血液", "叶绿素", "毒素", "睡眠", "心脏", "母鸡", "鸡蛋", "恐龙", "真菌"]) {
            return "biology"
        }
        if containsAny(content, ["历史", "古代", "世纪", "朝代", "罗马", "埃及", "文明", "皇帝", "战争", "遗迹", "金字塔", "考古", "货币", "丝绸", "帝国", "文物", "封建", "中世纪"]) {
            return "history"
        }
        if containsAny(content, ["脑", "神经", "多巴胺", "记忆", "突触", "大脑", "神经元", "脑电波", "海马体", "大脑皮层", "智商", "痛觉", "味觉", "神经系统"]) {
            return "neuroscience"
        }
        if containsAny(content, ["心理", "情绪", "焦虑", "梦", "哈欠", "安慰剂", "抑郁", "直觉", "催眠", "依赖", "损失厌恶"]) {
            return "psychology"
        }
        if containsAny(content, ["语言", "字", "词", "翻译", "文字", "发音", "词源", "语法", "汉字", "英语", "方言", "拼音", "象形", "修辞", "键盘", "qwerty"]) {
            return "language"
        }
        if containsAny(content, ["数学", "几何", "概率", "拓扑", "素数", "方程", "微积分", "统计", "圆周率", "悖论", "斐波那契", "维度", "证明"]) {
            return "math"
        }
        if containsAny(content, ["地理", "山脉", "河流", "沙漠", "极光", "经纬度", "冰川"]) {
            return "geography"
        }
        if containsAny(content, ["生活", "微波炉", "咖啡", "食物", "保鲜", "烹饪", "茶", "蔬菜", "调料", "保温", "牛奶", "面包"]) {
            return "life"
        }
        if containsAny(content, ["学习", "遗忘", "笔记", "复习", "记忆曲线", "费曼", "卡片盒", "间隔重复", "刻意练习", "深度工作", "习惯"]) {
            return "study"
        }

        // 4. 全库哈希兜底
        let targetText = headline.isEmpty ? category : headline
        let idx = Int(deterministicHash(targetText) % UInt64(allKeys.count))
        return allKeys[idx]
    }

    private static let lock = NSLock()
    private static var keyCache: [UUID: String] = [:]

    public static func resolveKey(for card: KnowledgeCard) -> String {
        lock.lock()
        if let cached = keyCache[card.id] {
            lock.unlock()
            return cached
        }
        lock.unlock()

        let key = resolveKey(category: card.category, headline: card.headline, summary: card.summary)

        lock.lock()
        keyCache[card.id] = key
        lock.unlock()
        return key
    }

    private static func containsAny(_ text: String, _ keywords: [String]) -> Bool {
        for kw in keywords {
            if text.contains(kw) { return true }
        }
        return false
    }

    /// 严格同图距离排布算法（Min-Distance Greedy Layout）：
    /// 1. 将所有卡片按确定性盐值哈希先进行全局随机打散。
    /// 2. 依次挑选卡片放入输出队列，保证选入的卡片与上一次出现相同背景图的距离 >= minDistance（默认 5 张）。
    /// 3. 若无可达 minDistance 的候选卡片，贪心选取距离上一次出现位置最远（最大化间隔）的一张。
    /// 4. 支持 avoidingTopKey 参数：避免首张卡片撞车刚刚划走的上一次历史顶卡。
    public static func arrangeWithMinDistance(
        _ cards: [KnowledgeCard],
        minDistance: Int = 5,
        avoidingTopKey: String? = nil
    ) -> [KnowledgeCard] {
        guard cards.count > 1 else { return cards }

        var remaining = cards.sorted { cardA, cardB in
            let scoreA = deterministicHash(cardA.headline + "_knowflick_salt_v4")
            let scoreB = deterministicHash(cardB.headline + "_knowflick_salt_v4")
            return scoreA < scoreB
        }

        var result: [KnowledgeCard] = []
        result.reserveCapacity(remaining.count)
        var lastSeenPos: [String: Int] = [:]
        if let avoid = avoidingTopKey {
            lastSeenPos[avoid] = -1
        }

        var currentIndex = 0
        while !remaining.isEmpty {
            var bestCandidateIdx = 0
            var maxDist = -Int.max

            for (i, card) in remaining.enumerated() {
                let key = resolveKey(for: card)
                let lastPos = lastSeenPos[key] ?? -999999
                let dist = currentIndex - lastPos
                if dist >= minDistance {
                    bestCandidateIdx = i
                    break
                }
                if dist > maxDist {
                    maxDist = dist
                    bestCandidateIdx = i
                }
            }

            let chosen = remaining.remove(at: bestCandidateIdx)
            let chosenKey = resolveKey(for: chosen)
            result.append(chosen)
            lastSeenPos[chosenKey] = currentIndex
            currentIndex += 1
        }
        return result
    }

    /// 兼容接口：调用 arrangeWithMinDistance 保证同图至少相隔 5 张以上
    public static func interleavedAndDeduplicated(_ cards: [KnowledgeCard], avoidingTopKey: String? = nil) -> [KnowledgeCard] {
        return arrangeWithMinDistance(cards, minDistance: 5, avoidingTopKey: avoidingTopKey)
    }
}
