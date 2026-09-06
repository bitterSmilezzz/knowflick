import Foundation

/// 受控分类词表：AI 生成的自由文本分类在此归一化到白名单，
/// 是分类身份的模型层唯一事实源（UI 层 CategoryTheme 只做视觉映射）
public enum CategoryRegistry {
    /// 受控分类白名单（与 seed 库 21 类对齐）
    public static let canonical: [String] = [
        "物理", "生物", "天文", "数学", "化学", "历史", "心理", "脑科学", "语言",
        "科技", "生活", "地理", "AI", "算法", "数据结构", "架构", "Rust", "Python",
        "编程", "会计", "学习方法"
    ]

    /// 精确别名（含英文/缩写）
    private static let exactAliases: [String: String] = [
        "人工智能": "AI",
        "artificial intelligence": "AI",
        "ai": "AI",
        "机器学习": "AI",
        "深度学习": "AI",
        "大模型": "AI",
        "神经科学": "脑科学",
        "认知科学": "脑科学",
        "神经": "脑科学",
        "心理学": "心理",
        "计算机科学": "科技",
        "计算机": "科技",
        "信息技术": "科技",
        "互联网": "科技",
        "软件工程": "编程",
        "程序设计": "编程",
        "软件开发": "编程",
        "rust": "Rust",
        "python": "Python",
        "统计学": "数学",
        "会计学": "会计",
        "审计": "会计",
        "财会": "会计",
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
    ]

    /// 可包含匹配的别名（仅中文，避免英文别名如 "ai" 误伤）。
    /// 有序数组保证匹配确定性（先出现者优先）。
    private static let inclusiveAliases: [(alias: String, target: String)] = [
        ("人工智能", "AI"),
        ("神经科学", "脑科学"),
        ("计算机", "科技"),
        ("数据结构", "数据结构"),
        ("算法", "算法"),
        ("编程", "编程"),
        ("心理学", "心理"),
        ("会计", "会计"),
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

    /// 未知分类的兜底（仅卡片生成场景使用；用户偏好解析见 `resolve`）
    public static let fallback = "科技"

    /// 解析到白名单分类；无法识别返回 nil（偏好设置等场景应剔除而非兜底）
    public static func resolve(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if canonical.contains(trimmed) { return trimmed }
        let lower = trimmed.lowercased()
        if let hit = exactAliases[lower] ?? exactAliases[trimmed] { return hit }
        for entry in inclusiveAliases where trimmed.contains(entry.alias) { return entry.target }
        for c in canonical where trimmed.contains(c) { return c }
        return nil
    }

    /// 归一化：自由文本 → 白名单分类；无法识别归入 fallback（用于 AI 生成卡片）
    public static func normalize(_ raw: String) -> String {
        resolve(raw) ?? fallback
    }
}
