import SwiftUI
import AppKit

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

    /// 分类名 → 主题（含预加载的背景图）
    @MainActor
    static func theme(for category: String, cache: BackgroundImageCache) -> CategoryTheme {
        guard let spec = specs[category] else {
            // 未知分类（AI 新分类）→ 按归组映射
            let group = fallbackGroup(category)
            if let s = specs[group] {
                return CategoryTheme(category: category, image: cache.image(named: group), accent: s.accent, ambient: s.ambient)
            }
            return .empty
        }
        return CategoryTheme(category: category, image: cache.image(named: spec.key), accent: spec.accent, ambient: spec.ambient)
    }

    private static func fallbackGroup(_ category: String) -> String {
        switch category {
        case "脑科学": return "neuroscience"
        case "物理", "化学", "数学", "生物", "天文", "历史", "心理", "语言", "科技", "生活", "地理": return category
        default: return "tech"
        }
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
    ]
}

/// 背景图缓存：从资源 bundle 懒加载 NSImage，避免占内存
@MainActor
final class BackgroundImageCache {
    static let shared = BackgroundImageCache()
    private var cache: [String: NSImage] = [:]

    func image(named key: String) -> NSImage? {
        if let hit = cache[key] { return hit }
        guard let url = Bundle.module.url(forResource: key, withExtension: "jpg", subdirectory: nil)
                ?? Bundle.module.urls(forResourcesWithExtension: "jpg", subdirectory: nil)?.first(where: { $0.lastPathComponent == "\(key).jpg" }) else {
            return nil
        }
        guard let img = NSImage(contentsOf: url) else { return nil }
        cache[key] = img
        return img
    }
}
