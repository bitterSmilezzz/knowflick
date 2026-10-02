import SwiftUI
import KnowFlickCore

// MARK: - 摄影底图 × Cutline 结构的知识卡片
//
// 结构依据：`.scratch/ui-material/05_HTCuOh3aoAA4Qv0.png`（Cutline）的徽章行 / 排版层级；
// 底图保留旧 Editorial 体系的 42 张分类摄影大图（用户裁定：照片是产品个性，撤掉即「图片不显示」）。
//   · 整卡摄影底图 + 多阶暗化 scrim，白字排版
//   · 顶部徽章行：分类 / AI 标记 / 朗读胶囊 / 领域代码
//   · 底部：标题 + 摘要 + 元信息；`isTop` 时附加操作提示行

/// 单张知识卡片：摄影底图 + 白字排版。
/// `isTop` 时显示操作提示行，供刷卡视图复用；
/// 传入 `speechService` 时在徽章行提供朗读胶囊按键（旧 CardView 的等价物）。
struct InsightCardView: View {
    let card: KnowledgeCard
    var showAIMark: Bool = true
    var isTop: Bool = false
    var speechService: SpeechSynthesizerService? = nil

    private var theme: CategoryTheme {
        CategoryTheme.theme(for: card, cache: .shared)
    }

    private var spec: (icon: String, accent: Color, domainCode: String) {
        return (theme.iconName, theme.accent, theme.domainCode)
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            photoBackground
            photoScrim

            VStack(alignment: .leading, spacing: InsightSpacing.default) {
                badgeRow

                Spacer(minLength: InsightSpacing.small)

                Text(card.headline)
                    .font(InsightFont.largeTitle)
                    .tracking(-0.3)
                    .foregroundStyle(Color.white)
                    .lineLimit(3)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .shadow(color: .black.opacity(0.55), radius: 8, y: 2)

                Text(card.summary)
                    .font(InsightFont.body)
                    .lineSpacing(4)
                    .lineLimit(4)
                    .foregroundStyle(Color.white.opacity(0.88))
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .shadow(color: .black.opacity(0.5), radius: 6, y: 1)

                metaRow

                if isTop {
                    hintRow
                }
            }
            .padding(InsightSpacing.large)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .clipShape(RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous)
                .strokeBorder(Color.white.opacity(0.14), lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
    }

    // MARK: 底图与暗化

    /// 整卡摄影底图；无图分类退化为 accent 渐变（观感与照片底一致，白字规则不变）。
    /// GeometryReader 把填充约束在父级提议的卡片区域内——直接 scaledToFill 会以
    /// 图片原生尺寸撑爆布局，把文字层顶出窗口。
    private var photoBackground: some View {
        GeometryReader { geo in
            Group {
                if let image = theme.image {
                    Image(nsImage: image)
                        .resizable()
                        .scaledToFill()
                        .frame(width: geo.size.width, height: geo.size.height)
                } else {
                    LinearGradient(
                        colors: [spec.accent.opacity(0.92), spec.accent.opacity(0.55)],
                        startPoint: .top, endPoint: .bottom
                    )
                    .frame(width: geo.size.width, height: geo.size.height)
                }
            }
            .clipped()
        }
        .accessibilityLabel("\(card.category)主题配图")
    }

    /// 多阶非线性暗化：顶部护徽章、中段透图、底部保标题与元信息对比度
    private var photoScrim: some View {
        LinearGradient(
            stops: [
                .init(color: .black.opacity(0.34), location: 0.0),
                .init(color: .black.opacity(0.10), location: 0.32),
                .init(color: .black.opacity(0.26), location: 0.62),
                .init(color: .black.opacity(0.80), location: 1.0)
            ],
            startPoint: .top, endPoint: .bottom
        )
    }

    // MARK: 徽章行

    private var badgeRow: some View {
        HStack(spacing: InsightSpacing.small) {
            photoPill(icon: spec.icon, text: card.category)

            if card.source == .ai && showAIMark {
                photoPill(icon: "cpu", text: "AI", tint: InsightColor.warning)
            }

            Spacer(minLength: 0)

            speechPill

            Text(spec.domainCode)
                .font(InsightFont.monoSmall)
                .tracking(0.8)
                .foregroundStyle(Color.white.opacity(0.72))
        }
    }

    /// 照片上的通用徽章：深色半透明底 + 白字（保证任意底图上的可读性）
    private func photoPill(icon: String, text: String, tint: Color = .white) -> some View {
        Label(text, systemImage: icon)
            .font(.system(size: 10, weight: .bold))
            .tracking(0.3)
            .foregroundStyle(tint)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(Color.black.opacity(0.34), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.22), lineWidth: 1))
    }

    /// 语音朗读胶囊按键（旧 CardView.speechButton 的等价物）：
    /// 播放中实显进度百分比，暂停显斜杠图标，空闲为低调入口
    @ViewBuilder
    private var speechPill: some View {
        if let service = speechService {
            let isSpeakingThis = service.state.activeCardId == card.id && service.state.isPlaying
            let isPausedThis = service.state.activeCardId == card.id && service.state.isPaused
            Button {
                service.togglePlayPause(for: card)
                HapticFeedbackHelper.shared.cardSnapBack()
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: isSpeakingThis ? "speaker.wave.3.fill" : (isPausedThis ? "speaker.slash.fill" : "speaker.wave.2"))
                        .font(.system(size: 10, weight: .bold))
                    if isSpeakingThis {
                        Text("\(Int(service.state.progress * 100))%")
                            .font(InsightFont.monoSmall)
                            .monospacedDigit()
                    }
                }
                .foregroundStyle(isSpeakingThis ? InsightColor.success : Color.white.opacity(0.85))
                .padding(.horizontal, 9)
                .padding(.vertical, 5)
                .background(Color.black.opacity(0.34), in: Capsule())
                .overlay(Capsule().strokeBorder(isSpeakingThis ? InsightColor.success.opacity(0.55) : Color.white.opacity(0.22), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .help(isSpeakingThis ? "暂停朗读" : (isPausedThis ? "继续朗读" : "朗读卡片"))
        }
    }

    // MARK: 元信息与提示

    /// Cutline 式元信息：来源 · 字数 · 链接数
    private var metaItems: [String] {
        var items: [String] = []
        switch card.source {
        case .seed: items.append("精选")
        case .ai: items.append("AI 生成")
        case .imported: items.append("导入")
        }
        items.append("\(card.details.count) 字")
        if !card.links.isEmpty {
            items.append("\(card.links.count) 条链接")
        }
        return items
    }

    private var metaRow: some View {
        HStack(spacing: InsightSpacing.small) {
            ForEach(Array(metaItems.enumerated()), id: \.offset) { index, item in
                if index > 0 {
                    Text("·")
                        .foregroundStyle(Color.white.opacity(0.45))
                }
                Text(item)
                    .font(InsightFont.caption)
                    .tracking(0.3)
                    .foregroundStyle(Color.white.opacity(0.75))
                    .lineLimit(1)
            }
        }
    }

    private var hintRow: some View {
        VStack(spacing: InsightSpacing.small) {
            Divider().overlay(Color.white.opacity(0.22))
            HStack(spacing: InsightSpacing.compact) {
                Image(systemName: "arrow.left.and.right")
                    .font(.system(size: 10, weight: .bold))
                Text("左右拖动划走 · 点按看详情")
                    .font(InsightFont.caption)
                Spacer(minLength: 0)
                Text("⏎ 详情")
                    .font(InsightFont.monoSmall)
            }
            .foregroundStyle(Color.white.opacity(0.62))
        }
        .padding(.top, InsightSpacing.tiny)
    }
}

