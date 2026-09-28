import SwiftUI
import KnowFlickCore

// MARK: - Cutline 式知识卡片
//
// 素材依据：`.scratch/ui-material/05_HTCuOh3aoAA4Qv0.png`（Cutline）的项目卡：
//   · 左上角小徽章（比例/分类），右上角状态徽章
//   · 粗体标题
//   · 底部一行元信息：`4K · EDITED 12M AGO`
//   · 卡片为深色 surface + 1pt 描边，圆角约 14pt，无摄影大图
//
// 与旧 CardView 的差异：撤掉 42 张摄影底图与宋体标题，改纯排版驱动。
// `CategoryTheme` 仍保留（其它视图在用 visualSpec 取 accent/icon），但卡片不再用它铺背景。

/// 卡片元信息（Cutline 的 `4K · EDITED 12M AGO` 一行）
private struct InsightCardMeta: View {
    let items: [String]

    var body: some View {
        HStack(spacing: InsightSpacing.small) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                if index > 0 {
                    Text("·")
                        .foregroundStyle(InsightColor.textMuted)
                }
                Text(item)
                    .font(InsightFont.caption)
                    .tracking(0.3)
                    .foregroundStyle(InsightColor.textTertiary)
                    .lineLimit(1)
            }
        }
    }
}

/// 单张知识卡片：徽章 + 粗体标题 + 摘要 + 元信息行。
/// `isTop` 时显示来源/状态徽章行，供刷卡视图复用；
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
        VStack(alignment: .leading, spacing: InsightSpacing.default) {
            categoryImage
                .frame(height: 152)
                .clipShape(RoundedRectangle(cornerRadius: InsightRadius.inset, style: .continuous))

            // 徽章行：分类（实底 accent）+ AI 标记 + 朗读胶囊 + 领域代码
            HStack(spacing: InsightSpacing.small) {
                InsightPill(text: card.category, tone: .accent, icon: spec.icon)
                if card.source == .ai && showAIMark {
                    InsightPill(text: "AI", tone: .warning, icon: "sparkles")
                }
                Spacer(minLength: 0)
                speechPill
                Text(spec.domainCode)
                    .font(InsightFont.monoSmall)
                    .tracking(0.8)
                    .foregroundStyle(InsightColor.textMuted)
            }

            // 标题（Cutline 用粗体无衬线大标题）
            Text(card.headline)
                .font(InsightFont.largeTitle)
                .foregroundStyle(InsightColor.textPrimary)
                .lineLimit(3)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)

            // 摘要
            Text(card.summary)
                .font(InsightFont.body)
                .foregroundStyle(InsightColor.textSecondary)
                .lineSpacing(4)
                .lineLimit(4)
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: InsightSpacing.default)

            // 元信息行
            InsightCardMeta(items: metaItems)

            if isTop {
                Divider().overlay(InsightColor.divider)
                HStack(spacing: InsightSpacing.compact) {
                    Image(systemName: "arrow.left.and.right")
                        .font(.system(size: 10, weight: .bold))
                    Text("左右拖动划走 · 双击看详情")
                        .font(InsightFont.caption)
                    Spacer(minLength: 0)
                    Text("⏎ 详情")
                        .font(InsightFont.monoSmall)
                }
                .foregroundStyle(InsightColor.textMuted)
            }
        }
        .padding(InsightSpacing.large)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous)
                .strokeBorder(InsightColor.border, lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
    }

    /// 语音朗读胶囊按键（旧 CardView.speechButton 的 Cutline 等价物）：
    /// 播放中实显 success 色与进度百分比，暂停显斜杠图标，空闲为低调入口
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
                        .font(.system(size: 9.5, weight: .bold))
                    if isSpeakingThis {
                        Text("\(Int(service.state.progress * 100))%")
                            .font(InsightFont.monoSmall)
                            .monospacedDigit()
                    }
                }
                .foregroundStyle(isSpeakingThis ? InsightColor.success : InsightColor.textTertiary)
                .padding(.horizontal, 7)
                .padding(.vertical, 3.5)
                .background(InsightColor.surfaceSunken, in: Capsule())
                .overlay(Capsule().strokeBorder(isSpeakingThis ? InsightColor.success.opacity(0.4) : InsightColor.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .help(isSpeakingThis ? "暂停朗读" : (isPausedThis ? "继续朗读" : "朗读卡片"))
        }
    }

    private var categoryImage: some View {
        GeometryReader { geometry in
            ZStack(alignment: .bottomLeading) {
                if let image = theme.image {
                    Image(nsImage: image)
                        .resizable()
                        .scaledToFill()
                        .frame(width: geometry.size.width, height: geometry.size.height)
                        .clipped()
                } else {
                    theme.accent.opacity(0.22)
                    Image(systemName: theme.iconName)
                        .font(.system(size: 52, weight: .ultraLight))
                        .foregroundStyle(theme.accent)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                LinearGradient(colors: [.clear, .black.opacity(0.42)], startPoint: .center, endPoint: .bottom)
                Text(theme.domainCode)
                    .font(InsightFont.monoSmall)
                    .tracking(1.8)
                    .foregroundStyle(.white)
                    .padding(14)
            }
        }
        .accessibilityLabel("\(card.category)主题配图")
    }

    /// Cutline 式元信息：来源 · 字数 · 分类数
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
