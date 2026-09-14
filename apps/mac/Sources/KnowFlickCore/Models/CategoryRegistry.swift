import Foundation

/// 分类体系：一个内置分类（冷知识，不可删改）+ 用户自定义分类（可增删改）。
/// 自定义分类的「内容描述」用于 AI 生成时定制该分类的卡片方向。
public enum CategoryRegistry {
    /// 内置分类：收纳预置知识库卡片（不可删改）
    public static let builtinCategory = "冷知识"

    /// 所有分类名（内置 + 自定义）
    public static func allNames(custom: [String]) -> [String] {
        var names = [builtinCategory]
        names.append(contentsOf: custom)
        return names
    }

    /// 精确别名（含英文/缩写）——仅在目标分类存在时生效（自定义分类名优先）
    private static let exactAliases: [String: String] = [
        "人工智能": "AI",
        "artificial intelligence": "AI",
        "ai": "AI",
        "机器学习": "AI",
        "深度学习": "AI",
        "大模型": "AI",
        "神经科学": "脑科学",
        "认知科学": "脑科学",
        "心理学": "心理",
        "计算机科学": "科技",
        "计算机": "科技",
        "软件工程": "编程",
        "程序设计": "编程",
        "软件开发": "编程",
        "rust": "Rust",
        "python": "Python",
        "统计学": "数学",
        "会计学": "中级会计",
        "财会": "中级会计",
        "会计": "中级会计",
        "审计": "中级会计",
        "投资": "投资理财",
        "理财": "投资理财",
        "金融": "投资理财",
        "基金": "投资理财",
        "英语": "语言",
        "中文": "语言",
        "语言学": "语言",
        "考古": "历史",
        "医学": "生物",
        "生物学": "生物",
        "宇宙": "天文",
        "太空": "天文",
        "航空航天": "天文",
        "地理学": "地理",
        "教育": "学习方法",
        "agent": "AI Agent",
        "智能体": "AI Agent",
        "ai agent": "AI Agent",
        "prompt": "AI 开发",
        "开发": "AI 开发",
    ]

    /// 可包含匹配的别名（仅中文，避免英文别名如 "ai" 误伤）。有序数组保证匹配确定性。
    private static let inclusiveAliases: [(alias: String, target: String)] = [
        ("人工智能", "AI"),
        ("智能体", "AI Agent"),
        ("神经科学", "脑科学"),
        ("计算机", "科技"),
        ("数据结构", "数据结构"),
        ("算法", "算法"),
        ("编程", "编程"),
        ("心理学", "心理"),
        ("会计", "中级会计"),
        ("投资", "投资理财"),
        ("理财", "投资理财"),
        ("基金", "投资理财"),
        ("股票", "投资理财"),
        ("语言学", "语言"),
        ("物理", "物理"),
        ("化学", "化学"),
        ("生物", "生物"),
        ("天文", "天文"),
        ("历史", "历史"),
        ("数学", "数学"),
        ("地理", "地理"),
        ("学习", "学习方法"),
    ]

    /// 未知分类兜底（仅卡片生成场景使用；偏好解析见 `resolve`）
    public static func fallback(custom: [String]) -> String {
        // 若用户自定义了更贴近的兜底类（如「AI 开发」），未知内容优先归入自定义分类的第一个；
        // 否则归入内置冷知识
        custom.first ?? builtinCategory
    }

    /// 解析到有效分类名（内置或自定义）；无法识别返回 nil（偏好设置等场景应剔除而非兜底）
    public static func resolve(_ raw: String, custom: [String]) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let customSet = Set(custom)
        if trimmed == builtinCategory || customSet.contains(trimmed) { return trimmed }
        let lower = trimmed.lowercased()
        if let hit = exactAliases[lower] ?? exactAliases[trimmed] {
            return hit == builtinCategory || customSet.contains(hit) ? hit : nil
        }
        for entry in inclusiveAliases where trimmed.contains(entry.alias) {
            let target = entry.target
            if target == builtinCategory || customSet.contains(target) { return target }
        }
        return nil
    }

    /// 归一化：自由文本 → 有效分类名；无法识别归入兜底（用于 AI 生成卡片）
    public static func normalize(_ raw: String, custom: [String]) -> String {
        resolve(raw, custom: custom) ?? fallback(custom: custom)
    }
}
