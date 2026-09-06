import SwiftUI
import AppKit
import KnowFlickCore

/// 分类视觉主题：背景图 + 主色 + ambient 色温
struct CategoryTheme {
    let category: String
    let image: NSImage?
    let accent: Color        // 主色（标签、点缀）
    let ambient: [Color]     // 窗口背景 ambient 渐变（取自图片色温）

    static let empty = CategoryTheme(
        category: "",
        image: nil,
        accent: Color(red: 0.55, green: 0.58, blue: 0.65),
        ambient: [Color(red: 0.10, green: 0.11, blue: 0.14), Color(red: 0.05, green: 0.05, blue: 0.07)]
    )

    /// 未知分类（AI 新分类）统一回退到 tech 主题
    private static let fallbackSpec = Spec(
        key: "tech",
        accent: Color(red: 0.45, green: 0.75, blue: 0.90),
        ambient: [Color(red: 0.08, green: 0.13, blue: 0.18), Color(red: 0.03, green: 0.06, blue: 0.09)]
    )

    /// 内置「冷知识」分类的专属主题（学习主题图）
    private static let builtinSpec = Spec(
        key: "study",
        accent: Color(red: 0.80, green: 0.72, blue: 0.55),
        ambient: [Color(red: 0.16, green: 0.14, blue: 0.10), Color(red: 0.07, green: 0.06, blue: 0.04)]
    )

    /// 视觉资源键的有序列表（供自定义分类与卡片标题稳定哈希索引）
    private static let specOrder: [String] = [
        "physics", "biology", "astronomy", "math", "chemistry", "history", "psychology",
        "neuroscience", "language", "tech", "life", "geography", "ai", "algorithm",
        "datastructure", "architecture", "rust", "python", "coding", "accounting", "study"
    ]

    /// 领域关键词语义映射表：根据卡片内容命中专属摄影底图
    private static let keywordDomains: [(keywords: [String], specKey: String)] = [
        (["天文", "宇宙", "星球", "光年", "黑洞", "太阳", "行星", "火星", "月球", "地球自转", "银河", "星系", "恒星", "轨道", "引力波", "太空"], "astronomy"),
        (["物理", "热力学", "牛顿", "量子", "引力", "温度", "冰箱", "能量", "声速", "光速", "气压", "电磁", "透镜", "摩擦", "力学", "浮力", "辐射", "波动", "光谱", "绝对零度"], "physics"),
        (["生物", "动物", "植物", "细胞", "基因", "细菌", "物种", "进化", "鸟", "鱼", "昆虫", "猫", "狗", "浆果", "树", "肌肉", "器官", "骨骼", "血液", "叶绿素", "毒素", "寄生", "睡眠", "心脏"], "biology"),
        (["化学", "分子", "元素", "原子", "反应", "氧化", "酸", "盐", "晶体", "溶解", "燃烧", "结冰", "水分子", "金属", "催化", "溶液", "挥发", "周期表"], "chemistry"),
        (["历史", "古代", "世纪", "朝代", "罗马", "埃及", "文明", "皇帝", "战争", "遗迹", "金字塔", "考古", "货币", "丝绸", "帝国", "文物", "封建"], "history"),
        (["心理", "情绪", "认知", "偏见", "潜意识", "焦虑", "梦", "哈欠", "安慰剂", "抑郁", "错觉", "直觉", "催眠", "依赖", "群体"], "psychology"),
        (["脑", "神经", "多巴胺", "记忆", "突触", "大脑", "神经元", "脑电波", "海马体", "大脑皮层", "智商"], "neuroscience"),
        (["语言", "字", "词", "翻译", "文字", "发音", "词源", "语法", "汉字", "英语", "方言", "拼音", "象形", "修辞"], "language"),
        (["数学", "几何", "概率", "拓扑", "素数", "方程", "微积分", "统计", "圆周率", "悖论", "斐波那契", "维度", "矩阵", "证明"], "math"),
        (["地理", "海洋", "山脉", "地震", "气候", "河流", "板块", "火山", "大气", "沙漠", "极光", "潮汐", "经纬度", "季风", "冰川"], "geography"),
        (["ai", "模型", "神经网络", "深度学习", "机器学习", "大模型", "gpt", "agent", "智能体", "prompt", "提示词", "rag", "变换器", "transformer", "llm"], "ai"),
        (["算法", "复杂度", "排序", "搜索", "二叉树", "动态规划", "贪心", "分治", "回溯"], "algorithm"),
        (["数据结构", "链表", "栈", "队列", "哈希", "图", "堆", "数组", "字典"], "datastructure"),
        (["架构", "微服务", "高可用", "分布式", "解耦", "设计模式", "容灾", "负载均衡", "幂等", "事务"], "architecture"),
        (["rust", "所有权", "生命周期", "borrow", "unsafe", "cargo", "并发安全"], "rust"),
        (["python", "gil", "装饰器", "生成器", "pip", "asyncio", "解释器"], "python"),
        (["编程", "代码", "编译器", "内存", "并发", "多线程", "bug", "指针", "调试", "源码", "堆栈", "递归"], "coding"),
        (["会计", "借贷", "资产", "负债", "利润", "折旧", "公允", "财务", "税", "存货", "摊销", "报表", "准则", "审计", "成本"], "accounting"),
        (["理财", "投资", "复利", "基金", "定投", "股票", "资产配置", "收益率", "年化", "利息", "通胀"], "architecture"),
        (["学习", "遗忘", "笔记", "复习", "记忆曲线", "费曼", "卡片盒", "间隔重复", "刻意练习", "深度工作"], "study"),
        (["生活", "微波炉", "咖啡", "食物", "保鲜", "烹饪", "茶", "蔬菜", "调料", "保温"], "life")
    ]

