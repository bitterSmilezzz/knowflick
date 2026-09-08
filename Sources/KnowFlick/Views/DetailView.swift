import SwiftUI
import AppKit
import KnowFlickCore

/// 详情页：顶部摄影横幅 + 展开解释 + 科普链接
/// 内嵌刷卡循环：操作按钮 swipe 后由父视图切到下一张；←/→ 直接导航
struct DetailView: View {
    let card: KnowledgeCard
    let showAIMark: Bool   // 设置：显示 AI 内容标记
    let hasPrevious: Bool   // 有可回看的上一张
    let hasNext: Bool       // 后面还有卡
    let onSwipe: (SwipeDirection) -> Void   // 刷卡意图上抛，不持有整个 store
    var onToggleFavorite: (() -> Void)? = nil
    let onNext: () -> Void
    let onPrevious: () -> Void
    let onClose: () -> Void
    var store: AppStore? = nil
    var relatedCards: [RelatedCardItem] = []
    var onSelectCard: ((KnowledgeCard) -> Void)? = nil

    @Environment(\.openURL) private var openURL
    @State private var showPosterSheet = false
    @State private var showChatSheet = false
    private var isFavorited: Bool { store?.isFavorite(card) ?? (card.swiped == .right) }

    init(
        card: KnowledgeCard,
        store: AppStore? = nil,
        showAIMark: Bool,
        hasPrevious: Bool,
        hasNext: Bool,
        onSwipe: @escaping (SwipeDirection) -> Void,
        onToggleFavorite: (() -> Void)? = nil,
        onNext: @escaping () -> Void,
        onPrevious: @escaping () -> Void,
        onClose: @escaping () -> Void,
        relatedCards: [RelatedCardItem] = [],
        onSelectCard: ((KnowledgeCard) -> Void)? = nil
    ) {
        self.card = card
        self.store = store
        self.showAIMark = showAIMark
        self.hasPrevious = hasPrevious
        self.hasNext = hasNext
        self.onSwipe = onSwipe
        self.onToggleFavorite = onToggleFavorite
        self.onNext = onNext
        self.onPrevious = onPrevious
        self.onClose = onClose
        self.relatedCards = relatedCards
        self.onSelectCard = onSelectCard
    }

    private var theme: CategoryTheme {
        CategoryTheme.theme(for: card, cache: .shared)
    }

