import SwiftUI
import AppKit
import KnowFlickCore

/// 卡片分享海报导出弹窗
public struct CardPosterExportSheet: View {
    public let card: KnowledgeCard
    public let onClose: () -> Void

    @State private var selectedStyle: CardPosterStyle = .editorial
    @State private var toast = ToastCenter()

    public init(card: KnowledgeCard, onClose: @escaping () -> Void) {
        self.card = card
        self.onClose = onClose
    }

    public var body: some View {
        ZStack {
            // 背景底色
            EditorialColor.canvasGradient
                .ignoresSafeArea()

            VStack(spacing: 0) {
                // 顶部标题栏与样式切换
                headerBar
                    .padding(.horizontal, 28)
                    .padding(.top, 20)
                    .padding(.bottom, 12)

                Divider().overlay(EditorialColor.glassDivider)

                // 中间海报实时缩放预览区
                previewArea
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                Divider().overlay(EditorialColor.glassDivider)

                // 底部动作按钮栏
                bottomActionBar
                    .padding(.horizontal, 28)
                    .padding(.vertical, 16)
            }

            // 浮动 HUD Toast 反馈
            VStack {
                Spacer()
                EditorialToast(center: toast)
                    .padding(.bottom, 80)
            }
            .zIndex(200)
            .animation(.spring(response: 0.28, dampingFraction: 0.8), value: toast.message)
        }
        .frame(minWidth: 700, idealWidth: 760, minHeight: 680, idealHeight: 720)
    }

    // MARK: - 顶部工具栏

    private var headerBar: some View {
        HStack(spacing: 16) {
            HStack(spacing: 10) {
                Image(systemName: "square.and.arrow.up.on.square.fill")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(EditorialColor.aiAmber)
                VStack(alignment: .leading, spacing: 2) {
                    Text("导出分享海报")
                        .font(EditorialFont.modalTitle)
                        .foregroundStyle(EditorialColor.textPrimary)
                    Text("生成出版物级排版长图或文艺相纸，可直接复制粘贴到社交平台")
                        .font(EditorialFont.captionSmall)
                        .foregroundStyle(EditorialColor.textSecondary)
                }
            }

            Spacer()

            // 风格切换分段器
            Picker("海报风格", selection: $selectedStyle) {
                ForEach(CardPosterStyle.allCases) { style in
                    Label(style.rawValue, systemImage: style.icon)
                        .tag(style)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 210)

            // 关闭按钮
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(EditorialColor.textSecondary)
                    .frame(width: 30, height: 30)
                    .background(EditorialColor.glassSurface, in: Circle())
                    .overlay(Circle().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
            }
            .buttonStyle(PressableButtonStyle())
            .keyboardShortcut(.escape, modifiers: [])
        }
    }

    // MARK: - 预览区

    private var previewArea: some View {
        GeometryReader { geo in
            let availableWidth = geo.size.width - 40
            let availableHeight = geo.size.height - 40
            let posterSize = selectedStyle.canvasSize
            let scaleX = availableWidth / posterSize.width
            let scaleY = availableHeight / posterSize.height
            let fitScale = min(min(scaleX, scaleY), 0.72)

            ZStack {
                // 背景微点网格
                Color.clear

                CardPosterRendererView(card: card, style: selectedStyle)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.12), lineWidth: 1)
                    )
                    // 复合柔光立体阴影
                    .shadow(
                        color: EditorialColor.dynamic(
                            light: NSColor.black.withAlphaComponent(0.16),
                            dark: NSColor.black.withAlphaComponent(0.65)
                        ),
                        radius: 28,
                        y: 14
                    )
                    .scaleEffect(fitScale)
                    .animation(.spring(response: 0.38, dampingFraction: 0.8), value: selectedStyle)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
    }

    // MARK: - 底部动作栏

