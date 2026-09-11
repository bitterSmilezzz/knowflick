import AppKit

/// 面板呈现统一入口：无 key 窗口时回退为普通模态打开，
/// 避免 `?? NSWindow()` 把面板挂到看不见的空白窗口（表现为「点了没反应」）。
@MainActor
enum PanelPresenter {
    static func present(
        _ panel: NSSavePanel,
        in window: NSWindow?,
        completionHandler: @escaping (NSApplication.ModalResponse) -> Void
    ) {
        if let window {
            panel.beginSheetModal(for: window, completionHandler: completionHandler)
        } else {
            panel.begin(completionHandler: completionHandler)
        }
    }
}
