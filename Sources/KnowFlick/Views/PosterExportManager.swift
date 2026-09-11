import SwiftUI
import AppKit
import UniformTypeIdentifiers
import KnowFlickCore

/// 海报落盘结果：区分「已保存 / 用户取消 / 保存失败」三态。
/// 失败与取消此前共用 `false`，导致界面上真实失败完全静默、也无法给出失败态提示。
public enum PosterSaveResult: Sendable {
    case saved(URL)
    case cancelled
    case failed(String)
}

@MainActor
public final class PosterExportManager {
    public static let shared = PosterExportManager()

    private init() {}

    /// 离屏渲染海报为高清 NSImage (默认 scale: 2.0，输出 1080×1520 等高清图)
    public func renderImage(for card: KnowledgeCard, style: CardPosterStyle, scale: CGFloat = 2.0) -> NSImage? {
        let posterView = CardPosterRendererView(card: card, style: style)
        let renderer = ImageRenderer(content: posterView)
        renderer.scale = scale
        return renderer.nsImage
    }

    /// 复制图片到 macOS 系统剪贴板
    @discardableResult
    public func copyToPasteboard(image: NSImage) -> Bool {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()

        // 写入对象并同时保证 TIFF / PNG 数据在剪贴板中可用
        var success = pasteboard.writeObjects([image])

        if let tiff = image.tiffRepresentation,
           let bitmap = NSBitmapImageRep(data: tiff),
           let pngData = bitmap.representation(using: .png, properties: [:]) {
            pasteboard.setData(pngData, forType: .png)
            success = true
        }

        return success
    }

    /// 弹出 NSSavePanel 保存为本地 PNG 文件
    /// - Parameter completion: 回传三态结果，调用方据此区分成功、用户取消与真实失败。
    public func saveImageToDisk(
        image: NSImage,
        suggestedFilename: String,
        window: NSWindow? = nil,
        completion: @escaping (PosterSaveResult) -> Void
    ) {
        guard let tiff = image.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff),
              let pngData = bitmap.representation(using: .png, properties: [:]) else {
            completion(.failed("海报 PNG 编码失败"))
            return
        }

        let savePanel = NSSavePanel()
        savePanel.allowedContentTypes = [UTType.png]
        savePanel.canCreateDirectories = true
        savePanel.isExtensionHidden = false
        savePanel.nameFieldStringValue = suggestedFilename.hasSuffix(".png") ? suggestedFilename : "\(suggestedFilename).png"
        savePanel.title = "导出知识卡片海报"
        savePanel.prompt = "保存"

        let targetWindow = window ?? NSApp.keyWindow ?? NSApp.mainWindow

        let handleResponse: (NSApplication.ModalResponse) -> Void = { response in
            if response == .OK, let url = savePanel.url {
                do {
                    try pngData.write(to: url, options: .atomic)
                    completion(.saved(url))
                } catch {
                    NSLog("KnowFlick: 保存海报失败: %@", error.localizedDescription)
                    completion(.failed(error.localizedDescription))
                }
            } else {
                // 用户在 NSSavePanel 点「取消」：中性结果，不当作失败报错。
                completion(.cancelled)
            }
        }

        if let win = targetWindow {
            savePanel.beginSheetModal(for: win, completionHandler: handleResponse)
        } else {
            savePanel.begin(completionHandler: handleResponse)
        }
    }

    /// 唤起 macOS 原生系统分享菜单 (AirDrop / 邮件 / 备忘录 / 信息 等)
    public func shareImage(image: NSImage, relativeTo rect: NSRect, of view: NSView) {
        let picker = NSSharingServicePicker(items: [image])
        picker.show(relativeTo: rect, of: view, preferredEdge: .minY)
    }
}