    var body: some View {
        ZStack {
            // ambient 背景平滑过渡
            LinearGradient(colors: theme.ambient, startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
            NoiseOverlay().ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    // 顶部横幅：摄影大图 + 渐变自然晕染
                    ZStack(alignment: .bottomLeading) {
                        Rectangle()
                            .fill(theme.ambient.last ?? EditorialColor.canvasDark)
                            .frame(height: 230)

                        if let img = theme.image {
                            GeometryReader { geo in
                                Image(nsImage: img)
                                    .resizable()
                                    .aspectRatio(contentMode: .fill)
                                    .frame(width: geo.size.width, height: geo.size.height)
                                    .clipped()
                                    .overlay(
                                        LinearGradient(
                                            stops: [
                                                .init(color: Color.black.opacity(0.35), location: 0.0),
                                                .init(color: .clear, location: 0.35),
                                                .init(color: (theme.ambient.last ?? EditorialColor.canvasDark).opacity(0.85), location: 0.82),
                                                .init(color: theme.ambient.last ?? EditorialColor.canvasDark, location: 1.0)
                                            ],
                                            startPoint: .top,
                                            endPoint: .bottom
                                        )
                                    )
                            }
                            .frame(height: 230)
                        }

                        // 顶部操作按钮浮层（AI 追问 + 朗读 + 收藏 + 分享海报 + 关闭）
                        VStack {
                            HStack(spacing: 10) {
                                Spacer()
                                chatTopButton
                                speechTopButton
                                favoriteButton
                                shareButton
                                closeButton
                            }
                            Spacer()
                        }
                        .padding(20)
                    }
                    .frame(height: 230)

                    VStack(alignment: .leading, spacing: 0) {
                        // 头部徽章行
                        HStack(spacing: 10) {
                            HStack(spacing: 5) {
                                Image(systemName: theme.iconName)
                                    .font(.system(size: 10.5, weight: .bold))
                                Text(card.category)
                                    .font(EditorialFont.badge)
                                    .tracking(0.8)
                                Text("·")
                                    .font(.system(size: 9.5, weight: .heavy))
                                    .opacity(0.6)
                                Text(theme.domainCode)
                                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                                    .tracking(1.0)
                                    .opacity(0.92)
                            }
                            .foregroundStyle(Color.black.opacity(0.88))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(theme.accent, in: Capsule())
                            .overlay(
                                Capsule()
                                    .strokeBorder(Color.white.opacity(0.38), lineWidth: 0.8)
                            )
                            .shadow(color: theme.accent.opacity(0.38), radius: 8, y: 2)

                            if card.source == .ai {
                                Label("AI 生成", systemImage: "sparkles")
                                    .font(EditorialFont.caption.weight(.bold))
                                    .foregroundStyle(EditorialColor.aiAmber)
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 5)
                                    .background(EditorialColor.aiAmberBg, in: Capsule())
                                    .overlay(Capsule().strokeBorder(EditorialColor.aiAmberBorder, lineWidth: 1))
                            } else {
                                Text("预置精选")
                                    .font(EditorialFont.caption)
                                    .foregroundStyle(EditorialColor.textTertiary)
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 5)
                                    .background(EditorialColor.glassSurface, in: Capsule())
                            }
                        }

                        // 衬线大标题
                        Text(card.headline)
                            .font(EditorialFont.detailHeadline)
                            .foregroundStyle(EditorialColor.textPrimary)
                            .lineSpacing(7.5)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 18)

                        Rectangle()
                            .fill(theme.accent)
                            .frame(width: 38, height: 3.5)
                            .cornerRadius(1.75)
                            .padding(.top, 16)

                        // AI 内容核实提示条（可按设置隐藏）
                        if showAIMark && card.source == .ai {
                            HStack(spacing: 9) {
                                Image(systemName: "sparkles")
                                    .foregroundStyle(EditorialColor.aiAmber)
                                Text("由 AI 生成，请通过下方「延伸阅读」链接核实内容真实性")
                                    .font(EditorialFont.caption)
                                    .foregroundStyle(EditorialColor.textSecondary)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 9)
                            .background(EditorialColor.aiAmberBg, in: RoundedRectangle(cornerRadius: EditorialRadius.control, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: EditorialRadius.control, style: .continuous)
                                    .strokeBorder(EditorialColor.aiAmberBorder, lineWidth: 1)
                            )
                            .padding(.top, 16)
                        }

                        // 语音朗读声学播放栏
                        audioPlayerBar

                        // 正文段落（人文排版）
                        VStack(alignment: .leading, spacing: 18) {
                            ForEach(paragraphs, id: \.self) { para in
                                Text(para)
                                    .font(EditorialFont.bodySerif)
                                    .lineSpacing(8.5)
                                    .foregroundStyle(EditorialColor.textSecondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .padding(.top, 24)

                        // 科普链接
                        if !card.links.isEmpty {
                            VStack(alignment: .leading, spacing: 12) {
                                HStack(spacing: 8) {
                                    Image(systemName: "book.pages")
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(theme.accent)
                                    Text("延伸阅读")
                                        .font(EditorialFont.sectionTitle)
                                        .foregroundStyle(EditorialColor.textPrimary)
                                }
                                .padding(.top, 30)

                                ForEach(card.links, id: \.self) { link in
                                    linkRow(link)
                                }
                            }
                        }

                        // 向卡片追问与 AI 伴学横幅
                        aiCompanionBanner

                        // 相关灵感脉络
                        relatedCardsSection

                        // 操作底栏：上一张 | 不喜欢 | 跳过 | 感兴趣 | 下一张
                        VStack(spacing: 14) {
                            HStack(spacing: 12) {
                                navButton(icon: "chevron.left", help: "上一张 ←", disabled: !hasPrevious, shortcut: .leftArrow) {
                                    onPrevious()
                                }
                                actionButton(title: "不喜欢", icon: "xmark", tint: EditorialColor.dislikeRed) {
                                    onSwipe(.left)
                                }
                                actionButton(title: "跳过", icon: "forward.fill", tint: EditorialColor.skipGray) {
                                    onSwipe(.skip)
                                }
                                actionButton(title: "感兴趣", icon: "heart.fill", tint: EditorialColor.likeGreen) {
                                    onSwipe(.right)
                                }
                                navButton(icon: "chevron.right", help: "下一张 →", disabled: !hasNext, shortcut: .rightArrow) {
                                    onNext()
                                }
                            }
                            Text("⏎ / Esc 关闭详情 · ⌘S 导出海报 · ⌘Z 撤销上一张")
                                .font(EditorialFont.captionSmall)
                                .foregroundStyle(EditorialColor.textMuted)
                        }
                        .padding(.top, 32)
                        .padding(.bottom, 40)
                    }
                    .padding(.horizontal, 42)
                }
                .frame(maxWidth: 720, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
        }
        .background(
            // ⏎ 关闭（与主界面 ⏎ 开详情形成开合对）
            Button("") { onClose() }
                .keyboardShortcut(.return, modifiers: [])
                .frame(width: 0, height: 0)
                .opacity(0)
                .accessibilityHidden(true)
        )
        .overlay {
            if showPosterSheet {
                CardPosterExportSheet(card: card) {
                    showPosterSheet = false
                }
                .transition(.opacity.combined(with: .scale(scale: 0.98)))
            }
        }
        .sheet(isPresented: $showChatSheet) {
            if let store {
                CardFollowUpChatView(card: card, store: store) {
                    showChatSheet = false
                }
            }
        }
    }

    private var chatTopButton: some View {
        Button(action: { showChatSheet = true }) {
            HStack(spacing: 5) {
                Image(systemName: "sparkles")
                    .font(.system(size: 11.5, weight: .bold))
                Text("AI 追问")
                    .font(EditorialFont.captionSmall.weight(.bold))
            }
            .foregroundStyle(EditorialColor.aiAmber)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color.black.opacity(0.45), in: Capsule())
            .overlay(
                Capsule().strokeBorder(EditorialColor.aiAmber.opacity(0.55), lineWidth: 1)
            )
        }
        .buttonStyle(PressableButtonStyle())
        .keyboardShortcut("j", modifiers: .command)
        .help("向 AI 深入探讨此卡片知识 (⌘J)")
    }