    /// 文本哈希映射（保证同一文本每次同图同色）
    private static func hashedSpec(for name: String) -> Spec {
        var h = 0
        for scalar in name.unicodeScalars {
            h = (h &* 31 &+ Int(scalar.value)) & 0x7fffffff
        }
        let key = specOrder[h % specOrder.count]
        return specs.values.first { $0.key == key } ?? fallbackSpec
    }

    /// 语义感知匹配：关键词优先命中，无命中时按标题哈希分散
    private static func semanticSpec(headline: String, summary: String, category: String) -> Spec {
        let content = (headline + " " + summary).lowercased()
        for domain in keywordDomains {
            if domain.keywords.contains(where: { content.contains($0) }) {
                if let matched = specs.values.first(where: { $0.key == domain.specKey }) {
                    return matched
                }
            }
        }
        return hashedSpec(for: headline.isEmpty ? category : headline)
    }

    /// 单张卡片 → 主题（自动结合标题与内容进行语义匹配与哈希分散）
    @MainActor
    static func theme(for card: KnowledgeCard?, cache: BackgroundImageCache? = nil) -> CategoryTheme {
        guard let card = card else { return empty }
        return theme(for: card.category, headline: card.headline, summary: card.summary, cache: cache)
    }

    /// 分类名 + 标题/摘要 → 主题。用于卡片展示、详情展示与动态背景联动
    @MainActor
    static func theme(
        for category: String,
        headline: String? = nil,
        summary: String? = nil,
        cache: BackgroundImageCache? = nil
    ) -> CategoryTheme {
        let imageCache = cache ?? .shared
        let spec: Spec
        if let headline = headline, !headline.isEmpty {
            spec = semanticSpec(headline: headline, summary: summary ?? "", category: category)
        } else if category == CategoryRegistry.builtinCategory {
            spec = builtinSpec
        } else if let s = specs[category] {
            spec = s   // 兼容旧分类
        } else {
            spec = hashedSpec(for: category)
        }
        return CategoryTheme(
            category: category,
            image: imageCache.image(named: spec.key),
            accent: spec.accent,
            ambient: spec.ambient
        )
    }

    private struct Spec { let key: String; let accent: Color; let ambient: [Color] }

