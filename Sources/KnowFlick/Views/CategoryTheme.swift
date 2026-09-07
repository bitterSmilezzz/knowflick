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

    private static let categoryAliases: [String: String] = [
        "物理": "physics", "生物": "biology", "天文": "astronomy", "数学": "math",
        "化学": "chemistry", "历史": "history", "心理": "psychology", "脑科学": "neuroscience",
        "语言": "language", "科技": "tech", "生活": "life", "地理": "geography",
        "AI": "ai", "AI Agent": "agent", "算法": "algorithm", "数据结构": "datastructure", "架构": "architecture",
        "Rust": "rust", "Python": "python", "编程": "coding", "AI 开发": "coding", "会计": "accounting",
        "中级会计": "accounting", "投资理财": "economy", "学习方法": "study", "冷知识": "study",
        "量子": "quantum", "相对论": "relativity", "光学": "optics", "海洋": "ocean",
        "气象": "meteorology", "地质": "geology", "航天": "spacecraft", "基因": "genetics",
        "生态": "ecology", "机器人": "robotics", "网络": "network", "数据库": "database",
        "安全": "security", "经济": "economy", "哲学": "philosophy", "社会学": "sociology", "音乐": "music"
    ]

    /// 单张卡片 → 主题（领域多图池 + 细化语义 + 相邻防重一致）
    @MainActor
    static func theme(for card: KnowledgeCard?, cache: BackgroundImageCache? = nil) -> CategoryTheme {
        guard let card = card else { return empty }
        let key = CardThemeResolver.resolveKey(for: card)
        return theme(forKey: key, category: card.category, cache: cache)
    }

    /// 分类名 + 标题/摘要 → 主题。用于卡片展示、详情展示与动态背景联动
    @MainActor
    static func theme(
        for category: String,
        headline: String? = nil,
        summary: String? = nil,
        cache: BackgroundImageCache? = nil
    ) -> CategoryTheme {
        let key = CardThemeResolver.resolveKey(category: category, headline: headline ?? "", summary: summary ?? "")
        return theme(forKey: key, category: category, cache: cache)
    }

    @MainActor
    private static func theme(forKey key: String, category: String, cache: BackgroundImageCache?) -> CategoryTheme {
        let imageCache = cache ?? .shared
        let specKey = specs[key] != nil ? key : (categoryAliases[key] ?? categoryAliases[category] ?? "tech")
        let spec = specs[specKey] ?? fallbackSpec
        return CategoryTheme(
            category: category,
            image: imageCache.image(named: spec.key),
            accent: spec.accent,
            ambient: spec.ambient
        )
    }

    private struct Spec { let key: String; let accent: Color; let ambient: [Color] }

    /// 42 种视觉底图的视觉规格表（以 key 为键，O(1) 索引）
    private static let specs: [String: Spec] = [
        "physics": .init(key: "physics", accent: Color(red: 0.98, green: 0.72, blue: 0.35),
                         ambient: [Color(red: 0.16, green: 0.13, blue: 0.10), Color(red: 0.05, green: 0.05, blue: 0.06)]),
        "biology": .init(key: "biology", accent: Color(red: 0.35, green: 0.80, blue: 0.85),
                         ambient: [Color(red: 0.07, green: 0.16, blue: 0.19), Color(red: 0.03, green: 0.07, blue: 0.09)]),
        "astronomy": .init(key: "astronomy", accent: Color(red: 0.62, green: 0.72, blue: 0.95),
                           ambient: [Color(red: 0.09, green: 0.10, blue: 0.22), Color(red: 0.03, green: 0.04, blue: 0.10)]),
        "math": .init(key: "math", accent: Color(red: 0.55, green: 0.75, blue: 0.60),
                      ambient: [Color(red: 0.10, green: 0.15, blue: 0.12), Color(red: 0.04, green: 0.07, blue: 0.06)]),
        "chemistry": .init(key: "chemistry", accent: Color(red: 0.55, green: 0.85, blue: 0.75),
                           ambient: [Color(red: 0.08, green: 0.17, blue: 0.15), Color(red: 0.03, green: 0.08, blue: 0.07)]),
        "history": .init(key: "history", accent: Color(red: 0.85, green: 0.68, blue: 0.48),
                         ambient: [Color(red: 0.17, green: 0.13, blue: 0.09), Color(red: 0.07, green: 0.06, blue: 0.05)]),
        "psychology": .init(key: "psychology", accent: Color(red: 0.80, green: 0.62, blue: 0.70),
                            ambient: [Color(red: 0.16, green: 0.11, blue: 0.14), Color(red: 0.07, green: 0.05, blue: 0.07)]),
        "neuroscience": .init(key: "neuroscience", accent: Color(red: 0.85, green: 0.55, blue: 0.55),
                              ambient: [Color(red: 0.17, green: 0.10, blue: 0.11), Color(red: 0.08, green: 0.05, blue: 0.06)]),
        "language": .init(key: "language", accent: Color(red: 0.70, green: 0.75, blue: 0.55),
                          ambient: [Color(red: 0.13, green: 0.15, blue: 0.09), Color(red: 0.06, green: 0.07, blue: 0.04)]),
        "tech": .init(key: "tech", accent: Color(red: 0.45, green: 0.75, blue: 0.90),
                      ambient: [Color(red: 0.08, green: 0.13, blue: 0.18), Color(red: 0.03, green: 0.06, blue: 0.09)]),
        "life": .init(key: "life", accent: Color(red: 0.90, green: 0.70, blue: 0.50),
                      ambient: [Color(red: 0.16, green: 0.12, blue: 0.08), Color(red: 0.07, green: 0.05, blue: 0.04)]),
        "geography": .init(key: "geography", accent: Color(red: 0.60, green: 0.80, blue: 0.65),
                           ambient: [Color(red: 0.09, green: 0.15, blue: 0.12), Color(red: 0.04, green: 0.07, blue: 0.06)]),
        "ai": .init(key: "ai", accent: Color(red: 0.62, green: 0.70, blue: 0.95),
                    ambient: [Color(red: 0.10, green: 0.11, blue: 0.20), Color(red: 0.04, green: 0.05, blue: 0.10)]),
        "algorithm": .init(key: "algorithm", accent: Color(red: 0.50, green: 0.80, blue: 0.80),
                           ambient: [Color(red: 0.07, green: 0.14, blue: 0.15), Color(red: 0.03, green: 0.06, blue: 0.07)]),
        "datastructure": .init(key: "datastructure", accent: Color(red: 0.55, green: 0.75, blue: 0.90),
                               ambient: [Color(red: 0.08, green: 0.12, blue: 0.16), Color(red: 0.04, green: 0.06, blue: 0.08)]),
        "architecture": .init(key: "architecture", accent: Color(red: 0.75, green: 0.78, blue: 0.85),
                              ambient: [Color(red: 0.12, green: 0.13, blue: 0.16), Color(red: 0.05, green: 0.06, blue: 0.07)]),
        "rust": .init(key: "rust", accent: Color(red: 0.90, green: 0.55, blue: 0.38),
                      ambient: [Color(red: 0.18, green: 0.10, blue: 0.07), Color(red: 0.08, green: 0.05, blue: 0.04)]),
        "python": .init(key: "python", accent: Color(red: 0.55, green: 0.75, blue: 0.90),
                        ambient: [Color(red: 0.09, green: 0.13, blue: 0.17), Color(red: 0.04, green: 0.06, blue: 0.08)]),
        "coding": .init(key: "coding", accent: Color(red: 0.60, green: 0.80, blue: 0.70),
                        ambient: [Color(red: 0.09, green: 0.14, blue: 0.12), Color(red: 0.04, green: 0.07, blue: 0.06)]),
        "accounting": .init(key: "accounting", accent: Color(red: 0.60, green: 0.78, blue: 0.60),
                            ambient: [Color(red: 0.10, green: 0.15, blue: 0.11), Color(red: 0.05, green: 0.07, blue: 0.05)]),
        "study": .init(key: "study", accent: Color(red: 0.80, green: 0.72, blue: 0.55),
                       ambient: [Color(red: 0.16, green: 0.14, blue: 0.10), Color(red: 0.07, green: 0.06, blue: 0.04)]),
        // 新增 21 档细分学科摄影视觉规格
        "quantum": .init(key: "quantum", accent: Color(red: 0.68, green: 0.78, blue: 0.98),
                         ambient: [Color(red: 0.09, green: 0.11, blue: 0.22), Color(red: 0.04, green: 0.05, blue: 0.12)]),
        "relativity": .init(key: "relativity", accent: Color(red: 0.95, green: 0.76, blue: 0.40),
                            ambient: [Color(red: 0.18, green: 0.12, blue: 0.06), Color(red: 0.08, green: 0.05, blue: 0.03)]),
        "optics": .init(key: "optics", accent: Color(red: 0.45, green: 0.88, blue: 0.88),
                        ambient: [Color(red: 0.06, green: 0.15, blue: 0.18), Color(red: 0.02, green: 0.06, blue: 0.09)]),
        "ocean": .init(key: "ocean", accent: Color(red: 0.38, green: 0.72, blue: 0.92),
                       ambient: [Color(red: 0.05, green: 0.12, blue: 0.20), Color(red: 0.02, green: 0.05, blue: 0.10)]),
        "meteorology": .init(key: "meteorology", accent: Color(red: 0.65, green: 0.80, blue: 0.90),
                             ambient: [Color(red: 0.10, green: 0.13, blue: 0.18), Color(red: 0.04, green: 0.06, blue: 0.09)]),
        "geology": .init(key: "geology", accent: Color(red: 0.85, green: 0.65, blue: 0.45),
                         ambient: [Color(red: 0.16, green: 0.11, blue: 0.07), Color(red: 0.07, green: 0.05, blue: 0.03)]),
        "spacecraft": .init(key: "spacecraft", accent: Color(red: 0.82, green: 0.85, blue: 0.95),
                            ambient: [Color(red: 0.11, green: 0.12, blue: 0.18), Color(red: 0.04, green: 0.04, blue: 0.07)]),
        "genetics": .init(key: "genetics", accent: Color(red: 0.40, green: 0.85, blue: 0.80),
                          ambient: [Color(red: 0.06, green: 0.15, blue: 0.16), Color(red: 0.03, green: 0.07, blue: 0.08)]),
        "ecology": .init(key: "ecology", accent: Color(red: 0.50, green: 0.82, blue: 0.55),
                         ambient: [Color(red: 0.08, green: 0.16, blue: 0.10), Color(red: 0.03, green: 0.07, blue: 0.04)]),
        "robotics": .init(key: "robotics", accent: Color(red: 0.92, green: 0.62, blue: 0.35),
                          ambient: [Color(red: 0.16, green: 0.11, blue: 0.07), Color(red: 0.07, green: 0.05, blue: 0.03)]),
        "security": .init(key: "security", accent: Color(red: 0.92, green: 0.45, blue: 0.45),
                          ambient: [Color(red: 0.18, green: 0.08, blue: 0.08), Color(red: 0.08, green: 0.04, blue: 0.04)]),
        "crypto": .init(key: "crypto", accent: Color(red: 0.75, green: 0.60, blue: 0.95),
                        ambient: [Color(red: 0.13, green: 0.09, blue: 0.19), Color(red: 0.06, green: 0.04, blue: 0.09)]),
        "database": .init(key: "database", accent: Color(red: 0.45, green: 0.78, blue: 0.85),
                          ambient: [Color(red: 0.07, green: 0.13, blue: 0.17), Color(red: 0.03, green: 0.06, blue: 0.08)]),
        "network": .init(key: "network", accent: Color(red: 0.50, green: 0.75, blue: 0.95),
                         ambient: [Color(red: 0.08, green: 0.12, blue: 0.19), Color(red: 0.03, green: 0.05, blue: 0.10)]),
        "compiler": .init(key: "compiler", accent: Color(red: 0.70, green: 0.85, blue: 0.55),
                          ambient: [Color(red: 0.11, green: 0.15, blue: 0.09), Color(red: 0.05, green: 0.07, blue: 0.04)]),
        "economy": .init(key: "economy", accent: Color(red: 0.88, green: 0.75, blue: 0.45),
                         ambient: [Color(red: 0.16, green: 0.13, blue: 0.08), Color(red: 0.07, green: 0.06, blue: 0.04)]),
        "philosophy": .init(key: "philosophy", accent: Color(red: 0.82, green: 0.80, blue: 0.75),
                            ambient: [Color(red: 0.14, green: 0.13, blue: 0.13), Color(red: 0.06, green: 0.06, blue: 0.06)]),
        "sociology": .init(key: "sociology", accent: Color(red: 0.85, green: 0.62, blue: 0.55),
                           ambient: [Color(red: 0.16, green: 0.10, blue: 0.09), Color(red: 0.07, green: 0.05, blue: 0.04)]),
        "music": .init(key: "music", accent: Color(red: 0.92, green: 0.75, blue: 0.42),
                       ambient: [Color(red: 0.17, green: 0.12, blue: 0.07), Color(red: 0.08, green: 0.05, blue: 0.03)]),
        "cognitive": .init(key: "cognitive", accent: Color(red: 0.78, green: 0.65, blue: 0.85),
                           ambient: [Color(red: 0.14, green: 0.10, blue: 0.17), Color(red: 0.06, green: 0.04, blue: 0.08)]),
        "agent": .init(key: "agent", accent: Color(red: 0.48, green: 0.82, blue: 0.90),
                       ambient: [Color(red: 0.08, green: 0.14, blue: 0.18), Color(red: 0.03, green: 0.06, blue: 0.09)])
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
        cache.countLimit = 24          // 最多缓存 24 张活跃底图，浏览时平滑换入换出
        cache.totalCostLimit = 64 * 1024 * 1024
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
