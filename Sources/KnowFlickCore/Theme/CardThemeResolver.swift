import Foundation

/// 卡片视觉主题解析器：
/// 1. 领域关联多图池（Tech / Finance / Science / Humanities）：解决单分类或相近领域内背景图撞车问题
/// 2. 细化语义关键词匹配（Git/代码/架构/会计/公式/天文/生物等）
/// 3. 确定性稳定伪随机哈希打散（解构种子库中连续 3~12 张相同学科卡片的聚集排布）
/// 4. 相邻绝对防重算法（Anti-Consecutive Duplicate）：严格保证任意相邻两张卡片背景图不同（0 撞图）
public enum CardThemeResolver {
    /// 21 种视觉底图的全部键
    public static let allKeys: [String] = [
        "physics", "biology", "astronomy", "math", "chemistry", "history", "psychology",
        "neuroscience", "language", "tech", "life", "geography", "ai", "algorithm",
        "datastructure", "architecture", "rust", "python", "coding", "accounting", "study"
    ]

    /// 计算机与 AI 领域池（8 张不同摄影底图）
    public static let techPool: [String] = [
        "ai", "algorithm", "datastructure", "architecture", "coding", "tech", "python", "rust"
    ]

    /// 商业、财会与数理金融领域池（6 张不同摄影底图）
    public static let financePool: [String] = [
        "accounting", "math", "architecture", "tech", "history", "study"
    ]

    /// 自然与宇宙科学领域池（6 张不同摄影底图）
    public static let sciencePool: [String] = [
        "physics", "biology", "astronomy", "chemistry", "math", "geography"
    ]

