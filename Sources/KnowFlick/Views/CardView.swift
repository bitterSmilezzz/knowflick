import SwiftUI
import AppKit
import KnowFlickCore

/// 单张知识卡片（正面）：分类摄影背景图 + 衬线大标题
struct CardView: View {
    let card: KnowledgeCard
    let showAIMark: Bool   // 设置：显示 AI 内容标记
    var speechService: SpeechSynthesizerService = .shared
    var isTop: Bool = false
    var dragOffset: CGSize = .zero
    var triggerSheen: Bool = false

    @State private var hovering = false

    private var theme: CategoryTheme {
        CategoryTheme.theme(for: card, cache: .shared)
    }

    var body: some View {
        // 前景内容层（决定布局），背景图放 .background 不参与布局
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                categoryBadge
                sourceMark
                Spacer()
                if isTop {
                    speechButton
                }
            }

            Spacer(minLength: 20)

            ViewThatFits(in: .vertical) {
                readingContent
                ScrollView { readingContent }
            }

        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
        .background(backgroundLayer)
        .overlay(
            CardSheenOverlay(isTop: isTop, dragOffset: dragOffset, triggerPulse: triggerSheen)
        )
        .clipShape(RoundedRectangle(cornerRadius: EditorialRadius.card, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: EditorialRadius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: EditorialRadius.card, style: .continuous)
                .strokeBorder(hovering ? EditorialColor.glassBorderHover : EditorialColor.glassBorder, lineWidth: 1.2)
        )
        // 多层复合软阴影（近距接触阴影 + 广域纸张漫反射 + 深邃层次）
        .shadow(
            color: EditorialColor.dynamic(
                light: NSColor.black.withAlphaComponent(0.06),
                dark: NSColor.black.withAlphaComponent(0.40)
            ),
            radius: 4,
            y: 2
        )
        .shadow(
            color: EditorialColor.dynamic(
                light: NSColor.black.withAlphaComponent(0.12),
                dark: NSColor.black.withAlphaComponent(0.65)
            ),
            radius: 22,
            y: 10
        )
        .shadow(
            color: EditorialColor.dynamic(
                light: NSColor.black.withAlphaComponent(0.04),
                dark: NSColor.black.withAlphaComponent(0.25)
            ),
            radius: 40,
            y: 18
        )
        .onHover { hovering = $0 }
    }

    private var readingContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            // 衬线大标题
            Text(card.headline)
                .font(EditorialFont.heroHeadline)
                .foregroundStyle(EditorialColor.cardTextPrimary)
                .lineSpacing(7.5)
                .lineLimit(nil)
                .allowsTightening(true)
                .minimumScaleFactor(0.72)
                .shadow(color: .black.opacity(0.65), radius: 10, y: 3)
                .fixedSize(horizontal: false, vertical: true)

            Rectangle()
                .fill(theme.accent)
                .frame(width: 36, height: 3.5)
                .cornerRadius(1.75)
                .padding(.top, 16)
                .padding(.bottom, 14)

            Text(card.summary)
                .font(EditorialFont.summarySerif)
                .foregroundStyle(EditorialColor.cardTextSecondary)
                .lineSpacing(5.5)
                .lineLimit(nil)
                .allowsTightening(true)
                .minimumScaleFactor(0.82)
                .fixedSize(horizontal: false, vertical: true)
                .shadow(color: .black.opacity(0.55), radius: 6, y: 1.5)

            HStack {
                Label("详情", systemImage: "arrow.up.left.and.arrow.down.right")
                    .font(EditorialFont.caption.weight(.semibold))
                    .foregroundStyle(EditorialColor.cardTextTertiary)
                Spacer()
                Text("拖动换一张")
                    .font(EditorialFont.caption)
                    .foregroundStyle(EditorialColor.cardTextMuted)
            }
            .padding(.top, 24)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: - 背景层（不参与前景布局）

    @ViewBuilder
    private var backgroundLayer: some View {
        GeometryReader { geo in
            ZStack {
                if let img = theme.image {
                    Image(nsImage: img)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(width: geo.size.width, height: geo.size.height)
                        .clipped()
                } else {
                    LinearGradient(colors: theme.ambient, startPoint: .top, endPoint: .bottom)
                }

                // 多阶非线性动态遮罩
                DynamicScrimOverlay()
            }
        }
    }

    // MARK: - 出版物印章徽标（微图标 + 分类名 + 领域代码）
    private var categoryBadge: some View {
        HStack(spacing: 5) {
            Image(systemName: theme.iconName)
                .font(.system(size: 10.5, weight: .bold))
            Text(card.category)
                .font(EditorialFont.badge)
                .tracking(0.8)
                .lineLimit(1)
                .minimumScaleFactor(0.78)
            Text("·")
                .font(.system(size: 9.5, weight: .heavy))
                .opacity(0.6)
            Text(theme.domainCode)
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .tracking(1.0)
                .opacity(0.92)
        }
        .foregroundStyle(Color.black.opacity(0.88))
        .padding(.horizontal, 11)
        .padding(.vertical, 5.5)
        .background(theme.accent, in: Capsule())
        .overlay(
            Capsule()
                .strokeBorder(Color.white.opacity(0.38), lineWidth: 0.8)
        )
        .shadow(color: theme.accent.opacity(0.38), radius: 8, y: 2)
    }

    /// 来源标记：AI 卡显示醒目的橙色徽章（可按设置隐藏）；精选卡保持低调
    @ViewBuilder
    private var sourceMark: some View {
        if card.source == .ai {
            if showAIMark {
                Label("AI 生成", systemImage: "sparkles")
                    .font(EditorialFont.caption.weight(.bold))
                    .foregroundStyle(EditorialColor.aiAmber)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(EditorialColor.aiAmberBg, in: Capsule())
                    .overlay(Capsule().strokeBorder(EditorialColor.aiAmberBorder, lineWidth: 1))
            }
        } else {
            HStack(spacing: 5) {
                Circle()
                    .fill(Color.white.opacity(0.6))
                    .frame(width: 5, height: 5)
                Text(card.source == .imported ? "导入笔记" : "精选")
                    .font(EditorialFont.caption)
                    .foregroundStyle(Color.white.opacity(0.85))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Color.black.opacity(0.35), in: Capsule())
            .overlay(Capsule().strokeBorder(EditorialColor.glassBorder, lineWidth: 0.8))
        }
    }

    // MARK: - 语音朗读胶囊按键
    private var speechButton: some View {
        let service = speechService
        let isSpeakingThis = service.state.activeCardId == card.id && service.state.isPlaying
        let isPausedThis = service.state.activeCardId == card.id && service.state.isPaused

        return Button {
            service.togglePlayPause(for: card)
            HapticFeedbackHelper.shared.cardSnapBack()
        } label: {
            HStack(spacing: 4) {
                Image(systemName: isSpeakingThis ? "speaker.wave.3.fill" : (isPausedThis ? "speaker.slash.fill" : "speaker.wave.2"))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(isSpeakingThis ? EditorialColor.likeGreen : Color.white.opacity(0.85))

                if isSpeakingThis {
                    Text("\(Int(service.state.progress * 100))%")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundStyle(EditorialColor.likeGreen)
                }
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(
                isSpeakingThis ? EditorialColor.likeGreen.opacity(0.18) : Color.black.opacity(0.35),
                in: Capsule()
            )
            .overlay(
                Capsule()
                    .strokeBorder(
                        isSpeakingThis ? EditorialColor.likeGreen.opacity(0.5) : EditorialColor.glassBorder,
                        lineWidth: 1
                    )
            )
        }
        .buttonStyle(PressableButtonStyle())
        .help(isSpeakingThis ? "暂停朗读 (⌘P)" : "朗读此卡片观点 (⌘P)")
        .accessibilityLabel(isSpeakingThis ? "暂停朗读" : (isPausedThis ? "继续朗读" : "朗读此卡片观点"))
        .accessibilityValue(isSpeakingThis ? "进度 \(Int(service.state.progress * 100))%" : "")
    }
}
