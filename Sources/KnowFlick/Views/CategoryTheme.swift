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

    /// 视觉资源键的有序列表（供自定义分类稳定哈希索引）
    private static let specOrder: [String] = [
        "physics", "biology", "astronomy", "math", "chemistry", "history", "psychology",
        "neuroscience", "language", "tech", "life", "geography", "ai", "algorithm",
        "datastructure", "architecture", "rust", "python", "coding", "accounting", "study"
    ]

    /// 自定义分类 → 稳定映射到某个内置视觉资源（同一分类每次同图同色）
    private static func hashedSpec(for name: String) -> Spec {
        var h = 0
        for scalar in name.unicodeScalars {
            h = (h &* 31 &+ Int(scalar.value)) & 0x7fffffff
        }
        let key = specOrder[h % specOrder.count]
        return specs.values.first { $0.key == key } ?? fallbackSpec
    }

    /// 分类名 → 主题（含预加载的背景图）。
    /// 内置「冷知识」用专属主题；自定义分类按名字稳定哈希到内置视觉资源
    @MainActor
    static func theme(for category: String, cache: BackgroundImageCache) -> CategoryTheme {
        let spec: Spec
        if category == CategoryRegistry.builtinCategory {
            spec = builtinSpec
        } else if let s = specs[category] {
            spec = s   // 兼容旧卡（物理/生物等历史分类名）
        } else {
            spec = hashedSpec(for: category)
        }
        return CategoryTheme(category: category, image: cache.image(named: spec.key), accent: spec.accent, ambient: spec.ambient)
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
