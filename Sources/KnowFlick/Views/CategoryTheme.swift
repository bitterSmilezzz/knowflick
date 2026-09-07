import SwiftUI
import AppKit
import KnowFlickCore

/// 分类视觉主题：背景图 + 主色 + ambient 色温（自动适配深色与浅色模式）
struct CategoryTheme {
    let category: String
    let image: NSImage?
    let accent: Color        // 主色（标签、点缀）
    let ambient: [Color]     // 窗口背景 ambient 渐变（取自图片色温，支持深浅色自适应）
    let iconName: String     // 出版物印章 SF Symbol
    let domainCode: String   // 领域代号（如 PHY, BIO, AI, ACC）

    static let empty = CategoryTheme(
        category: "",
        image: nil,
        accent: Color(red: 0.55, green: 0.58, blue: 0.65),
        ambient: [EditorialColor.canvasGradientTop, EditorialColor.canvasGradientBottom],
        iconName: "book.pages.fill",
        domainCode: "KNOW"
    )

    private static func dynamicColor(light: NSColor, dark: NSColor) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let match = appearance.bestMatch(from: [.darkAqua, .aqua])
            return match == .darkAqua ? dark : light
        })
    }

    private static func makeAmbient(
        darkTop: (CGFloat, CGFloat, CGFloat),
        darkBottom: (CGFloat, CGFloat, CGFloat),
        accent: (CGFloat, CGFloat, CGFloat)
    ) -> [Color] {
        let darkT = NSColor(red: darkTop.0, green: darkTop.1, blue: darkTop.2, alpha: 1.0)
        let darkB = NSColor(red: darkBottom.0, green: darkBottom.1, blue: darkBottom.2, alpha: 1.0)
        let lightT = NSColor(
            red: min(0.99, 0.945 + accent.0 * 0.04),
            green: min(0.99, 0.945 + accent.1 * 0.04),
            blue: min(0.99, 0.945 + accent.2 * 0.04),
            alpha: 1.0
        )
        let lightB = NSColor(red: 0.925, green: 0.935, blue: 0.955, alpha: 1.0)
        return [
            dynamicColor(light: lightT, dark: darkT),
            dynamicColor(light: lightB, dark: darkB)
        ]
    }

    private static func spec(_ key: String, icon: String, code: String, r: CGFloat, g: CGFloat, b: CGFloat, dtR: CGFloat, dtG: CGFloat, dtB: CGFloat, dbR: CGFloat, dbG: CGFloat, dbB: CGFloat) -> Spec {
        let accent = Color(red: r, green: g, blue: b)
        let ambient = makeAmbient(darkTop: (dtR, dtG, dtB), darkBottom: (dbR, dbG, dbB), accent: (r, g, b))
        return Spec(key: key, accent: accent, ambient: ambient, iconName: icon, domainCode: code)
    }

    /// 未知分类（AI 新分类）统一回退到 tech 主题
    private static let fallbackSpec = spec("tech", icon: "sparkles", code: "AI", r: 0.45, g: 0.75, b: 0.90, dtR: 0.08, dtG: 0.13, dtB: 0.18, dbR: 0.03, dbG: 0.06, dbB: 0.09)

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
        let code = spec.domainCode
        return CategoryTheme(
            category: category,
            image: imageCache.image(named: spec.key),
            accent: spec.accent,
            ambient: spec.ambient,
            iconName: spec.iconName,
            domainCode: code
        )
    }

    private struct Spec {
        let key: String
        let accent: Color
        let ambient: [Color]
        let iconName: String
        let domainCode: String
    }

    /// 42 种视觉底图的视觉规格表（以 key 为键，O(1) 索引）
    private static let specs: [String: Spec] = [
        "physics": spec("physics", icon: "atom", code: "PHY", r: 0.98, g: 0.72, b: 0.35, dtR: 0.16, dtG: 0.13, dtB: 0.10, dbR: 0.05, dbG: 0.05, dbB: 0.06),
        "biology": spec("biology", icon: "leaf.fill", code: "BIO", r: 0.35, g: 0.80, b: 0.85, dtR: 0.07, dtG: 0.16, dtB: 0.19, dbR: 0.03, dbG: 0.07, dbB: 0.09),
        "astronomy": spec("astronomy", icon: "moon.stars.fill", code: "ASTRO", r: 0.62, g: 0.72, b: 0.95, dtR: 0.09, dtG: 0.10, dtB: 0.22, dbR: 0.03, dbG: 0.04, dbB: 0.10),
        "math": spec("math", icon: "function", code: "MATH", r: 0.55, g: 0.75, b: 0.60, dtR: 0.10, dtG: 0.15, dtB: 0.12, dbR: 0.04, dbG: 0.07, dbB: 0.06),
        "chemistry": spec("chemistry", icon: "flask.fill", code: "CHEM", r: 0.55, g: 0.85, b: 0.75, dtR: 0.08, dtG: 0.17, dtB: 0.15, dbR: 0.03, dbG: 0.08, dbB: 0.07),
        "history": spec("history", icon: "hourglass", code: "HIST", r: 0.85, g: 0.68, b: 0.48, dtR: 0.17, dtG: 0.13, dtB: 0.09, dbR: 0.07, dbG: 0.06, dbB: 0.05),
        "psychology": spec("psychology", icon: "brain.head.profile", code: "PSYC", r: 0.80, g: 0.62, b: 0.70, dtR: 0.16, dtG: 0.11, dtB: 0.14, dbR: 0.07, dbG: 0.05, dbB: 0.07),
        "neuroscience": spec("neuroscience", icon: "brain.fill", code: "NEURO", r: 0.85, g: 0.55, b: 0.55, dtR: 0.17, dtG: 0.10, dtB: 0.11, dbR: 0.08, dbG: 0.05, dbB: 0.06),
        "language": spec("language", icon: "text.quote", code: "LANG", r: 0.70, g: 0.75, b: 0.55, dtR: 0.13, dtG: 0.15, dtB: 0.09, dbR: 0.06, dbG: 0.07, dbB: 0.04),
        "tech": spec("tech", icon: "cpu", code: "TECH", r: 0.45, g: 0.75, b: 0.90, dtR: 0.08, dtG: 0.13, dtB: 0.18, dbR: 0.03, dbG: 0.06, dbB: 0.09),
        "life": spec("life", icon: "cup.and.saucer.fill", code: "LIFE", r: 0.90, g: 0.70, b: 0.50, dtR: 0.16, dtG: 0.12, dtB: 0.08, dbR: 0.07, dbG: 0.05, dbB: 0.04),
        "geography": spec("geography", icon: "globe.asia.australia.fill", code: "GEO", r: 0.60, g: 0.80, b: 0.65, dtR: 0.09, dtG: 0.15, dtB: 0.12, dbR: 0.04, dbG: 0.07, dbB: 0.06),
        "ai": spec("ai", icon: "sparkles", code: "AI", r: 0.62, g: 0.70, b: 0.95, dtR: 0.10, dtG: 0.11, dtB: 0.20, dbR: 0.04, dbG: 0.05, dbB: 0.10),
        "algorithm": spec("algorithm", icon: "point.topleft.down.to.point.bottomright.curvepath", code: "ALGO", r: 0.50, g: 0.80, b: 0.80, dtR: 0.07, dtG: 0.14, dtB: 0.15, dbR: 0.03, dbG: 0.06, dbB: 0.07),
        "datastructure": spec("datastructure", icon: "square.stack.3d.up.fill", code: "DS", r: 0.55, g: 0.75, b: 0.90, dtR: 0.08, dtG: 0.12, dtB: 0.16, dbR: 0.04, dbG: 0.06, dbB: 0.08),
        "architecture": spec("architecture", icon: "building.columns.fill", code: "ARCH", r: 0.75, g: 0.78, b: 0.85, dtR: 0.12, dtG: 0.13, dtB: 0.16, dbR: 0.05, dbG: 0.06, dbB: 0.07),
        "rust": spec("rust", icon: "gearshape.2.fill", code: "RUST", r: 0.90, g: 0.55, b: 0.38, dtR: 0.18, dtG: 0.10, dtB: 0.07, dbR: 0.08, dbG: 0.05, dbB: 0.04),
        "python": spec("python", icon: "chevron.left.forwardslash.chevron.right", code: "PY", r: 0.55, g: 0.75, b: 0.90, dtR: 0.09, dtG: 0.13, dtB: 0.17, dbR: 0.04, dbG: 0.06, dbB: 0.08),
        "coding": spec("coding", icon: "terminal.fill", code: "DEV", r: 0.60, g: 0.80, b: 0.70, dtR: 0.09, dtG: 0.14, dtB: 0.12, dbR: 0.04, dbG: 0.07, dbB: 0.06),
        "accounting": spec("accounting", icon: "doc.plaintext.fill", code: "ACC", r: 0.60, g: 0.78, b: 0.60, dtR: 0.10, dtG: 0.15, dtB: 0.11, dbR: 0.05, dbG: 0.07, dbB: 0.05),
        "study": spec("study", icon: "book.pages.fill", code: "KNOW", r: 0.80, g: 0.72, b: 0.55, dtR: 0.16, dtG: 0.14, dtB: 0.10, dbR: 0.07, dbG: 0.06, dbB: 0.04),
        "quantum": spec("quantum", icon: "waveform.path.ecg", code: "QUANT", r: 0.68, g: 0.78, b: 0.98, dtR: 0.09, dtG: 0.11, dtB: 0.22, dbR: 0.04, dbG: 0.05, dbB: 0.12),
        "relativity": spec("relativity", icon: "speedometer", code: "REL", r: 0.95, g: 0.76, b: 0.40, dtR: 0.18, dtG: 0.12, dtB: 0.06, dbR: 0.08, dbG: 0.05, dbB: 0.03),
        "optics": spec("optics", icon: "sun.max.fill", code: "OPT", r: 0.45, g: 0.88, b: 0.88, dtR: 0.06, dtG: 0.15, dtB: 0.18, dbR: 0.02, dbG: 0.06, dbB: 0.09),
        "ocean": spec("ocean", icon: "water.waves", code: "OCEAN", r: 0.38, g: 0.72, b: 0.92, dtR: 0.05, dtG: 0.12, dtB: 0.20, dbR: 0.02, dbG: 0.05, dbB: 0.10),
        "meteorology": spec("meteorology", icon: "cloud.sun.rain.fill", code: "METEO", r: 0.65, g: 0.80, b: 0.90, dtR: 0.10, dtG: 0.13, dtB: 0.18, dbR: 0.04, dbG: 0.06, dbB: 0.09),
        "geology": spec("geology", icon: "mountain.2.fill", code: "GEOL", r: 0.85, g: 0.65, b: 0.45, dtR: 0.16, dtG: 0.11, dtB: 0.07, dbR: 0.07, dbG: 0.05, dbB: 0.03),
        "spacecraft": spec("spacecraft", icon: "airplane.departure", code: "AERO", r: 0.82, g: 0.85, b: 0.95, dtR: 0.11, dtG: 0.12, dtB: 0.18, dbR: 0.04, dbG: 0.04, dbB: 0.07),
        "genetics": spec("genetics", icon: "dials.fill", code: "GENE", r: 0.40, g: 0.85, b: 0.80, dtR: 0.06, dtG: 0.15, dtB: 0.16, dbR: 0.03, dbG: 0.07, dbB: 0.08),
        "ecology": spec("ecology", icon: "tree.fill", code: "ECOL", r: 0.50, g: 0.82, b: 0.55, dtR: 0.08, dtG: 0.16, dtB: 0.10, dbR: 0.03, dbG: 0.07, dbB: 0.04),
        "robotics": spec("robotics", icon: "gearshape.arrow.triangle.2.circlepath", code: "ROBO", r: 0.92, g: 0.62, b: 0.35, dtR: 0.16, dtG: 0.11, dtB: 0.07, dbR: 0.07, dbG: 0.05, dbB: 0.03),
        "security": spec("security", icon: "shield.checkerboard", code: "SEC", r: 0.92, g: 0.45, b: 0.45, dtR: 0.18, dtG: 0.08, dtB: 0.08, dbR: 0.08, dbG: 0.04, dbB: 0.04),
        "crypto": spec("crypto", icon: "link.circle.fill", code: "CRYPT", r: 0.75, g: 0.60, b: 0.95, dtR: 0.13, dtG: 0.09, dtB: 0.19, dbR: 0.06, dbG: 0.04, dbB: 0.09),
        "database": spec("database", icon: "cylinder.split.1x2.fill", code: "DB", r: 0.45, g: 0.78, b: 0.85, dtR: 0.07, dtG: 0.13, dtB: 0.17, dbR: 0.03, dbG: 0.06, dbB: 0.08),
        "network": spec("network", icon: "network", code: "NET", r: 0.50, g: 0.75, b: 0.95, dtR: 0.08, dtG: 0.12, dtB: 0.19, dbR: 0.03, dbG: 0.05, dbB: 0.10),
        "compiler": spec("compiler", icon: "character.cursor.ibeam", code: "COMP", r: 0.70, g: 0.85, b: 0.55, dtR: 0.11, dtG: 0.15, dtB: 0.09, dbR: 0.05, dbG: 0.07, dbB: 0.04),
        "economy": spec("economy", icon: "chart.line.uptrend.xyaxis", code: "ECON", r: 0.88, g: 0.75, b: 0.45, dtR: 0.16, dtG: 0.13, dtB: 0.08, dbR: 0.07, dbG: 0.06, dbB: 0.04),
        "philosophy": spec("philosophy", icon: "lightbulb.fill", code: "PHIL", r: 0.82, g: 0.80, b: 0.75, dtR: 0.14, dtG: 0.13, dtB: 0.13, dbR: 0.06, dbG: 0.06, dbB: 0.06),
        "sociology": spec("sociology", icon: "person.3.sequence.fill", code: "SOC", r: 0.85, g: 0.62, b: 0.55, dtR: 0.16, dtG: 0.10, dtB: 0.09, dbR: 0.07, dbG: 0.05, dbB: 0.04),
        "music": spec("music", icon: "waveform.path", code: "SONIC", r: 0.92, g: 0.75, b: 0.42, dtR: 0.17, dtG: 0.12, dtB: 0.07, dbR: 0.08, dbG: 0.05, dbB: 0.03),
        "cognitive": spec("cognitive", icon: "eye.fill", code: "COGN", r: 0.78, g: 0.65, b: 0.85, dtR: 0.14, dtG: 0.10, dtB: 0.17, dbR: 0.06, dbG: 0.04, dbB: 0.08),
        "agent": spec("agent", icon: "person.crop.circle.badge.checkmark", code: "AGENT", r: 0.48, g: 0.82, b: 0.90, dtR: 0.08, dtG: 0.14, dtB: 0.18, dbR: 0.03, dbG: 0.06, dbB: 0.09)
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
