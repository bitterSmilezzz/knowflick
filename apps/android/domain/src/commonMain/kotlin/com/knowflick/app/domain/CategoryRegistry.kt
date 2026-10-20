package com.knowflick.app.domain

/**
 * 分类体系：一个内置分类（冷知识，不可删改）+ 用户自定义分类（可增删改）。
 * 自定义分类的「内容描述」用于 AI 生成时定制该分类的卡片方向。
 * 移植自 macOS 端 CategoryRegistry，别名表逐条对齐。
 */
object CategoryRegistry {
    /** 内置分类：收纳预置知识库卡片（不可删改） */
    const val BUILTIN_CATEGORY = "冷知识"

    /** 所有分类名（内置 + 自定义） */
    fun allNames(custom: List<String>): List<String> = listOf(BUILTIN_CATEGORY) + custom

    /** 精确别名（含英文/缩写）——仅在目标分类存在时生效（自定义分类名优先） */
    private val exactAliases: Map<String, String> = mapOf(
        "人工智能" to "AI",
        "artificial intelligence" to "AI",
        "ai" to "AI",
        "机器学习" to "AI",
        "深度学习" to "AI",
        "大模型" to "AI",
        "神经科学" to "脑科学",
        "认知科学" to "脑科学",
        "心理学" to "心理",
        "计算机科学" to "科技",
        "计算机" to "科技",
        "软件工程" to "编程",
        "程序设计" to "编程",
        "软件开发" to "编程",
        "rust" to "Rust",
        "python" to "Python",
        "统计学" to "数学",
        "会计学" to "中级会计",
        "财会" to "中级会计",
        "会计" to "中级会计",
        "审计" to "中级会计",
        "投资" to "投资理财",
        "理财" to "投资理财",
        "金融" to "投资理财",
        "基金" to "投资理财",
        "英语" to "语言",
        "中文" to "语言",
        "语言学" to "语言",
        "考古" to "历史",
        "医学" to "生物",
        "生物学" to "生物",
        "宇宙" to "天文",
        "太空" to "天文",
        "航空航天" to "天文",
        "地理学" to "地理",
        "教育" to "学习方法",
        "agent" to "AI Agent",
        "智能体" to "AI Agent",
        "ai agent" to "AI Agent",
        "prompt" to "AI 开发",
        "开发" to "AI 开发",
    )

    /** 可包含匹配的别名（仅中文，避免英文别名如 "ai" 误伤）。有序列表保证匹配确定性。 */
    private val inclusiveAliases: List<Pair<String, String>> = listOf(
        "人工智能" to "AI",
        "智能体" to "AI Agent",
        "神经科学" to "脑科学",
        "计算机" to "科技",
        "数据结构" to "数据结构",
        "算法" to "算法",
        "编程" to "编程",
        "心理学" to "心理",
        "会计" to "中级会计",
        "投资" to "投资理财",
        "理财" to "投资理财",
        "基金" to "投资理财",
        "股票" to "投资理财",
        "语言学" to "语言",
        "物理" to "物理",
        "化学" to "化学",
        "生物" to "生物",
        "天文" to "天文",
        "历史" to "历史",
        "数学" to "数学",
        "地理" to "地理",
        "学习" to "学习方法",
    )

    /** 未知分类兜底（仅卡片生成场景使用；偏好解析见 resolve） */
    fun fallback(custom: List<String>): String = custom.firstOrNull() ?: BUILTIN_CATEGORY

    /** 解析到有效分类名（内置或自定义）；无法识别返回 null（偏好设置等场景应剔除而非兜底） */
    fun resolve(raw: String, custom: List<String>): String? {
        val trimmed = raw.trim()
        val customSet = custom.toSet()
        if (trimmed == BUILTIN_CATEGORY || trimmed in customSet) return trimmed
        val lower = trimmed.lowercase()
        // 精确别名命中但目标不在白名单：直接返回 null（与 Swift 一致，不落入包含匹配）
        val exact = exactAliases[lower] ?: exactAliases[trimmed]
        if (exact != null) {
            return if (exact == BUILTIN_CATEGORY || exact in customSet) exact else null
        }
        for ((alias, target) in inclusiveAliases) {
            if (trimmed.contains(alias) && (target == BUILTIN_CATEGORY || target in customSet)) {
                return target
            }
        }
        return null
    }

    /** 归一化：自由文本 → 有效分类名；无法识别归入兜底（用于 AI 生成卡片） */
    fun normalize(raw: String, custom: List<String>): String = resolve(raw, custom) ?: fallback(custom)
}
