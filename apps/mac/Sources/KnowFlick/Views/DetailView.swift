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
    let store: AppStore
    var relatedCards: [RelatedCardItem] = []
    var onSelectCard: ((KnowledgeCard) -> Void)? = nil
    var onCompleteReading: (() -> Void)? = nil
    /// 详情页内 ⌘Z 撤销：由宿主注入（底层卡堆的 ⌘Z 在 sheet 打开时被禁用）
    var onUndo: (() -> Void)? = nil

    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showPosterSheet = false
    @State private var showChatSheet = false
    @State private var showConsoleSheet = false
    @State private var pendingChatPrompt: String? = nil
    private var isFavorited: Bool { store.isFavorite(card) }

    init(
        card: KnowledgeCard,
        store: AppStore,
        showAIMark: Bool,
        hasPrevious: Bool,
        hasNext: Bool,
        onSwipe: @escaping (SwipeDirection) -> Void,
        onToggleFavorite: (() -> Void)? = nil,
        onNext: @escaping () -> Void,
        onPrevious: @escaping () -> Void,
        onClose: @escaping () -> Void,
        relatedCards: [RelatedCardItem] = [],
        onSelectCard: ((KnowledgeCard) -> Void)? = nil,
        onCompleteReading: (() -> Void)? = nil,
        onUndo: (() -> Void)? = nil
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
        self.onCompleteReading = onCompleteReading
        self.onUndo = onUndo
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
                            .fill(theme.ambient.last ?? InsightColor.canvas)
                            .frame(height: 200)

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
                                                .init(color: (theme.ambient.last ?? InsightColor.canvas).opacity(0.85), location: 0.82),
                                                .init(color: theme.ambient.last ?? InsightColor.canvas, location: 1.0)
                                            ],
                                            startPoint: .top,
                                            endPoint: .bottom
                                        )
                                    )
                            }
                            .frame(height: 200)
                        }

                        // 顶部操作按钮浮层（AI 追问 + 朗读 + 收藏 + 分享海报 + 关闭）
                        VStack {
                            HStack(spacing: 8) {
                                Spacer()
                                HStack(spacing: 2) {
                                    chatTopButton
                                    speechTopButton
                                    favoriteButton
                                    shareButton
                                }
                                .padding(3)
                                .background(Color.black.opacity(0.50), in: Capsule())
                                .overlay(Capsule().strokeBorder(Color.white.opacity(0.15), lineWidth: 1))

                                closeButton
                            }
                            Spacer()
                        }
                        .padding(14)
                    }
                    .frame(height: 200)

                    VStack(alignment: .leading, spacing: 0) {
                        // 头部徽章行
                        HStack(spacing: 10) {
                            HStack(spacing: 5) {
                                Image(systemName: theme.iconName)
                                    .font(.system(size: 10.5, weight: .bold))
                                Text(card.category)
                                    .font(InsightFont.callout)
                                    .tracking(0.8)
                                Text("·")
                                    .font(.system(size: 9.5, weight: .heavy))
                                    .opacity(0.6)
                                Text(theme.domainCode)
                                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                                    .tracking(1.0)
                                    .opacity(0.92)
                            }
                            .foregroundStyle(theme.accent)
                            .padding(.horizontal, 11)
                            .padding(.vertical, 5)
                            .background(theme.accent.opacity(0.12), in: Capsule())
                            .overlay(
                                Capsule().strokeBorder(theme.accent.opacity(0.28), lineWidth: 1)
                            )

                            if card.source == .ai {
                                // 关闭「AI 内容标记」后，AI 卡片不应被误标为「预置精选」，
                                // 而是退化为不暴露来源的中性标签（与卡片正面 showAIMark 行为一致）。
                                if showAIMark {
                                    Label("AI 生成", systemImage: "cpu")
                                        .font(InsightFont.caption.weight(.bold))
                                        .foregroundStyle(InsightColor.warning)
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 5)
                                        .background(InsightColor.warningSoft, in: Capsule())
                                        .overlay(Capsule().strokeBorder(InsightColor.warning, lineWidth: 1))
                                }
                            } else {
                                Text(card.source == .imported ? "导入笔记" : "预置精选")
                                    .font(InsightFont.caption)
                                    .foregroundStyle(InsightColor.textTertiary)
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 5)
                                    .background(InsightColor.surface, in: Capsule())
                            }
                        }

                        // 衬线大标题 (Awwwards 级宏大高对比排版)
                        Text(card.displayHeadline)
                            .font(InsightFont.heroTitle)
                            .tracking(-0.6)
                            .foregroundStyle(InsightColor.textPrimary)
                            .lineSpacing(7.5)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 14)
                            .padding(.bottom, 4)

                        // AI 内容核实提示条（可按设置隐藏）
                        if showAIMark && card.source == .ai {
                            HStack(spacing: 9) {
                                Image(systemName: "cpu")
                                    .foregroundStyle(InsightColor.warning)
                                Text("由 AI 生成，请通过下方「延伸阅读」链接核实内容真实性")
                                    .font(InsightFont.caption)
                                    .foregroundStyle(InsightColor.textSecondary)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(InsightColor.warningSoft, in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
                                    .strokeBorder(InsightColor.warning, lineWidth: 1)
                            )
                            .padding(.top, 12)
                        }

                        // 语音朗读声学播放栏
                        audioPlayerBar

                        // 正文段落（人文排版）
                        VStack(alignment: .leading, spacing: 14) {
                            ForEach(paragraphs, id: \.self) { para in
                                Text(para)
                                    .font(InsightFont.body)
                                    .lineSpacing(7.5)
                                    .foregroundStyle(InsightColor.textSecondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .padding(.top, 14)

                        // 科普链接
                        if !card.links.isEmpty {
                            VStack(alignment: .leading, spacing: 10) {
                                HStack(spacing: 8) {
                                    Image(systemName: "book.pages")
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(theme.accent)
                                    Text("延伸阅读")
                                        .font(InsightFont.headline)
                                        .foregroundStyle(InsightColor.textPrimary)
                                }
                                .padding(.top, 18)

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
                        VStack(spacing: 12) {
                            if onCompleteReading == nil {
                            HStack(spacing: 12) {
                                navButton(icon: "chevron.left", help: "上一张 ←", disabled: !hasPrevious, shortcut: .leftArrow) {
                                    onPrevious()
                                }
                                actionButton(title: "不喜欢", icon: "xmark", tint: InsightColor.danger) {
                                    onSwipe(.left)
                                }
                                actionButton(title: "跳过", icon: "forward.fill", tint: InsightColor.neutral) {
                                    onSwipe(.skip)
                                }
                                actionButton(title: "感兴趣", icon: "heart.fill", tint: InsightColor.success) {
                                    onSwipe(.right)
                                }
                                navButton(icon: "chevron.right", help: "下一张 →", disabled: !hasNext, shortcut: .rightArrow) {
                                    onNext()
                                }
                            }
                            }
                            Text("⏎ / Esc 关闭详情 · ⌘S 导出海报" + (onUndo != nil ? " · ⌘Z 撤销上一张" : ""))
                                .font(InsightFont.captionSmall)
                                .foregroundStyle(InsightColor.textMuted)
                        }
                        .padding(.top, 20)
                        .padding(.bottom, 24)
                    }
                    .padding(.horizontal, InsightLayout.readingPadding)
                }
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
        }
        // 详情页内上一张/下一张换卡：ambient 渐变与整页内容此前瞬切。
        // 以 card.id 重建整页（顺带把滚动位置归零）并做交叉淡化，阅读面保持沉静。
        .id(card.id)
        .transition(.opacity)
        .animation(reduceMotion ? nil : Animation.easeInOut(duration: 0.22), value: card.id)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let onCompleteReading {
                HStack(spacing: 20) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("读完，再回忆一下。").font(InsightFont.bodyStrong)
                        Text("完成后计入今日目标，自动安排复习。")
                            .font(InsightFont.caption).foregroundStyle(InsightColor.textSecondary)
                    }
                    Spacer()
                    Button(action: onCompleteReading) {
                        Label("完成阅读", systemImage: "checkmark.circle").padding(.vertical, 6)
                    }.buttonStyle(.borderedProminent).tint(InsightColor.accent)
                }.padding(.horizontal, InsightLayout.readingPadding).padding(.vertical, 14)
                    .background(.regularMaterial)
                    .overlay(alignment: .top) { Divider() }
            }
        }
        .background(
            Group {
                // ⏎ 关闭（与主界面 ⏎ 开详情形成开合对）
                Button("") { onClose() }
                    .keyboardShortcut(.return, modifiers: [])
                    .frame(width: 0, height: 0)
                    .opacity(0)
                    .accessibilityHidden(true)
                // ⌘Z 撤销上一张：底层卡堆的同名快捷键在 sheet 打开时被禁用，故在此补上（与底部文案一致）
                if let onUndo {
                    Button("") { onUndo() }
                        .keyboardShortcut("z", modifiers: .command)
                        .frame(width: 0, height: 0)
                        .opacity(0)
                        .accessibilityHidden(true)
                }
            }
        )
        .overlay {
            if showPosterSheet {
                CardPosterExportSheet(card: card) {
                    showPosterSheet = false
                }
                .transition(.opacity.combined(with: .scale(scale: 0.98)))
            }
        }
        // 海报浮层的开合动画上下文（transition 此前已声明但没有动画可挂，等于摆设）
        .animation(reduceMotion ? nil : EditorialSpring.content, value: showPosterSheet)
        .sheet(isPresented: $showChatSheet) {
            CardFollowUpChatView(card: card, store: store, initialPrompt: pendingChatPrompt) {
                showChatSheet = false
                pendingChatPrompt = nil
            }
        }
        .sheet(isPresented: $showConsoleSheet) {
            SpeechConsoleView(store: store, onClose: {
                showConsoleSheet = false
            })
        }
        .onChange(of: card.id, initial: true) { _, _ in
            guard store.settings.autoSpeakOnDetailOpen,
                  !store.speechService.isAmbientMode,
                  store.speechService.state.activeCardId != card.id else { return }
            store.speechService.speak(card: card)
        }
    }

    private var chatTopButton: some View {
        Button(action: {
            pendingChatPrompt = nil
            showChatSheet = true
        }) {
            HStack(spacing: 4) {
                Image(systemName: "sparkles")
                    .font(.system(size: 11, weight: .semibold))
                Text("AI 追问")
                    .font(InsightFont.captionSmall)
            }
            .foregroundStyle(Color.white)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(Color.white.opacity(0.08), in: Capsule())
        }
        .buttonStyle(PressableButtonStyle(scale: 0.96))
        .keyboardShortcut("j", modifiers: .command)
        .help("向 AI 深入探讨此卡片知识 ⌘J")
    }

    private var aiCompanionBanner: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(InsightColor.accent)

                Text("AI 伴学透镜")
                    .font(InsightFont.headline)
                    .foregroundStyle(InsightColor.textPrimary)

                Text("⌘J")
                    .font(InsightFont.monoSmall)
                    .foregroundStyle(InsightColor.textTertiary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(InsightColor.surfaceSunken, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(InsightColor.border, lineWidth: 1))

                Spacer()

                Button(action: {
                    pendingChatPrompt = nil
                    showChatSheet = true
                }) {
                    HStack(spacing: 4) {
                        Text("自定义提问")
                            .font(InsightFont.captionSmall.weight(.medium))
                        Image(systemName: "arrow.up.right")
                            .font(.system(size: 9, weight: .semibold))
                    }
                    .foregroundStyle(InsightColor.textSecondary)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4.5)
                    .background(InsightColor.surfaceSunken, in: Capsule())
                    .overlay(Capsule().strokeBorder(InsightColor.border, lineWidth: 1))
                }
                .buttonStyle(PressableButtonStyle(scale: 0.96))
            }

            // 3 个即问即答高频速问药丸（一键直达，零等待零中间层）
            HStack(spacing: 10) {
                quickAskChip(
                    icon: "lightbulb.fill",
                    title: "通俗比喻",
                    prompt: "用小学生都能听懂的生活比喻，解释它的底层运转机理"
                )

                quickAskChip(
                    icon: "atom",
                    title: "现实应用",
                    prompt: "在工业界、现实生活或前沿科技中有哪些典型应用或反转案例？"
                )

                quickAskChip(
                    icon: "arrow.triangle.merge",
                    title: "跨界碰撞",
                    prompt: "这个概念与哪些其他学科存在意料之外的交叉与碰撞？"
                )
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous)
                .strokeBorder(InsightColor.border, lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.04), radius: 6, y: 2)
        .padding(.top, 18)
    }

    private func quickAskChip(icon: String, title: String, prompt: String) -> some View {
        Button(action: {
            AudioEffectManager.shared.playClick()
            pendingChatPrompt = prompt
            showChatSheet = true
        }) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(InsightColor.textSecondary)
                Text(title)
                    .font(InsightFont.caption.weight(.medium))
                    .foregroundStyle(InsightColor.textPrimary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .padding(.horizontal, 10)
            .background(InsightColor.surfaceSunken, in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
                    .strokeBorder(InsightColor.border, lineWidth: 1)
            )
        }
        .buttonStyle(PressableButtonStyle(scale: 0.97))
        .help("一键追问：\(prompt)")
    }

    private var favoriteButton: some View {
        Button(action: {
            if !isFavorited {
                AudioEffectManager.shared.playMasteryChime()
            }
            if let onToggleFavorite {
                onToggleFavorite()
            } else {
                onSwipe(isFavorited ? .left : .right)
            }
        }) {
            HStack(spacing: 4) {
                Image(systemName: isFavorited ? "bookmark.fill" : "bookmark")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(isFavorited ? InsightColor.warning : Color.white)
                Text(isFavorited ? "已收藏" : "收藏")
                    .font(InsightFont.captionSmall)
                    .foregroundStyle(Color.white)
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(Color.white.opacity(0.08), in: Capsule())
        }
        .buttonStyle(PressableButtonStyle(scale: 0.96))
        .animation(InsightMotion.tactile, value: isFavorited)
        .keyboardShortcut("d", modifiers: .command)
        .help(isFavorited ? "取消收藏 ⌘D" : "加入知识收藏阁 ⌘D")
    }

    private var shareButton: some View {
        Button(action: { showPosterSheet = true }) {
            HStack(spacing: 4) {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 11, weight: .semibold))
                Text("海报")
                    .font(InsightFont.captionSmall)
            }
            .foregroundStyle(Color.white)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(Color.white.opacity(0.08), in: Capsule())
        }
        .buttonStyle(PressableButtonStyle(scale: 0.96))
        .keyboardShortcut("s", modifiers: .command)
        .help("导出画报长图/拍立得分享海报 ⌘S")
    }

    private var closeButton: some View {
        Button(action: onClose) {
            Image(systemName: "xmark")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Color.white)
                .frame(width: 28, height: 28)
                .background(Color.black.opacity(0.50), in: Circle())
                .overlay(Circle().strokeBorder(Color.white.opacity(0.15), lineWidth: 1))
        }
        .buttonStyle(PressableButtonStyle(scale: 0.94))
        .keyboardShortcut(.escape, modifiers: [])
        .accessibilityLabel("关闭详情")
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
                    .font(InsightFont.callout)
                    .foregroundStyle(InsightColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer()
                Text(displayHost(link.url))
                    .font(InsightFont.caption)
                    .foregroundStyle(InsightColor.textTertiary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
                    .strokeBorder(InsightColor.border, lineWidth: 1)
            )
        }
        .buttonStyle(PressableButtonStyle(scale: 0.985))
    }

    private func actionButton(title: String, icon: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(InsightFont.bodyStrong)
                .foregroundStyle(tint)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
                        .strokeBorder(tint.opacity(0.24), lineWidth: 1)
                )
        }
        .buttonStyle(PressableButtonStyle(scale: 0.98))
    }

    /// 左右导航按钮：键盘 ←/→ 直接切卡
    private func navButton(icon: String, help: String, disabled: Bool, shortcut: KeyEquivalent, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(disabled ? InsightColor.textMuted.opacity(0.4) : InsightColor.textSecondary)
                .frame(width: 44, height: 40)
                .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
                        .strokeBorder(InsightColor.border, lineWidth: 1)
                )
        }
        .buttonStyle(PressableButtonStyle(scale: 0.98))
        .disabled(disabled)
        .keyboardShortcut(shortcut, modifiers: [])
        .help(help)
        .accessibilityLabel(help)
    }

    // MARK: - 相关灵感脉络 (Connected Cards)

    @ViewBuilder
    private var relatedCardsSection: some View {
        if !relatedCards.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Image(systemName: "cpu")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(InsightColor.warning)
                    Text("相关灵感脉络")
                        .font(InsightFont.headline)
                        .foregroundStyle(InsightColor.textPrimary)

                    Spacer()

                    Text("知识网状联想")
                        .font(InsightFont.captionSmall)
                        .foregroundStyle(InsightColor.textMuted)
                }
                .padding(.top, 18)

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
                                        .foregroundStyle(InsightColor.textTertiary)
                                        .padding(.leading, 2)
                                }
                                .frame(width: 96, alignment: .leading)

                                // 标题与推荐理由
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(item.card.displayHeadline)
                                        .font(.system(size: 13.5, weight: .semibold))
                                        .foregroundStyle(InsightColor.textPrimary)
                                        .fixedSize(horizontal: false, vertical: true)
                                        .multilineTextAlignment(.leading)

                                    if !item.reason.isEmpty {
                                        Text(item.reason)
                                            .font(.system(size: 11, weight: .regular))
                                            .foregroundStyle(InsightColor.textMuted)
                                            .fixedSize(horizontal: false, vertical: true)
                                    }
                                }

                                Spacer()

                                Image(systemName: "chevron.right")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(InsightColor.textMuted)
                                    .padding(.top, 4)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 11)
                            .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .strokeBorder(InsightColor.border, lineWidth: 1)
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
            return InsightColor.warning
        case .conceptBridge:
            return InsightColor.success
        case .serendipity:
            return Color(red: 0.85, green: 0.45, blue: 0.85)
        }
    }

    // MARK: - 语音朗读声学导读组件

    private var speechTopButton: some View {
        let service = store.speechService
        let isSpeakingThis = service.state.activeCardId == card.id && service.state.isPlaying

        return Button {
            service.togglePlayPause(for: card)
            HapticFeedbackHelper.shared.cardSnapBack()
        } label: {
            HStack(spacing: 4) {
                Image(systemName: isSpeakingThis ? "pause.fill" : "speaker.wave.2")
                    .font(.system(size: 11, weight: .semibold))
                Text(isSpeakingThis ? "暂停" : "朗读")
                    .font(InsightFont.captionSmall)
            }
            .foregroundStyle(isSpeakingThis ? InsightColor.success : Color.white)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(isSpeakingThis ? InsightColor.success.opacity(0.2) : Color.white.opacity(0.08), in: Capsule())
        }
        .buttonStyle(PressableButtonStyle(scale: 0.96))
        .keyboardShortcut("p", modifiers: .command)
        .help(isSpeakingThis ? "暂停朗读 ⌘P" : "朗读全文 ⌘P")
    }

    private var audioPlayerBar: some View {
        let service = store.speechService
        let isSpeakingThis = service.state.activeCardId == card.id && service.state.isPlaying
        let isPausedThis = service.state.activeCardId == card.id && service.state.isPaused
        let progress = (service.state.activeCardId == card.id) ? service.state.progress : 0.0

        return VStack(spacing: 10) {
            HStack(spacing: 12) {
                // 播放 / 暂停按键
                Button {
                    service.togglePlayPause(for: card)
                    HapticFeedbackHelper.shared.cardSnapBack()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: isSpeakingThis ? "pause.fill" : "play.fill")
                            .font(.system(size: 11, weight: .bold))
                        Text(isSpeakingThis ? "暂停" : (isPausedThis ? "继续" : "导读"))
                            .font(InsightFont.caption.weight(.medium))
                    }
                    .foregroundStyle(isSpeakingThis ? Color.black : InsightColor.textPrimary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(
                        isSpeakingThis ? Color.white : InsightColor.surfaceSunken,
                        in: Capsule()
                    )
                    .overlay(
                        Capsule().strokeBorder(
                            isSpeakingThis ? Color.white : InsightColor.border,
                            lineWidth: 1
                        )
                    )
                    .animation(InsightMotion.tactile, value: isSpeakingThis)
                }
                .buttonStyle(PressableButtonStyle(scale: 0.96))

                // 声浪跳动条
                AudioWaveformBars(isPlaying: isSpeakingThis)
                    .frame(width: 22, height: 15)

                if isSpeakingThis || isPausedThis {
                    Text("\(Int(progress * 100))%")
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .monospacedDigit()
                        .foregroundStyle(isSpeakingThis ? InsightColor.textPrimary : InsightColor.textSecondary)
                        .contentTransition(.numericText())
                        .animation(reduceMotion ? nil : InsightMotion.value, value: progress)
                }

                Spacer()

                // 语速切换
                Menu {
                    ForEach(Self.speedTiers, id: \.rate) { tier in
                        Button(tier.label) {
                            store.applySettingsChange { $0.speechRate = tier.rate }
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "waveform")
                            .font(.system(size: 10, weight: .bold))
                        Text(speedLabel(for: service.speedMultiplier))
                            .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    }
                    .foregroundStyle(InsightColor.textSecondary)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(InsightColor.surfaceSunken, in: Capsule())
                    .overlay(Capsule().strokeBorder(InsightColor.border, lineWidth: 1))
                }
                .menuStyle(.borderlessButton)
                .fixedSize()

                // 语音听书控制台
                Button {
                    showConsoleSheet = true
                    HapticFeedbackHelper.shared.cardSnapBack()
                } label: {
                    Image(systemName: "slider.horizontal.3")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(InsightColor.textSecondary)
                        .frame(width: 28, height: 28)
                        .background(InsightColor.surfaceSunken, in: Circle())
                        .overlay(Circle().strokeBorder(InsightColor.border, lineWidth: 1))
                }
                .buttonStyle(PressableButtonStyle(scale: 0.96))
                .help("语音听书控制台：进度定位、语速音调与睡眠定时")
                .accessibilityLabel("语音听书控制台")

                // 重新朗读
                Button {
                    service.speak(card: card, part: .full)
                    HapticFeedbackHelper.shared.cardSnapBack()
                } label: {
                    Image(systemName: "arrow.counterclockwise")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(InsightColor.textSecondary)
                        .frame(width: 28, height: 28)
                        .background(InsightColor.surfaceSunken, in: Circle())
                        .overlay(Circle().strokeBorder(InsightColor.border, lineWidth: 1))
                }
                .buttonStyle(PressableButtonStyle(scale: 0.96))
                .help("从头重新朗读")
            }

            // 朗读进度条
            if isSpeakingThis || isPausedThis {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(InsightColor.border)
                            .frame(height: 3)

                        Capsule()
                            .fill(InsightColor.accent)
                            .frame(width: max(3, geo.size.width * CGFloat(progress)), height: 3)
                    }
                }
                .frame(height: 3)
                .animation(reduceMotion ? nil : .linear(duration: 0.3), value: progress)
            }
        }
        .animation(reduceMotion ? nil : InsightMotion.shell, value: isSpeakingThis || isPausedThis)
        .padding(14)
        .background(
            InsightColor.surface,
            in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous)
                .strokeBorder(InsightColor.border, lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.04), radius: 6, y: 2)
        .padding(.top, 14)
    }

    /// 语速档位与展示名（与 Android 端 AudioConsoleSheet 同档）
    static let speedTiers: [(label: String, rate: Float)] = [
        ("0.75x 慢速精听", 0.75),
        ("1.0x 正常标准", 1.0),
        ("1.25x 高效快读", 1.25),
        ("1.5x 快速浏览", 1.5),
        ("2.0x 极速浏览", 2.0),
    ]

    private func speedLabel(for rate: Float) -> String {
        if abs(rate - 0.75) < 0.05 { return "0.75x" }
        if abs(rate - 1.0) < 0.05 { return "1.0x" }
        if abs(rate - 1.25) < 0.05 { return "1.25x" }
        if abs(rate - 1.5) < 0.05 { return "1.5x" }
        if abs(rate - 2.0) < 0.05 { return "2.0x" }
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