/// 卡片网格单元（收藏/知识库用）：紧凑排版，缩略图换成 accent 色块。
struct InsightCardTile: View {
    let card: KnowledgeCard
    var action: () -> Void

    @State private var hovering = false

    private var theme: CategoryTheme {
        CategoryTheme.theme(for: card, cache: .shared)
    }

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: InsightSpacing.compact) {
                GeometryReader { geometry in
                    if let image = theme.image {
                        Image(nsImage: image)
                            .resizable()
                            .scaledToFill()
                            .frame(width: geometry.size.width, height: geometry.size.height)
                            .clipped()
                    } else {
                        theme.accent.opacity(0.22)
                    }
                }
                .frame(height: 92)
                .clipShape(RoundedRectangle(cornerRadius: InsightRadius.inset, style: .continuous))

                HStack(spacing: InsightSpacing.small) {
                    Image(systemName: theme.iconName)
                        .font(.system(size: 9.5, weight: .bold))
                        .foregroundStyle(theme.accent)
                    Text(card.category)
                        .font(InsightFont.caption)
                        .foregroundStyle(InsightColor.textTertiary)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    if card.source == .ai {
                        InsightPill(text: "AI", tone: .warning)
                    }
                }

                Text(card.headline)
                    .font(InsightFont.headline)
                    .foregroundStyle(InsightColor.textPrimary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)

                Text(card.summary)
                    .font(InsightFont.caption)
                    .foregroundStyle(InsightColor.textSecondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(InsightSpacing.default)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .background(
                hovering ? InsightColor.surfaceRaised : InsightColor.surface,
                in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous)
                    .strokeBorder(hovering ? InsightColor.borderStrong : InsightColor.border, lineWidth: 1)
            )
            .scaleEffect(hovering ? 1.012 : 1.0)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(InsightMotion.card, value: hovering)
    }
}

/// 列表行（历史/收藏/知识库列表用）
struct InsightListRow: View {
    let card: KnowledgeCard
    var trailing: String? = nil
    var action: () -> Void

    @State private var hovering = false

    private var theme: CategoryTheme {
        CategoryTheme.theme(for: card, cache: .shared)
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: InsightSpacing.default) {
                Group {
                    if let image = theme.image {
                        Image(nsImage: image).resizable().scaledToFill()
                    } else {
                        Image(systemName: theme.iconName)
                            .resizable().scaledToFit().padding(12)
                            .foregroundStyle(theme.accent)
                    }
                }
                .frame(width: 44, height: 44)
                .background(theme.accent.opacity(0.14))
                .clipShape(RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous))

                VStack(alignment: .leading, spacing: 2) {
                    Text(card.headline)
                        .font(InsightFont.bodyStrong)
                        .foregroundStyle(InsightColor.textPrimary)
                        .lineLimit(1)
                    Text(card.summary)
                        .font(InsightFont.caption)
                        .foregroundStyle(InsightColor.textTertiary)
                        .lineLimit(1)
                }

                Spacer(minLength: 0)

                if let trailing {
                    Text(trailing)
                        .font(InsightFont.monoSmall)
                        .foregroundStyle(InsightColor.textMuted)
                }
            }
            .padding(.horizontal, InsightSpacing.default)
            .padding(.vertical, 10)
            .background(
                hovering ? InsightColor.surfaceRaised : InsightColor.surface,
                in: RoundedRectangle(cornerRadius: InsightRadius.inset, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: InsightRadius.inset, style: .continuous)
                    .strokeBorder(hovering ? InsightColor.borderStrong : .clear, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(InsightMotion.card, value: hovering)
    }
}
