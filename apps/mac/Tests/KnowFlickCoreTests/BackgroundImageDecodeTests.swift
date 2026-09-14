import Foundation
import ImageIO
import Testing
@testable import KnowFlickCore

/// 底图 WebP 解码回归。
///
/// mac 端底图以 WebP 存放（体积明显小于 PNG）。加载主路径是 `CategoryTheme.downsampledImage`
/// 里的 ImageIO 缩略解码，失败时才回退到 `NSImage(contentsOf:)`——回退本身不可靠，
/// 因此这条主路径必须对所有底图都成立。
///
/// 这里逐个解码全部底图并要求出真实像素：若底图编码格式或系统解码支持发生变化，
/// 会在这里失败，而不是变成用户看到的空白背景。
struct BackgroundImageDecodeTests {

    /// 与 `CategoryTheme.downsampledImage` 保持一致的解码选项
    private let thumbnailOptions: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceShouldCacheImmediately: true,
        kCGImageSourceThumbnailMaxPixelSize: CGFloat(1024)
    ]

    private func backgroundURLs() throws -> [URL] {
        // SwiftPM 的 .process 会把 Resources/bg/ 展平到 bundle 的 Contents/Resources 根下，
        // 因此这里按扩展名枚举，与 BackgroundImageCache 的取法保持一致。
        let urls = CoreResources.bundle.urls(forResourcesWithExtension: "webp", subdirectory: nil) ?? []
        try #require(urls.isEmpty == false, "资源 bundle 内找不到任何 webp 底图")
        return urls.sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    @Test func allBackgroundsDecodeThroughImageIO() throws {
        let files = try backgroundURLs()
        #expect(files.count == 42, "底图数量应为 42，实际 \(files.count)")

        var failures: [String] = []
        for url in files {
            guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                  CGImageSourceGetCount(source) > 0,
                  let image = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbnailOptions as CFDictionary),
                  image.width > 0, image.height > 0 else {
                failures.append(url.lastPathComponent)
                continue
            }
            // 确认位图真的可以取到像素数据，而不只是元数据
            guard let data = image.dataProvider?.data, CFDataGetLength(data) > 0 else {
                failures.append("\(url.lastPathComponent)（无像素数据）")
                continue
            }
        }

        #expect(failures.isEmpty, "以下底图无法通过 ImageIO 解码：\(failures.joined(separator: "、"))")
    }

    @Test func thumbnailDecodeDownsamplesToMaxPixelSize() throws {
        // 原图 1000×1450；限制最大边长 1024 后长边应缩到 1024 附近，而不是原样返回，
        // 否则「不全量解压原图」的优化名不副实。
        let files = try backgroundURLs()
        let url = try #require(files.first)
        let source = try #require(CGImageSourceCreateWithURL(url as CFURL, nil))
        let image = try #require(CGImageSourceCreateThumbnailAtIndex(source, 0, thumbnailOptions as CFDictionary))
        #expect(max(image.width, image.height) <= 1024,
                "缩略图长边应不超过 1024，实际 \(image.width)×\(image.height)")
        #expect(max(image.width, image.height) >= 512,
                "缩略图长边过小，可能解码异常：\(image.width)×\(image.height)")
    }
}