    private static let specs: [String: Spec] = [
        "物理": .init(key: "physics", accent: Color(red: 0.98, green: 0.72, blue: 0.35),
                      ambient: [Color(red: 0.16, green: 0.13, blue: 0.10), Color(red: 0.05, green: 0.05, blue: 0.06)]),
        "生物": .init(key: "biology", accent: Color(red: 0.35, green: 0.80, blue: 0.85),
                      ambient: [Color(red: 0.07, green: 0.16, blue: 0.19), Color(red: 0.03, green: 0.07, blue: 0.09)]),
        "天文": .init(key: "astronomy", accent: Color(red: 0.62, green: 0.72, blue: 0.95),
                      ambient: [Color(red: 0.09, green: 0.10, blue: 0.22), Color(red: 0.03, green: 0.04, blue: 0.10)]),
        "数学": .init(key: "math", accent: Color(red: 0.55, green: 0.75, blue: 0.60),
                      ambient: [Color(red: 0.10, green: 0.15, blue: 0.12), Color(red: 0.04, green: 0.07, blue: 0.06)]),
        "化学": .init(key: "chemistry", accent: Color(red: 0.55, green: 0.85, blue: 0.75),
                      ambient: [Color(red: 0.08, green: 0.17, blue: 0.15), Color(red: 0.03, green: 0.08, blue: 0.07)]),
        "历史": .init(key: "history", accent: Color(red: 0.85, green: 0.68, blue: 0.48),
                      ambient: [Color(red: 0.17, green: 0.13, blue: 0.09), Color(red: 0.07, green: 0.06, blue: 0.05)]),
        "心理": .init(key: "psychology", accent: Color(red: 0.80, green: 0.62, blue: 0.70),
                      ambient: [Color(red: 0.16, green: 0.11, blue: 0.14), Color(red: 0.07, green: 0.05, blue: 0.07)]),
        "脑科学": .init(key: "neuroscience", accent: Color(red: 0.85, green: 0.55, blue: 0.55),
                        ambient: [Color(red: 0.17, green: 0.10, blue: 0.11), Color(red: 0.08, green: 0.05, blue: 0.06)]),
        "语言": .init(key: "language", accent: Color(red: 0.70, green: 0.75, blue: 0.55),
                      ambient: [Color(red: 0.13, green: 0.15, blue: 0.09), Color(red: 0.06, green: 0.07, blue: 0.04)]),
        "科技": .init(key: "tech", accent: Color(red: 0.45, green: 0.75, blue: 0.90),
                      ambient: [Color(red: 0.08, green: 0.13, blue: 0.18), Color(red: 0.03, green: 0.06, blue: 0.09)]),
        "生活": .init(key: "life", accent: Color(red: 0.90, green: 0.70, blue: 0.50),
                      ambient: [Color(red: 0.16, green: 0.12, blue: 0.08), Color(red: 0.07, green: 0.05, blue: 0.04)]),
        "地理": .init(key: "geography", accent: Color(red: 0.60, green: 0.80, blue: 0.65),
                      ambient: [Color(red: 0.09, green: 0.15, blue: 0.12), Color(red: 0.04, green: 0.07, blue: 0.06)]),
        "AI": .init(key: "ai", accent: Color(red: 0.62, green: 0.70, blue: 0.95),
                    ambient: [Color(red: 0.10, green: 0.11, blue: 0.20), Color(red: 0.04, green: 0.05, blue: 0.10)]),
        "算法": .init(key: "algorithm", accent: Color(red: 0.50, green: 0.80, blue: 0.80),
                      ambient: [Color(red: 0.07, green: 0.14, blue: 0.15), Color(red: 0.03, green: 0.06, blue: 0.07)]),
        "数据结构": .init(key: "datastructure", accent: Color(red: 0.55, green: 0.75, blue: 0.90),
                          ambient: [Color(red: 0.08, green: 0.12, blue: 0.16), Color(red: 0.04, green: 0.06, blue: 0.08)]),
        "架构": .init(key: "architecture", accent: Color(red: 0.75, green: 0.78, blue: 0.85),
                      ambient: [Color(red: 0.12, green: 0.13, blue: 0.16), Color(red: 0.05, green: 0.06, blue: 0.07)]),
        "Rust": .init(key: "rust", accent: Color(red: 0.90, green: 0.55, blue: 0.38),
                      ambient: [Color(red: 0.18, green: 0.10, blue: 0.07), Color(red: 0.08, green: 0.05, blue: 0.04)]),
        "Python": .init(key: "python", accent: Color(red: 0.55, green: 0.75, blue: 0.90),
                        ambient: [Color(red: 0.09, green: 0.13, blue: 0.17), Color(red: 0.04, green: 0.06, blue: 0.08)]),
        "编程": .init(key: "coding", accent: Color(red: 0.60, green: 0.80, blue: 0.70),
                      ambient: [Color(red: 0.09, green: 0.14, blue: 0.12), Color(red: 0.04, green: 0.07, blue: 0.06)]),
        "会计": .init(key: "accounting", accent: Color(red: 0.60, green: 0.78, blue: 0.60),
                      ambient: [Color(red: 0.10, green: 0.15, blue: 0.11), Color(red: 0.05, green: 0.07, blue: 0.05)]),
        "学习方法": .init(key: "study", accent: Color(red: 0.80, green: 0.72, blue: 0.55),
                          ambient: [Color(red: 0.16, green: 0.14, blue: 0.10), Color(red: 0.07, green: 0.06, blue: 0.04)]),
    ]
}

/// 背景图缓存：ImageIO 降采样解码 + NSCache 自动响应内存压力
@MainActor
final class BackgroundImageCache {
    static let shared = BackgroundImageCache()
    private let cache = NSCache<NSString, NSImage>()

    /// 最大边长：卡片显示尺寸的 2x 足够，避免全尺寸解码吃内存
    private let maxPixel: CGFloat = 900

    private init() {
        cache.countLimit = 12          // 最多缓存 12 张，浏览时按需换入换出
        cache.totalCostLimit = 48 * 1024 * 1024
    }

    func image(named key: String) -> NSImage? {
        if let hit = cache.object(forKey: key as NSString) { return hit }
        guard let url = CoreResources.bundle.url(forResource: key, withExtension: "jpg", subdirectory: nil)
                ?? CoreResources.bundle.urls(forResourcesWithExtension: "jpg", subdirectory: nil)?.first(where: { $0.lastPathComponent == "\(key).jpg" }) else {
            return nil
        }
        guard let img = Self.downsampledImage(url: url, maxPixel: maxPixel) else { return nil }
        cache.setObject(img, forKey: key as NSString, cost: Self.estimatedCost(img))
        return img
    }

    /// ImageIO 缩略解码：不全量解压原图，直接生成目标尺寸位图
    private static func downsampledImage(url: URL, maxPixel: CGFloat) -> NSImage? {
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel
        ]
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            return NSImage(contentsOf: url)
        }
        return NSImage(cgImage: cgImage, size: NSSize(width: cgImage.width / 2, height: cgImage.height / 2))
    }

    private static func estimatedCost(_ img: NSImage) -> Int {
        guard let rep = img.representations.first else { return 1 << 20 }
        return rep.pixelsWide * rep.pixelsHigh * 4
    }
}