    /// 人文、心理与社会领域池（6 张不同摄影底图）
    public static let humanitiesPool: [String] = [
        "history", "psychology", "neuroscience", "language", "life", "study"
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

        // 1. 商业财会与投资金融领域
        if category.contains("会计") || category.contains("财务") {
            if containsAny(content, ["算法", "fifo", "先进先出", "加权", "计价"]) {
                return "datastructure"
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
            if containsAny(content, ["增值税", "技术", "现代", "现金流", "系统", "发票"]) {
                return "tech"
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
            if containsAny(content, ["三要素", "掌控", "时间是它", "习惯", "自律"]) {
                return "study"
            }
            if containsAny(content, ["复利", "年化", "收益率", "市盈率", "概率", "统计"]) {
                return "math"
            }
            if containsAny(content, ["金字塔", "资产配置", "体系", "支柱", "组合", "分散"]) {
                return "architecture"
            }
            if containsAny(content, ["通货膨胀", "缩水", "现金流", "现代金融", "科技"]) {
                return "tech"
            }
            if containsAny(content, ["历史", "大萧条", "演变", "泡沫", "周期"]) {
                return "history"
            }
            if containsAny(content, ["定投", "交易", "散户"]) {
                return "psychology"
            }
            let idx = Int(deterministicHash(headline) % UInt64(financePool.count))
            return financePool[idx]
        }

        // 2. 计算机、编程、软件工程、AI 与 AI Agent
        let lowerCat = category.lowercased()
        if lowerCat.contains("ai") || lowerCat.contains("agent") || category.contains("开发") || category.contains("编程") || category.contains("算法") {
            if containsAny(content, ["余弦", "几何", "坐标", "向量", "距离", "标尺", "空间", "概率", "确定性", "temperature", "准确率", "召回率", "精确率"]) {
                return "math"
            }
            if containsAny(content, ["流式", "边生成边显示", "网络", "技术"]) {
                return "tech"
            }
            if containsAny(content, ["测试", "回归测试", "护栏", "边界", "安全", "rust", "生命周期", "并发"]) {
                return "rust"
            }
            if containsAny(content, ["微调还是提示", "微调", "架构", "微服务", "协作", "本质", "系统", "循环", "多智能体", "策略", "管理"]) {
                return "architecture"
            }
            if containsAny(content, ["function calling", "函数", "调函数", "代码", "工具", "幂等", "接口", "调试", "编译器", "git", "commit", "token", "计费", "bug"]) {
                return "coding"
            }
            if containsAny(content, ["幻觉", "讨好", "喜欢", "胡说八道", "反馈", "rlhf", "思考", "react", "认知", "偏见", "心理", "反思"]) {
                return "psychology"
            }
            if containsAny(content, ["提示工程第一课", "任务、约束、示例", "备考", "考场", "背题", "学会", "标签", "监督学习", "过拟合", "训练与推理", "评估"]) {
                return "study"
            }
            if containsAny(content, ["rag", "上下文", "检索", "窗口", "知识库", "数据库", "向量数据库", "索引", "数据结构", "二叉树", "链表", "哈希", "快照"]) {
                return "datastructure"
            }
            if containsAny(content, ["人话", "说人话", "语义", "词序"]) {
                return "language"
            }
            if containsAny(content, ["人在回路", "人类", "闸门", "生活"]) {
                return "life"
            }
            if containsAny(content, ["python", "pip", "asyncio", "gil"]) {
                return "python"
            }
            if containsAny(content, ["transformer", "位置编码", "反向传播", "权重", "算法", "注意力", "规划", "步骤", "复杂度"]) {
                return "algorithm"
            }
            if containsAny(content, ["温度参数", "温度", "物理"]) {
                return "physics"
            }
            let idx = Int(deterministicHash(headline) % UInt64(techPool.count))
            return techPool[idx]
        }

        // 3. 广域领域细化匹配（冷知识等综合分类）
        // 优先匹配技术/工程关键词，避免 "文件树" 误命中植物
        if containsAny(content, ["git", "commit", "版本控制", "代码", "编译器", "指针", "调试", "多线程", "bug"]) {
            return "coding"
        }
        if containsAny(content, ["布隆过滤器", "哈希表", "数据结构", "二叉树", "链表", "缓存"]) {
            return "datastructure"
        }

        // 自然与人文关键词匹配
        if containsAny(content, ["天文", "宇宙", "星球", "光年", "黑洞", "太阳", "行星", "火星", "月球", "地球自转", "银河", "星系", "恒星", "轨道", "引力波", "太空", "历法"]) {
            return "astronomy"
        }
        if containsAny(content, ["物理", "热力学", "牛顿", "量子", "引力", "温度", "冰箱", "能量", "声速", "光速", "气压", "电磁", "透镜", "摩擦", "力学", "浮力", "辐射", "波动", "光谱", "绝对零度", "相对论", "gps"]) {
            return "physics"
        }
        if containsAny(content, ["生物", "动物", "植物", "细胞", "基因", "细菌", "物种", "进化", "鸟", "鱼", "昆虫", "猫", "狗", "浆果", "树木", "森林", "肌肉", "器官", "骨骼", "血液", "叶绿素", "毒素", "寄生", "睡眠", "心脏", "母鸡", "鸡蛋", "恐龙", "真菌"]) {
            return "biology"
        }
        if containsAny(content, ["化学", "分子", "元素", "原子", "反应", "氧化", "酸", "盐", "晶体", "溶解", "燃烧", "结冰", "水分子", "金属", "催化", "溶液", "挥发", "周期表", "笑气", "麻醉"]) {
            return "chemistry"
        }
        if containsAny(content, ["历史", "古代", "世纪", "朝代", "罗马", "埃及", "文明", "皇帝", "战争", "遗迹", "金字塔", "考古", "货币", "丝绸", "帝国", "文物", "封建", "中世纪"]) {
            return "history"
        }
        if containsAny(content, ["心理", "情绪", "认知", "偏见", "潜意识", "焦虑", "梦", "哈欠", "安慰剂", "抑郁", "错觉", "直觉", "催眠", "依赖", "群体", "损失厌恶"]) {
            return "psychology"
        }
        if containsAny(content, ["脑", "神经", "多巴胺", "记忆", "突触", "大脑", "神经元", "脑电波", "海马体", "大脑皮层", "智商", "痛觉", "味觉", "神经系统"]) {
            return "neuroscience"
        }
        if containsAny(content, ["语言", "字", "词", "翻译", "文字", "发音", "词源", "语法", "汉字", "英语", "方言", "拼音", "象形", "修辞", "键盘", "qwerty"]) {
            return "language"
        }
        if containsAny(content, ["数学", "几何", "概率", "拓扑", "素数", "方程", "微积分", "统计", "圆周率", "悖论", "斐波那契", "维度", "矩阵", "证明"]) {
            return "math"
        }
        if containsAny(content, ["地理", "海洋", "山脉", "地震", "气候", "河流", "板块", "火山", "大气", "沙漠", "极光", "潮汐", "经纬度", "季风", "冰川"]) {
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

    public static func resolveKey(for card: KnowledgeCard) -> String {
        resolveKey(category: card.category, headline: card.headline, summary: card.summary)
    }

    private static func containsAny(_ text: String, _ keywords: [String]) -> Bool {
        for kw in keywords {
            if text.contains(kw) { return true }
        }
        return false
    }

    /// 相邻卡片绝对防重算法：
    /// 1. 确保第 0 张卡片不等于 avoidingTopKey（即刚划走的那张卡，消除划卡换帧撞图）
    /// 2. 单遍扫描，若第 i 张卡片背景与第 i-1 张相同，向后寻找一张背景不同的卡片交换。
    /// 3. 当卡片数量足够时，尽可能保证第 i 张与第 i-2 张不同，从而使可见卡片堆（visibleStack 3张）视觉各异。
    /// 4. 末尾反向安全插拔，杜绝末尾边界重复。
    public static func antiConsecutive(_ cards: [KnowledgeCard], avoidingTopKey: String? = nil) -> [KnowledgeCard] {
        guard !cards.isEmpty else { return cards }
        var arr = cards

        // 步骤 1：第 0 张卡片必须避免与上一张刚划走的卡片（avoidingTopKey）相同
        if let avoidKey = avoidingTopKey, resolveKey(for: arr[0]) == avoidKey {
            for j in 1..<arr.count {
                if resolveKey(for: arr[j]) != avoidKey {
                    arr.swapAt(0, j)
                    break
                }
            }
        }

        // 步骤 2：前向相邻防重与可见栈多样性
        for i in 1..<arr.count {
            let prevKey = resolveKey(for: arr[i - 1])
            let currKey = resolveKey(for: arr[i])
            let prev2Key = (i >= 2) ? resolveKey(for: arr[i - 2]) : nil

            let isDuplicateWithPrev = (currKey == prevKey)
            let isDuplicateWithPrev2 = (prev2Key != nil && currKey == prev2Key && arr.count > 4)

            if isDuplicateWithPrev || isDuplicateWithPrev2 {
                // 优先寻找既不同于 i-1 又不同于 i-2 的卡片
                var bestJ: Int? = nil
                for j in (i + 1)..<arr.count {
                    let k_j = resolveKey(for: arr[j])
                    if k_j != prevKey && (prev2Key == nil || k_j != prev2Key) {
                        bestJ = j
                        break
                    }
                }
                // 若找不到同时满足两者的，退回保证不同于 i-1（消除相邻重复）
                if bestJ == nil && isDuplicateWithPrev {
                    for j in (i + 1)..<arr.count {
                        if resolveKey(for: arr[j]) != prevKey {
                            bestJ = j
                            break
                        }
                    }
                }
                if let swapIdx = bestJ {
                    arr.swapAt(i, swapIdx)
                }
            }
        }

        // 步骤 3：末尾回退安全校验（处理末尾无后续卡片可换的边界情况）
        for i in (1..<arr.count).reversed() {
            let prevKey = resolveKey(for: arr[i - 1])
            let currKey = resolveKey(for: arr[i])
            if currKey == prevKey {
                for k in 0..<(i - 1) {
                    let kKey = resolveKey(for: arr[k])
                    let kPrevKey = (k > 0) ? resolveKey(for: arr[k - 1]) : nil
                    let kNextKey = resolveKey(for: arr[k + 1])
                    if kKey != prevKey && currKey != kPrevKey && currKey != kNextKey {
                        arr.swapAt(i, k)
                        break
                    }
                }
            }
        }
        return arr
    }

    /// 确定性交织打散 + 相邻绝对防重：
    /// 先按卡片内容确定性盐值哈希交错打散学科批次，再执行相邻防重校验。
    public static func interleavedAndDeduplicated(_ cards: [KnowledgeCard], avoidingTopKey: String? = nil) -> [KnowledgeCard] {
        guard cards.count > 1 else { return cards }
        let sortedCards = cards.sorted { cardA, cardB in
            let scoreA = deterministicHash(cardA.headline + "_knowflick_salt_v3")
            let scoreB = deterministicHash(cardB.headline + "_knowflick_salt_v3")
            return scoreA < scoreB
        }
        return antiConsecutive(sortedCards, avoidingTopKey: avoidingTopKey)
    }
}
