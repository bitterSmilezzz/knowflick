import SwiftUI

// MARK: - 共享 Toast（统一提示组件）
// 全应用的悬浮提示（卡组错误 / 收藏阁 / 笔记导入 / 卡片导出 / 海报导出 / 设置保存）
// 共用同一状态中心与同一视觉呈现，保证图标、语义配色、时长与关闭行为一致。

/// 单条提示的生命周期状态：消息 + 语义样式 + 自动消失倒计时。
/// 同一时刻只展示一条；重复调用 `show` 会取消上一个倒计时并整体替换内容。
@MainActor
@Observable
final class ToastCenter {
    /// 语义样式：图标与强调色由样式统一决定
    enum Style {
        case success
        case failure
        case neutral

        var icon: String {
            switch self {
            case .success: "checkmark.circle.fill"
            case .failure: "exclamationmark.triangle.fill"
            case .neutral: "info.circle.fill"
            }
        }

        var tint: Color {
            switch self {
            case .success: EditorialColor.likeGreen
            case .failure: EditorialColor.dislikeRed
            case .neutral: EditorialColor.aiAmber
            }
        }
    }

    private(set) var message: String?
    private(set) var style: Style = .success
    /// 每次展示自增，供调用方区分「同文案的两次展示」
    private(set) var generation = 0
    private var dismissTask: Task<Void, Never>?

    /// 展示一条提示：取消旧倒计时，到 `duration` 后自动消失。
    func show(_ message: String, style: Style = .success, duration: Duration = .seconds(2.5)) {
        dismissTask?.cancel()
        self.message = message
        self.style = style
        generation += 1
        dismissTask = Task { [weak self] in
            guard let self, !Task.isCancelled else { return }
            try? await Task.sleep(for: duration)
            guard !Task.isCancelled else { return }
            self.dismiss()
        }
    }

    /// 立即收起当前提示（关闭按钮与倒计时到点共用此入口）。
    func dismiss() {
        dismissTask?.cancel()
        dismissTask = nil
        message = nil
    }
}

/// 统一提示胶囊：语义色图标 + 文案 + 关闭按钮，磨砂玻璃底、语义描边。
/// 渲染位置由调用方决定（常见为 `.overlay(alignment: .top/.bottom)`）。
struct EditorialToast: View {
    let center: ToastCenter

    var body: some View {
        if let message = center.message {
            HStack(spacing: 8) {
                Image(systemName: center.style.icon)
                    .foregroundStyle(center.style.tint)
                Text(message)
                    .lineLimit(2)
                Button {
                    center.dismiss()
                } label: {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.plain)
                .accessibilityLabel("关闭提示")
            }
            .font(.callout)
            .foregroundStyle(EditorialColor.textPrimary)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(EditorialColor.glassSurface, in: Capsule())
            .overlay(Capsule().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
        }
    }
}
