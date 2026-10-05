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
    var isFavorited: Bool = false
    var onToggleFavorite: (() -> Void)? = nil

    private var theme: CategoryTheme {
        CategoryTheme.theme(for: card, cache: .shared)
    }

    @State private var isHoveringCard: Bool = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var spec: (icon: String, accent: Color, domainCode: String) {
        return (theme.iconName, theme.accent, theme.domainCode)
    }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                photoBackground
                photoScrim

                VStack(alignment: .leading, spacing: 10) {
                    badgeRow

                    Spacer(minLength: 8)

                    // 来源标识
                    Text(card.source == .imported ? "导入笔记" : card.source == .ai ? "AI 探索" : "精选知识")
                        .font(InsightFont.captionSmall)
                        .tracking(0.5)
                        .foregroundStyle(Color.white.opacity(0.68))

                    Text(card.displayHeadline)
                        .font(.system(size: 24, weight: .bold, design: .rounded))
                        .tracking(-0.35)
                        .foregroundStyle(Color.white)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .shadow(color: .black.opacity(0.6), radius: 6, y: 1.5)

                    if !card.displaySummary.isEmpty {
                        Text(card.displaySummary)
                            .font(.system(size: 13.5, weight: .regular))
                            .lineSpacing(4)
                            .lineLimit(3)
                            .foregroundStyle(Color.white.opacity(0.88))
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                            .shadow(color: .black.opacity(0.4), radius: 4, y: 1)
                    }

                    // 核心要义摘要：优雅克制的人文引述
                    if let takeaway = keyTakeawayText, !takeaway.isEmpty {
                        HStack(alignment: .top, spacing: 7) {
                            Image(systemName: "quote.opening")
                                .font(.system(size: 9, weight: .semibold))
                                .foregroundStyle(spec.accent)
                                .padding(.top, 2)
                            Text(takeaway)
                                .font(.system(size: 12, weight: .regular, design: .serif))
                                .lineSpacing(3)
                                .foregroundStyle(Color.white.opacity(0.85))
                                .lineLimit(2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Color.black.opacity(0.35), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .strokeBorder(Color.white.opacity(0.12), lineWidth: 1)
                        )
                    }

                    metaRow
                }
                .padding(InsightSpacing.large)
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
            .clipShape(RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous)
                    .strokeBorder(
                        isHoveringCard ? Color.white.opacity(0.28) : Color.white.opacity(0.14),
                        lineWidth: 1
                    )
            )
            .shadow(
                color: Color.black.opacity(isHoveringCard ? 0.32 : 0.22),
                radius: isHoveringCard ? 20 : 14,
                x: 0,
                y: isHoveringCard ? 8 : 4
            )
            .contentShape(RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
            .onContinuousHover { phase in
                switch phase {
                case .active:
                    isHoveringCard = true
                case .ended:
                    isHoveringCard = false
                }
            }
            // 悬停加深描边与阴影：与全应用同一档触觉弹簧（此前是手写 easeOut 两套参数）
            .animation(reduceMotion ? nil : InsightMotion.tactile, value: isHoveringCard)
        }
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

    /// 多阶非线性暗化：顶部护徽章、中段透图、底部保标题对比度
    private var photoScrim: some View {
        LinearGradient(
            stops: [
                .init(color: .black.opacity(0.48), location: 0.0),
                .init(color: .black.opacity(0.20), location: 0.28),
                .init(color: .black.opacity(0.40), location: 0.52),
                .init(color: .black.opacity(0.92), location: 1.0)
            ],
            startPoint: .top, endPoint: .bottom
        )
    }

    // MARK: 徽章行

    private var badgeRow: some View {
        HStack(spacing: InsightSpacing.small) {
            categoryMetaTag

            HStack(spacing: 3.5) {
                Image(systemName: "clock")
                    .font(.system(size: 8.5, weight: .bold))
                Text("约 \(max(1, card.details.count / 300)) 分钟")
                    .font(InsightFont.captionSmall)
            }
            .foregroundStyle(Color.white.opacity(0.85))
            .padding(.horizontal, 7)
            .padding(.vertical, 3.5)
            .background(Color.black.opacity(0.35), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.18), lineWidth: 0.8))

            if card.masteryLevel >= 2 {
                HStack(spacing: 3) {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 8.5, weight: .bold))
                    Text("已掌握")
                        .font(InsightFont.captionSmall)
                }
                .foregroundStyle(InsightColor.success)
                .padding(.horizontal, 6.5)
                .padding(.vertical, 3)
                .background(InsightColor.success.opacity(0.22), in: Capsule())
                .overlay(Capsule().strokeBorder(InsightColor.success.opacity(0.35), lineWidth: 0.8))
            }

            Spacer(minLength: 0)

            favoriteButton

            speechButton
        }
    }

    /// 从卡片长内容中提炼首句关键洞察，用于充实卡片中间区域
    private var keyTakeawayText: String? {
        let raw = card.details.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty, raw != card.summary else { return nil }
        let lines = raw.components(separatedBy: CharacterSet.newlines)
        let firstLine = lines.first(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) ?? raw
        if firstLine.count > 100 {
            let index = firstLine.index(firstLine.startIndex, offsetBy: 100)
            return String(firstLine[..<index]) + "…"
        }
        return firstLine
    }

    /// 从卡片长文本提炼 1-2 条精要脉络观点，进一步丰富卡片信息密度
    private var keyInsights: [String] {
        let raw = card.details.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty, raw != card.summary else { return [] }
        let lines = raw.components(separatedBy: CharacterSet.newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        let bulletLines = lines.filter { line in
            line.hasPrefix("- ") || line.hasPrefix("* ") || line.hasPrefix("• ") || (line.first?.isNumber == true && line.contains("."))
        }
        if !bulletLines.isEmpty {
            return Array(bulletLines.prefix(2).map { line in
                line.trimmingCharacters(in: CharacterSet(charactersIn: "-*•0123456789. "))
            })
        }

        let otherLines = lines.filter { $0 != card.headline && $0 != card.summary && $0 != keyTakeawayText }
        if let first = otherLines.first, first.count >= 15 {
            let trimmed = first.count > 70 ? String(first.prefix(70)) + "…" : first
            return [trimmed]
        }
        return []
    }

    /// 统一瑞士分类元信息标（分类图标 + 名称 · 领域代码 + 可选 AI 标识）
    private var categoryMetaTag: some View {
        HStack(spacing: 5) {
            Image(systemName: spec.icon)
                .font(.system(size: 10, weight: .bold))
            Text(card.category)
                .font(.system(size: 11, weight: .semibold))
                .tracking(0.3)
            Text("·")
                .font(.system(size: 10, weight: .bold))
                .opacity(0.4)
            Text(spec.domainCode)
                .font(InsightFont.monoSmall)
                .opacity(0.8)

            if card.source == .ai && showAIMark {
                Text("AI")
                    .font(.system(size: 8.5, weight: .heavy))
                    .foregroundStyle(InsightColor.warning)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 1.5)
                    .background(InsightColor.warning.opacity(0.24), in: RoundedRectangle(cornerRadius: 3))
            }
        }
        .foregroundStyle(Color.white)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Color.black.opacity(0.38), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.20), lineWidth: 1))
    }

    /// 顶卡收藏微控钮：28×28 紧凑圆钮，零布局跳动
    @ViewBuilder
    private var favoriteButton: some View {
        if let onToggleFavorite {
            Button(action: onToggleFavorite) {
                Image(systemName: isFavorited ? "bookmark.fill" : "bookmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(isFavorited ? InsightColor.warning : Color.white.opacity(0.88))
                    .frame(width: 28, height: 28)
                    .background(isFavorited ? InsightColor.warning.opacity(0.24) : Color.black.opacity(0.38), in: Circle())
                    .overlay(
                        Circle().strokeBorder(
                            isFavorited ? InsightColor.warning.opacity(0.68) : Color.white.opacity(0.20),
                            lineWidth: 1
                        )
                    )
            }
            .buttonStyle(PressableButtonStyle(scale: 0.92))
            .help(isFavorited ? "取消收藏 (⌘D / F)" : "加入知识收藏阁 (⌘D / F)")
        }
    }

    /// 语音朗读微控钮：28×28 紧凑圆钮，零布局跳动
    @ViewBuilder
    private var speechButton: some View {
        if let service = speechService {
            let isSpeakingThis = service.state.activeCardId == card.id && service.state.isPlaying
            let isPausedThis = service.state.activeCardId == card.id && service.state.isPaused
            Button {
                service.togglePlayPause(for: card)
                HapticFeedbackHelper.shared.cardSnapBack()
            } label: {
                Image(systemName: isSpeakingThis ? "speaker.wave.3.fill" : (isPausedThis ? "speaker.slash.fill" : "speaker.wave.2"))
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(isSpeakingThis ? InsightColor.success : Color.white.opacity(0.88))
                    .frame(width: 28, height: 28)
                    .background(isSpeakingThis ? InsightColor.success.opacity(0.24) : Color.black.opacity(0.38), in: Circle())
                    .overlay(
                        Circle().strokeBorder(
                            isSpeakingThis ? InsightColor.success.opacity(0.68) : Color.white.opacity(0.20),
                            lineWidth: 1
                        )
                    )
            }
            .buttonStyle(PressableButtonStyle(scale: 0.92))
            .help(isSpeakingThis ? "暂停朗读 (Space)" : (isPausedThis ? "继续朗读 (Space)" : "朗读卡片 (Space)"))
        }
    }

    // MARK: 元信息与快捷提示

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
                        .foregroundStyle(Color.white.opacity(0.40))
                }
                Text(item)
                    .font(InsightFont.captionSmall)
                    .tracking(0.2)
                    .foregroundStyle(Color.white.opacity(0.72))
                    .lineLimit(1)
            }

            if isTop {
                Spacer(minLength: 8)
                HStack(spacing: 7) {
                    HStack(spacing: 3) {
                        Image(systemName: "return")
                            .font(.system(size: 8.5, weight: .bold))
                        Text("详情")
                            .font(InsightFont.monoSmall)
                    }
                    HStack(spacing: 3) {
                        Image(systemName: "space")
                            .font(.system(size: 8.5, weight: .bold))
                        Text("朗读")
                            .font(InsightFont.monoSmall)
                    }
                }
                .foregroundStyle(Color.white.opacity(0.65))
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(Color.black.opacity(0.28), in: Capsule())
                .overlay(Capsule().strokeBorder(Color.white.opacity(0.14), lineWidth: 0.8))
            }
        }
        .padding(.top, 2)
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
                ZStack(alignment: .bottomLeading) {
                    GeometryReader { geometry in
                        if let image = theme.image {
                            Image(nsImage: image)
                                .resizable()
                                .scaledToFill()
                                .frame(width: geometry.size.width, height: geometry.size.height)
                                .clipped()
                        } else {
                            theme.accent.opacity(0.25)
                        }
                    }
                    .frame(height: 84)
                    .clipShape(RoundedRectangle(cornerRadius: InsightRadius.inset, style: .continuous))

                    HStack {
                        Text("约 \(max(1, card.details.count / 300)) 分钟")
                            .font(InsightFont.monoSmall)
                            .foregroundStyle(Color.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2.5)
                            .background(Color.black.opacity(0.55), in: Capsule())
                            .overlay(Capsule().strokeBorder(Color.white.opacity(0.18), lineWidth: 0.8))
                        Spacer()
                        if card.isFavorite {
                            Image(systemName: "bookmark.fill")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(InsightColor.warning)
                                .padding(5)
                                .background(Color.black.opacity(0.55), in: Circle())
                        }
                    }
                    .padding(6)
                }

                HStack(spacing: 5) {
                    Image(systemName: theme.iconName)
                        .font(.system(size: 9.5, weight: .bold))
                        .foregroundStyle(theme.accent)
                    Text(card.category)
                        .font(InsightFont.caption)
                        .foregroundStyle(InsightColor.textSecondary)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    if card.source == .ai {
                        InsightPill(text: "AI", tone: .warning)
                    } else if card.masteryLevel >= 2 {
                        InsightPill(text: "已掌握", tone: .success)
                    }
                }

                Text(card.displayHeadline)
                    .font(InsightFont.headline)
                    .foregroundStyle(InsightColor.textPrimary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)

                if !card.displaySummary.isEmpty {
                    Text(card.displaySummary)
                        .font(InsightFont.captionSmall)
                        .lineSpacing(2.5)
                        .foregroundStyle(InsightColor.textSecondary)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }

                HStack {
                    Text("\(card.details.count) 字")
                        .font(InsightFont.monoSmall)
                        .foregroundStyle(InsightColor.textMuted)
                    Spacer()
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(hovering ? theme.accent : InsightColor.textMuted)
                }
                .padding(.top, 2)
            }
            .padding(InsightSpacing.compact)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .background(
                hovering ? InsightColor.surfaceRaised : InsightColor.surface,
                in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous)
                    .strokeBorder(hovering ? AnyShapeStyle(InsightColor.borderStrong) : AnyShapeStyle(InsightColor.border), lineWidth: 1)
            )
            .shadow(
                color: Color.black.opacity(hovering ? 0.16 : 0.06),
                radius: hovering ? 10 : 4,
                y: hovering ? 4 : 2
            )
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(InsightMotion.tactile, value: hovering)
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
                    Text(card.displayHeadline)
                        .font(InsightFont.bodyStrong)
                        .foregroundStyle(InsightColor.textPrimary)
                        .lineLimit(1)
                    Text(card.displaySummary)
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