    private var aiCompanionBanner: some View {
        Button(action: { showChatSheet = true }) {
            HStack(spacing: 14) {
                ZStack {
                    Circle()
                        .fill(RadialGradient(
                            colors: [EditorialColor.aiAmber.opacity(0.35), .clear],
                            center: .center,
                            startRadius: 0,
                            endRadius: 20
                        ))
                        .frame(width: 40, height: 40)
                    Image(systemName: "sparkles")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(EditorialColor.aiAmber)
                }

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text("向卡片追问")
                            .font(.system(size: 13.5, weight: .bold, design: .serif))
                            .foregroundStyle(EditorialColor.textPrimary)
                        Text("AI 伴学 ⌘J")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(EditorialColor.aiAmber)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(EditorialColor.aiAmber.opacity(0.12), in: Capsule())
                    }
                    Text("对底层机理、现实案例或跨界碰撞有疑问？随时与 AI 导师探讨")
                        .font(EditorialFont.caption)
                        .foregroundStyle(EditorialColor.textSecondary)
                }

                Spacer()

                HStack(spacing: 4) {
                    Text("深入探讨")
                        .font(.system(size: 12, weight: .bold))
                    Image(systemName: "arrow.right")
                        .font(.system(size: 11, weight: .bold))
                }
                .foregroundStyle(EditorialColor.aiAmber)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(EditorialColor.aiAmber.opacity(0.12), in: Capsule())
                .overlay(Capsule().strokeBorder(EditorialColor.aiAmber.opacity(0.3), lineWidth: 1))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(EditorialColor.aiAmber.opacity(0.25), lineWidth: 1)
            )
        }
        .buttonStyle(PressableButtonStyle())
        .padding(.top, 24)
    }

    private var favoriteButton: some View {
        Button(action: {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                if let onToggleFavorite {
                    onToggleFavorite()
                } else {
                    onSwipe(isFavorited ? .skip : .right)
                }
            }
        }) {
            HStack(spacing: 5) {
                Image(systemName: isFavorited ? "heart.fill" : "heart")
                    .font(.system(size: 11.5, weight: .bold))
                    .foregroundStyle(isFavorited ? EditorialColor.likeGreen : EditorialColor.textPrimary)
                Text(isFavorited ? "已收藏" : "收藏")
                    .font(EditorialFont.captionSmall.weight(.bold))
                    .foregroundStyle(EditorialColor.textPrimary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color.black.opacity(0.45), in: Capsule())
            .overlay(
                Capsule()
                    .strokeBorder(isFavorited ? EditorialColor.likeGreen.opacity(0.55) : EditorialColor.glassBorderHover, lineWidth: 1)
            )
        }
        .buttonStyle(PressableButtonStyle())
        .keyboardShortcut("d", modifiers: .command)
        .help(isFavorited ? "取消收藏 ⌘D" : "加入知识收藏阁 ⌘D")
    }

    private var shareButton: some View {
        Button(action: { showPosterSheet = true }) {
            HStack(spacing: 5) {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 11.5, weight: .bold))
                Text("分享海报")
                    .font(EditorialFont.captionSmall.weight(.bold))
            }
            .foregroundStyle(EditorialColor.textPrimary)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color.black.opacity(0.45), in: Capsule())
            .overlay(Capsule().strokeBorder(EditorialColor.glassBorderHover, lineWidth: 1))
        }
        .buttonStyle(PressableButtonStyle())
        .keyboardShortcut("s", modifiers: .command)
        .help("导出画报长图/拍立得分享海报 ⌘S")
    }

    private var closeButton: some View {
        Button(action: onClose) {
            Image(systemName: "xmark")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(EditorialColor.textPrimary)
                .frame(width: 32, height: 32)
                .background(Color.black.opacity(0.45), in: Circle())
                .overlay(Circle().strokeBorder(EditorialColor.glassBorderHover, lineWidth: 1))
        }
        .buttonStyle(PressableButtonStyle())
        .keyboardShortcut(.escape, modifiers: [])
    }

    private func linkRow(_ link: ScienceLink) -> some View {
        Button {
            if let url = URL(string: link.url) {
                openURL(url)
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(theme.accent)
                Text(link.title)
                    .font(EditorialFont.labelSmall)
                    .foregroundStyle(EditorialColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer()
                Text(displayHost(link.url))
                    .font(EditorialFont.caption)
                    .foregroundStyle(EditorialColor.textTertiary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .editorialGlassCard(cornerRadius: EditorialRadius.control)
        }
        .buttonStyle(PressableButtonStyle(scale: 0.985))
    }

    private func actionButton(title: String, icon: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(EditorialFont.label)
                .foregroundStyle(tint)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(tint.opacity(0.14), in: RoundedRectangle(cornerRadius: EditorialRadius.control, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: EditorialRadius.control, style: .continuous)
                        .strokeBorder(tint.opacity(0.55), lineWidth: 1.3)
                )
                .shadow(color: tint.opacity(0.2), radius: 8, y: 2)
        }
        .buttonStyle(PressableButtonStyle(scale: 0.97))
    }

    /// 左右导航按钮：键盘 ←/→ 直接切卡
    private func navButton(icon: String, help: String, disabled: Bool, shortcut: KeyEquivalent, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(disabled ? EditorialColor.textMuted.opacity(0.5) : EditorialColor.textSecondary)
                .frame(width: 44, height: 44)
                .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: EditorialRadius.control, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: EditorialRadius.control, style: .continuous)
                        .strokeBorder(EditorialColor.glassBorder, lineWidth: 1)
                )
        }
        .buttonStyle(PressableButtonStyle(scale: 0.97))
        .disabled(disabled)
        .keyboardShortcut(shortcut, modifiers: [])
        .help(help)
    }

    // MARK: - 相关灵感脉络 (Connected Cards)

    @ViewBuilder
    private var relatedCardsSection: some View {
        if !relatedCards.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(EditorialColor.aiAmber)
                    Text("相关灵感脉络")
                        .font(EditorialFont.sectionTitle)
                        .foregroundStyle(EditorialColor.textPrimary)

                    Spacer()

                    Text("知识网状联想")
                        .font(EditorialFont.captionSmall)
                        .foregroundStyle(EditorialColor.textMuted)
                }
                .padding(.top, 28)

                VStack(spacing: 10) {
                    ForEach(relatedCards) { item in
                        Button {
                            onSelectCard?(item.card)
                        } label: {
                            HStack(alignment: .top, spacing: 12) {
                                // 关系类型微标
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack(spacing: 4) {
                                        Image(systemName: item.kind.icon)
                                            .font(.system(size: 10, weight: .bold))
                                        Text(item.kind.title)
                                            .font(.system(size: 10.5, weight: .bold))
                                    }
                                    .foregroundStyle(relationColor(for: item.kind))
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 3)
                                    .background(relationColor(for: item.kind).opacity(0.12), in: Capsule())
                                    .overlay(Capsule().strokeBorder(relationColor(for: item.kind).opacity(0.3), lineWidth: 1))

                                    Text(item.card.category)
                                        .font(.system(size: 10, weight: .medium))
                                        .foregroundStyle(EditorialColor.textTertiary)
                                        .padding(.leading, 2)
                                }
                                .frame(width: 96, alignment: .leading)

                                // 标题与推荐理由
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(item.card.headline)
                                        .font(.system(size: 13.5, weight: .semibold))
                                        .foregroundStyle(EditorialColor.textPrimary)
                                        .fixedSize(horizontal: false, vertical: true)
                                        .multilineTextAlignment(.leading)

                                    if !item.reason.isEmpty {
                                        Text(item.reason)
                                            .font(.system(size: 11, weight: .regular))
                                            .foregroundStyle(EditorialColor.textMuted)
                                            .fixedSize(horizontal: false, vertical: true)
                                    }
                                }

                                Spacer()

                                Image(systemName: "chevron.right")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(EditorialColor.textMuted)
                                    .padding(.top, 4)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 11)
                            .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .strokeBorder(EditorialColor.glassBorder, lineWidth: 1)
                            )
                        }
                        .buttonStyle(PressableButtonStyle())
                    }
                }
            }
        }
    }

    private func relationColor(for kind: RelationKind) -> Color {
        switch kind {
        case .disciplineDeepen:
            return Color(red: 0.35, green: 0.65, blue: 0.95)
        case .crossDiscipline:
            return EditorialColor.aiAmber
        case .conceptBridge:
            return EditorialColor.likeGreen
        case .serendipity:
            return Color(red: 0.85, green: 0.45, blue: 0.85)
        }
    }

    // MARK: - 语音朗读声学导读组件

    private var speechTopButton: some View {
        let service = SpeechSynthesizerService.shared
        let isSpeakingThis = service.state.activeCardId == card.id && service.state.isPlaying

        return Button {
            service.togglePlayPause(for: card)
            HapticFeedbackHelper.shared.cardSnapBack()
        } label: {
            HStack(spacing: 4) {
                Image(systemName: isSpeakingThis ? "pause.fill" : "speaker.wave.2.fill")
                    .font(.system(size: 11.5, weight: .bold))
                Text(isSpeakingThis ? "暂停" : "朗读")
                    .font(EditorialFont.captionSmall.weight(.bold))
            }
            .foregroundStyle(isSpeakingThis ? EditorialColor.likeGreen : EditorialColor.textPrimary)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color.black.opacity(0.45), in: Capsule())
            .overlay(
                Capsule()
                    .strokeBorder(isSpeakingThis ? EditorialColor.likeGreen.opacity(0.55) : EditorialColor.glassBorderHover, lineWidth: 1)
            )
        }
        .buttonStyle(PressableButtonStyle())
        .keyboardShortcut("p", modifiers: .command)
        .help(isSpeakingThis ? "暂停朗读 ⌘P" : "朗读全文 ⌘P")
    }

    private var audioPlayerBar: some View {
        let service = SpeechSynthesizerService.shared
        let isSpeakingThis = service.state.activeCardId == card.id && service.state.isPlaying
        let isPausedThis = service.state.activeCardId == card.id && service.state.isPaused
        let progress = (service.state.activeCardId == card.id) ? service.state.progress : 0.0

        return VStack(spacing: 10) {
            HStack(spacing: 12) {
                // 播放 / 暂停大按键
                Button {
                    service.togglePlayPause(for: card)
                    HapticFeedbackHelper.shared.cardSnapBack()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: isSpeakingThis ? "pause.fill" : "play.fill")
                            .font(.system(size: 12, weight: .bold))
                        Text(isSpeakingThis ? "暂停朗读" : (isPausedThis ? "继续朗读" : "沉浸导读"))
                            .font(EditorialFont.caption.weight(.semibold))
                    }
                    .foregroundStyle(isSpeakingThis ? Color.black : EditorialColor.textPrimary)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .background(
                        isSpeakingThis ? EditorialColor.likeGreen : Color.white.opacity(0.08),
                        in: Capsule()
                    )
                    .overlay(
                        Capsule().strokeBorder(
                            isSpeakingThis ? EditorialColor.likeGreen : EditorialColor.glassBorder,
                            lineWidth: 1
                        )
                    )
                    .shadow(color: isSpeakingThis ? EditorialColor.likeGreen.opacity(0.35) : .clear, radius: 6, y: 1)
                }
                .buttonStyle(PressableButtonStyle())

                // 声浪跳动条
                AudioWaveformBars(isPlaying: isSpeakingThis)
                    .frame(width: 22, height: 15)

                if isSpeakingThis || isPausedThis {
                    Text("\(Int(progress * 100))%")
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .foregroundStyle(isSpeakingThis ? EditorialColor.likeGreen : EditorialColor.textSecondary)
                }

                Spacer()

                // 语速切换
                Menu {
                    Button("0.75x 慢速精听") { service.speedMultiplier = 0.75 }
                    Button("1.0x 正常标准") { service.speedMultiplier = 1.0 }
                    Button("1.25x 高效快读") { service.speedMultiplier = 1.25 }
                    Button("1.5x 极速浏览") { service.speedMultiplier = 1.5 }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "waveform")
                            .font(.system(size: 10, weight: .bold))
                        Text(speedLabel(for: service.speedMultiplier))
                            .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    }
                    .foregroundStyle(EditorialColor.textSecondary)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(Color.white.opacity(0.06), in: Capsule())
                    .overlay(Capsule().strokeBorder(Color.white.opacity(0.1), lineWidth: 1))
                }
                .menuStyle(.borderlessButton)
                .fixedSize()

                // 重新朗读
                Button {
                    service.speak(card: card, part: .full)
                    HapticFeedbackHelper.shared.cardSnapBack()
                } label: {
                    Image(systemName: "arrow.counterclockwise")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(EditorialColor.textSecondary)
                        .frame(width: 28, height: 28)
                        .background(Color.white.opacity(0.06), in: Circle())
                        .overlay(Circle().strokeBorder(Color.white.opacity(0.1), lineWidth: 1))
                }
                .buttonStyle(PressableButtonStyle())
                .help("从头重新朗读")
            }

            // 朗读进度条
            if isSpeakingThis || isPausedThis {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(Color.white.opacity(0.12))
                            .frame(height: 3)

                        Capsule()
                            .fill(EditorialColor.likeGreen)
                            .frame(width: max(3, geo.size.width * CGFloat(progress)), height: 3)
                    }
                }
                .frame(height: 3)
            }
        }
        .padding(14)
        .background(
            EditorialColor.glassSurface,
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(EditorialColor.glassBorder, lineWidth: 1)
        )
        .padding(.top, 18)
    }

    private func speedLabel(for rate: Float) -> String {
        if abs(rate - 0.75) < 0.05 { return "0.75x" }
        if abs(rate - 1.0) < 0.05 { return "1.0x" }
        if abs(rate - 1.25) < 0.05 { return "1.25x" }
        if abs(rate - 1.5) < 0.05 { return "1.5x" }
        return String(format: "%.1fx", rate)
    }

    private var paragraphs: [String] {
        card.details
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map(String.init)
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    private func displayHost(_ url: String) -> String {
        URL(string: url)?.host?.replacingOccurrences(of: "www.", with: "") ?? url
    }
}
