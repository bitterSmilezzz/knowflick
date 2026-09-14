import Foundation

/// 跨 target 暴露 KnowFlickCore 的资源 bundle（分类背景图 / seed_cards.json）。
///
/// 这里不直接用 `Bundle.module`：SwiftPM 生成的访问器在不同工具链下候选路径不同，
/// 而资源 bundle 只能放在 `.app/Contents/Resources`——放到 `.app` 根目录会破坏代码签名
/// （`unsealed contents present in the bundle root`）。实测：
/// - CLT 27（本地）：候选含 `Bundle.main.resourceURL`，能命中 Contents/Resources；
/// - Xcode 26.3（CI）：候选只有 `Bundle.main.bundleURL` 与编译期 `.build` 路径，
///   在 Contents/Resources 布局下找不到，直接 `fatalError: could not load resource bundle`。
///
/// 因此自行按多个候选位置查找，两种工具链构建的产物都能加载。
public enum CoreResources {

    /// 资源 bundle 名（SwiftPM 命名规则：`<Package>_<Target>`）
    private static let bundleName = "KnowFlick_KnowFlickCore"

    private final class BundleFinder {}

    public static let bundle: Bundle = locate()

    private static func locate() -> Bundle {
        var candidates: [URL] = []
        // .app 内的标准位置：打包脚本把资源 bundle 放在 Contents/Resources
        if let resourceURL = Bundle.main.resourceURL { candidates.append(resourceURL) }
        // 命令行工具 / 部分工具链场景
        candidates.append(Bundle.main.bundleURL)
        // 以 framework 形式链接时
        if let frameworkResource = Bundle(for: BundleFinder.self).resourceURL {
            candidates.append(frameworkResource)
        }

        for candidate in candidates {
            let url = candidate.appendingPathComponent(bundleName + ".bundle")
            if let bundle = Bundle(url: url) { return bundle }
        }
        // 回退到 SwiftPM 的默认实现：资源确实缺失时，它会给出与原先一致的错误信息
        return Bundle.module
    }
}