    private var bottomActionBar: some View {
        HStack(spacing: 14) {
            // 风格说明
            HStack(spacing: 6) {
                Image(systemName: selectedStyle.icon)
                    .font(.system(size: 12))
                    .foregroundStyle(EditorialColor.textTertiary)
                Text(selectedStyle.description)
                    .font(EditorialFont.caption)
                    .foregroundStyle(EditorialColor.textTertiary)
            }

            Spacer()

            // 复制图片 (主动作)
            Button(action: copyToClipboard) {
                HStack(spacing: 7) {
                    Image(systemName: "doc.on.doc.fill")
                        .font(.system(size: 13, weight: .bold))
                    Text("复制图片 ⌘C")
                        .font(EditorialFont.label)
                }
                .foregroundStyle(Color.black.opacity(0.9))
                .padding(.horizontal, 18)
                .padding(.vertical, 10)
                .background(EditorialColor.aiAmber, in: RoundedRectangle(cornerRadius: EditorialRadius.control, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: EditorialRadius.control, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.3), lineWidth: 0.8)
                )
                .shadow(color: EditorialColor.aiAmber.opacity(0.35), radius: 8, y: 2)
            }
            .buttonStyle(PressableButtonStyle(scale: 0.97))
            .keyboardShortcut("c", modifiers: .command)

            // 保存为 PNG
            Button(action: saveToDisk) {
                HStack(spacing: 7) {
                    Image(systemName: "arrow.down.to.line.compact")
                        .font(.system(size: 13, weight: .semibold))
                    Text("保存图片 ⌘S")
                        .font(EditorialFont.label)
                }
                .foregroundStyle(EditorialColor.textPrimary)
                .padding(.horizontal, 18)
                .padding(.vertical, 10)
                .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: EditorialRadius.control, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: EditorialRadius.control, style: .continuous)
                        .strokeBorder(EditorialColor.glassBorder, lineWidth: 1)
                )
            }
            .buttonStyle(PressableButtonStyle(scale: 0.97))
            .keyboardShortcut("s", modifiers: .command)

            // 系统分享菜单
            NativeShareButton(card: card, style: selectedStyle) { message in
                toast.show(message, style: .failure)
            }
        }
    }

    // MARK: - 导出动作

    private func copyToClipboard() {
        guard let image = PosterExportManager.shared.renderImage(for: card, style: selectedStyle, scale: 2.0) else {
            toast.show("生成海报图片失败", style: .failure)
            return
        }

        let success = PosterExportManager.shared.copyToPasteboard(image: image)
        if success {
            HapticFeedbackHelper.shared.cardThresholdReached()
            toast.show("已复制到剪贴板，随时可 ⌘V 粘贴分享", style: .success)
        } else {
            toast.show("写入剪贴板失败", style: .failure)
        }
    }

    private func saveToDisk() {
        guard let image = PosterExportManager.shared.renderImage(for: card, style: selectedStyle, scale: 2.0) else {
            toast.show("生成海报图片失败", style: .failure)
            return
        }

        let safeCategory = card.category.replacingOccurrences(of: "/", with: "-")
        let safeTitle = String(card.headline.prefix(12)).replacingOccurrences(of: " ", with: "")
        let suggestedName = "KnowFlick-\(safeCategory)-\(safeTitle).png"

        PosterExportManager.shared.saveImageToDisk(image: image, suggestedFilename: suggestedName) { result in
            switch result {
            case .saved(let url):
                HapticFeedbackHelper.shared.cardThresholdReached()
                toast.show("海报已保存至 \(url.lastPathComponent)", style: .success)
            case .cancelled:
                // 用户主动取消属正常操作，不当作错误。
                toast.show("已取消保存", style: .neutral)
            case .failed(let reason):
                toast.show("保存失败：\(reason)", style: .failure)
            }
        }
    }
}

// MARK: - 原生系统分享按钮封装

private struct NativeShareButton: View {
    let card: KnowledgeCard
    let style: CardPosterStyle
    /// 渲染失败 / 无可用窗口时的失败反馈（宿主负责展示 toast）
    let onFailure: (String) -> Void

    var body: some View {
        Button(action: triggerShare) {
            Image(systemName: "square.and.arrow.up")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(EditorialColor.textSecondary)
                .frame(width: 36, height: 36)
                .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: EditorialRadius.control, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: EditorialRadius.control, style: .continuous)
                        .strokeBorder(EditorialColor.glassBorder, lineWidth: 1)
                )
        }
        .buttonStyle(PressableButtonStyle(scale: 0.97))
        .help("调用 macOS 系统分享面板")
    }

    private func triggerShare() {
        // 与复制 / 保存两处对齐：渲染失败不再静默吞掉
        guard let image = PosterExportManager.shared.renderImage(for: card, style: style, scale: 2.0) else {
            onFailure("生成海报图片失败")
            return
        }
        // 无 keyWindow 时回退 mainWindow（与 PosterExportManager / PanelPresenter 同款回退逻辑）
        guard let window = NSApp.keyWindow ?? NSApp.mainWindow, let contentView = window.contentView else {
            onFailure("当前没有可用窗口，无法唤起系统分享面板")
            return
        }
        PosterExportManager.shared.shareImage(image: image, relativeTo: .zero, of: contentView)
    }
}
