import SwiftUI
import KnowFlickCore

/// 模态弹窗类型（统一入口，彻底杜绝 macOS SwiftUI 多 sheet 链式挂载相互覆盖失效）
enum ActiveSheet: Identifiable {
    case detail(KnowledgeCard)
    case sharePoster(KnowledgeCard)
    case favorites
    case settings
    case stats
    case history
    case help
    case quiz(category: String?)
    case graph
    case chat(KnowledgeCard)
    case search
    case exportCards([KnowledgeCard]?)
    case importNotes
    case plannedReview([KnowledgeCard])
    case editCard(KnowledgeCard)

    var id: String {
        switch self {
        case .detail(let card): return "detail_\(card.id.uuidString)"
        case .sharePoster(let card): return "poster_\(card.id.uuidString)"
        case .favorites: return "favorites"
        case .settings: return "settings"
        case .stats: return "stats"
        case .history: return "history"
        case .help: return "help"
        case .quiz(let cat): return "quiz_\(cat ?? "all")"
        case .graph: return "graph"
        case .chat(let card): return "chat_\(card.id.uuidString)"
        case .search: return "search"
        case .exportCards: return "exportCards"
        case .importNotes: return "importNotes"
        case .plannedReview: return "plannedReview"
        case .editCard(let card): return "edit_\(card.id)"
        }
    }
}

/// 卡片堆叠主界面：左右拖动划走、点击看详情
struct CardDeckView: View {
    @Bindable var store: AppStore

    // 拖拽手势状态（1:1 直接跟随指针，无插值延迟）
    @State private var dragOffset: CGSize = .zero
    @State private var swipeDirection: SwipeDirection? = nil

    // 独立悬浮飞出层（划走瞬间解耦，底层卡堆直接就位，彻底解决闪烁与瞬跳）
    @State private var swipingCard: KnowledgeCard? = nil
    @State private var swipingOffset: CGSize = .zero
    @State private var swipingDirection: SwipeDirection? = nil

    @State private var activeSheet: ActiveSheet? = nil
    @State private var errorBanner = false
    @State private var errorToken = 0
    @State private var triggerSheen = false
    @State private var showingWorkspace = true

    /// 三个知识来源（预置库 / AI 生成）全关时队列恒为空，空状态需给出可行动引导
    private var allSourcesDisabled: Bool {
        !store.settings.enableSeed && !store.settings.enableAI
    }

    // 同步计算当前主题，绝不在 .task 异步延迟加载，杜绝换卡时背景与边框闪烁
    private var currentTheme: CategoryTheme {
        CategoryTheme.theme(for: swipingCard ?? store.topCard, cache: .shared)
    }

    var body: some View {
        ZStack {
            ambientBackground
                .ignoresSafeArea()
                .animation(.easeInOut(duration: 0.45), value: (swipingCard ?? store.topCard)?.id.uuidString ?? "")

            Group {
                if showingWorkspace {
                    LearningWorkspaceView(store: store, open: { activeSheet = $0 }, explore: { showingWorkspace = false })
                } else {
            VStack(spacing: 0) {
                topBar
                    .padding(.horizontal, 30)
                    .padding(.top, 20)
                    .zIndex(100)

                if store.speechService.isPreparing {
                    ProgressView("正在合成语音…").controlSize(.small).padding(.top, 6)
                }
                if let message = store.speechService.lastError {
                    Text(message).font(EditorialFont.caption)
                        .foregroundStyle(EditorialColor.aiAmber)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 30)
                }
                Spacer(minLength: 8)

                // 卡片堆叠区
                ZStack {
                    if let top = store.topCard {
                        cardStack(top: top)
                    } else if swipingCard == nil {
                        emptyState
                            .transition(.opacity.combined(with: .scale(scale: 0.96)))
                    }

                    // 独立悬浮飞出层：划出中的卡片在此独立飞离屏幕并淡出，与底层卡堆完全解耦
                    if let flyingCard = swipingCard {
                        flyingCardView(flyingCard)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.horizontal, 95)
                .padding(.vertical, 16)
                .gesture(topCardGesture)

                Spacer(minLength: 8)

                if store.speechService.isAmbientMode {
                    AmbientAudioPlayerBar(
                        store: store,
                        isTransitioning: swipingCard != nil,
                        onPrevious: {
                            withAnimation(.spring(response: 0.35, dampingFraction: 0.78)) {
                                store.undoLastSwipe()
                                if let top = store.topCard {
                                    store.speechService.speak(card: top, part: .full)
                                }
                            }
                        },
                        onNext: {
                            if store.topCard != nil {
                                performSwipe(.skip)
                                if let next = store.topCard {
                                    store.speechService.speak(card: next, part: .full)
                                }
                            }
                        },
                        onClose: {
                            withAnimation(.spring(response: 0.35, dampingFraction: 0.78)) {
                                store.speechService.stopAmbientMode()
                            }
                        }
                    )
                    .padding(.bottom, 10)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(101)
                }

                bottomBar
                    .padding(.bottom, 26)
                    .zIndex(100)
            }
                }
            }
            .focusedSceneValue(\.macActions, MacActions(
                canOpen: activeSheet == nil,
                hasCard: store.topCard != nil,
                open: { activeSheet = $0 },
                toggleSpeech: {
                    if let card = store.topCard { store.speechService.togglePlayPause(for: card) }
                },
                toggleAmbient: {
                    store.toggleAmbientSpeechMode()
                },
                generate: {
                    if !store.settings.isAIConfigured {
                        activeSheet = .settings
                    } else {
                        Task { await store.generateNewCards(count: 3) }
                    }
                },
                chat: {
                    if let card = store.topCard { activeSheet = .chat(card) }
                },
                sharePoster: {
                    if let card = store.topCard { activeSheet = .sharePoster(card) }
                },
                refreshDeck: {
                    triggerSheen.toggle()
                    Task { await store.refreshDeck() }
                }
            ))
            .sheet(item: $activeSheet) { sheet in
                switch sheet {
                case .detail(let card):
                    DetailView(
                        card: card,
                        store: store,
                        showAIMark: store.settings.showAIMark,
                        hasPrevious: store.history.first != nil,
                        hasNext: store.deck.count > 1,
                        onSwipe: { direction in
                            store.swipe(card, direction: direction)
                            // 连续刷卡：直接切到下一张；刷完则关闭
                            if let next = store.topCard { activeSheet = .detail(next) } else { activeSheet = nil }
                        },
                        onToggleFavorite: {
                            store.toggleFavorite(card)
                        },
                        onNext: {
                            if let next = store.topCard, next.id != card.id { activeSheet = .detail(next) }
                        },
                        onPrevious: {
                            if let prev = store.history.first { activeSheet = .detail(prev) }
                        },
                        onClose: { activeSheet = nil },
                        relatedCards: store.getRelatedCards(for: card),
                        onSelectCard: { target in
                            activeSheet = .detail(target)
                        },
                        onCompleteReading: showingWorkspace ? {
                            store.completeReading(card)
                            activeSheet = nil
                        } : nil,
                        onUndo: {
                            withAnimation(.spring(response: 0.35, dampingFraction: 0.78)) {
                                store.undoLastSwipe()
                            }
                            // 撤销后详情页跟随回到新的顶卡，避免停留在已撤销的卡片上
                            if let top = store.topCard { activeSheet = .detail(top) } else { activeSheet = nil }
                        }
                    )
                case .sharePoster(let card):
                    CardPosterExportSheet(card: card) {
                        activeSheet = nil
                    }
                case .favorites:
                    FavoritesView(store: store, showAIMark: store.settings.showAIMark, onClose: {
                        activeSheet = nil
                    })
                case .settings:
                    SettingsView(store: store)
                case .stats:
                    StatsView(store: store) {
                        activeSheet = nil
                    }
                case .history:
                    HistoryView(store: store, showAIMark: store.settings.showAIMark) {
                        activeSheet = nil
                    }
                case .help:
                    HelpView {
                        activeSheet = nil
                    }
                case .quiz(let category):
                    QuizView(store: store, category: category) {
                        activeSheet = nil
                    }
                case .graph:
                    KnowledgeGraphView(
                        store: store,
                        onSelectCard: { card in
                            activeSheet = .detail(card)
                        },
                        onClose: {
                            activeSheet = nil
                        }
                    )
                case .chat(let card):
                    CardFollowUpChatView(card: card, store: store) {
                        activeSheet = nil
                    }
                case .search:
                    GlobalSearchModalView(
                        store: store,
                        onSelect: { card in
                            activeSheet = .detail(card)
                        },
                        onPromote: { card in
                            store.promoteToDeckTop(card)
                            activeSheet = nil
                        },
                        onChat: { card in
                            activeSheet = .chat(card)
                        }
                    )
                case .exportCards(let cards):
                    ExportCardsModalView(store: store, initialScopeCards: cards) {
                        activeSheet = nil
                    }
                case .importNotes:
                    ImportNotesModalView(store: store) {
                        activeSheet = nil
                    }
                case .plannedReview(let cards):
                    QuizView(store: store, plannedCards: cards) { activeSheet = nil }
                case .editCard(let card):
                    CardEditorView(card: card, store: store) { activeSheet = nil }
                }
            }
        }
        .onChange(of: store.topCard?.id) { _, _ in
            triggerSheen.toggle()
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let warning = store.persistenceWarning {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "externaldrive.badge.exclamationmark")
                        .foregroundStyle(EditorialColor.aiAmber)
                    Text(warning).font(EditorialFont.labelSmall)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                    Spacer(minLength: 8)
                    Button("重试保存") { store.retryPersistence() }.buttonStyle(.bordered)
                }
                .padding(16)
                .background(.regularMaterial)
            }
        }
        .onChange(of: store.lastError) { _, err in
            if err != nil {
                errorBanner = true
                errorToken &+= 1
            }
        }

        .overlay(alignment: .top) {
            if errorBanner, let msg = store.lastError {
                errorToast(msg)
                    .id(errorToken)
            }
        }
    }

    // MARK: - 可见卡片栈（最多 3 张）

    private var visibleStack: [KnowledgeCard] {
        Array(store.deck.prefix(3))
    }

    @ViewBuilder
    private func cardStack(top: KnowledgeCard) -> some View {
        ForEach(Array(visibleStack.enumerated()), id: \.element.id) { index, card in
            stackedCard(card: card, index: index, top: top)
        }
    }

    @ViewBuilder
    private func stackedCard(card: KnowledgeCard, index: Int, top: KnowledgeCard) -> some View {
        let isTop = (index == 0)
        let base = CardView(
            card: card,
            showAIMark: store.settings.showAIMark,
            isTop: isTop,
            dragOffset: isTop ? dragOffset : .zero,
            triggerSheen: triggerSheen
        )
        .scaleEffect(scaleFor(index: index))
        .offset(y: offsetYFor(index: index))

        if isTop {
            base
                .offset(dragOffset)
                .rotationEffect(rotationAngle)
                .overlay(swipeBadge)
                .zIndex(Double(visibleStack.count))
                .contentShape(RoundedRectangle(cornerRadius: EditorialRadius.card, style: .continuous))
                .onTapGesture {
                    if swipingCard == nil && abs(dragOffset.width) < 10 {
                        activeSheet = .detail(top)
                    }
                }
                .contextMenu {
                    Button {
                        activeSheet = .sharePoster(top)
                    } label: {
                        Label("生成分享海报... ⌘S", systemImage: "square.and.arrow.up")
                    }
                    Button {
                        activeSheet = .detail(top)
                    } label: {
                        Label("查看卡片详情 ⏎", systemImage: "arrow.up.left.and.arrow.down.right")
                    }
                    Button {
                        activeSheet = .quiz(category: top.category)
                    } label: {
                        Label("开启 \(top.category) 知识测验", systemImage: "graduationcap")
                    }
                    Button {
                        activeSheet = .graph
                    } label: {
                        Label("在全景星图中探索 ⌘G", systemImage: "point.3.filled.connected.trianglepath.dotted")
                    }
                    Button {
                        activeSheet = .chat(top)
                    } label: {
                        Label("向卡片追问 (AI 伴学) ⌘J", systemImage: "sparkles")
                    }
                    Divider()
                    Button {
                        store.toggleSpeechForTopCard()
                    } label: {
                        Label(
                            store.speechService.state.isPlaying ? "暂停朗读 ⌘P" : "朗读卡片观点 ⌘P",
                            systemImage: store.speechService.state.isPlaying ? "pause.fill" : "speaker.wave.2"
                        )
                    }
                    Button {
                        store.toggleAmbientSpeechMode()
                    } label: {
                        Label(
                            store.speechService.isAmbientMode ? "退出磨耳朵连续播报" : "开启磨耳朵连续播报",
                            systemImage: "headphones"
                        )
                    }
                    Divider()
                    Button {
                        performSwipe(.right)
                    } label: {
                        Label("感兴趣 →", systemImage: "heart")
                    }
                    Button {
                        performSwipe(.left)
                    } label: {
                        Label("不喜欢 ←", systemImage: "xmark")
                    }
                }
        } else {
            base
                .zIndex(Double(visibleStack.count - index))
        }
    }

    // MARK: - 独立悬浮飞出视图

    @ViewBuilder
    private func flyingCardView(_ card: KnowledgeCard) -> some View {
        let degrees = Double(swipingOffset.width / 18)
        let clampedDegrees = min(max(degrees, -20), 20)

        CardView(
            card: card,
            showAIMark: store.settings.showAIMark,
            isTop: true,
            dragOffset: swipingOffset,
            triggerSheen: false
        )
        .offset(swipingOffset)
        .rotationEffect(.degrees(clampedDegrees))
        .overlay(flyingSwipeBadge)
        .opacity(max(0, 1.0 - (abs(swipingOffset.width) - 180) / 450))
        .zIndex(999)
        .allowsHitTesting(false)
    }

    // MARK: - 手势驱动

    private var topCardGesture: some Gesture {
        DragGesture(minimumDistance: 6)
            .onChanged { value in
                guard store.topCard != nil, swipingCard == nil else { return }
                dragOffset = value.translation
                let isRight = value.translation.width > 24
                let isLeft = value.translation.width < -24
                swipeDirection = isRight ? .right : (isLeft ? .left : nil)

                let transAbs = abs(value.translation.width)
                if transAbs >= 85 {
                    HapticFeedbackHelper.shared.cardThresholdReached()
                } else if transAbs >= 24 {
                    HapticFeedbackHelper.shared.dragInitiated()
                    HapticFeedbackHelper.shared.resetThreshold()
                } else {
                    HapticFeedbackHelper.shared.resetThreshold()
                }
            }
            .onEnded { value in
                guard swipingCard == nil else { return }
                let threshold: CGFloat = 85
                let predictedEnd = value.predictedEndTranslation.width
                // 结合位移与加速度释放
                let shouldSwipeRight = value.translation.width > threshold || (value.translation.width > 30 && predictedEnd > 200)
                let shouldSwipeLeft = value.translation.width < -threshold || (value.translation.width < -30 && predictedEnd < -200)

                if shouldSwipeRight {
                    performSwipe(.right)
                } else if shouldSwipeLeft {
                    performSwipe(.left)
                } else {
                    HapticFeedbackHelper.shared.cardSnapBack()
                    withAnimation(.spring(response: 0.34, dampingFraction: 0.72)) {
                        dragOffset = .zero
                        swipeDirection = nil
                    }
                }
            }
    }

    private func performSwipe(_ direction: SwipeDirection) {
        guard let card = store.topCard else { return }
        guard swipingCard == nil else { return }
        HapticFeedbackHelper.shared.cardSwiped()

        let initialOffset = dragOffset
        swipingCard = card
        swipingOffset = initialOffset
        swipingDirection = direction

        // 立即将 store 里的卡片划走，并无动画重置底层卡堆的拖拽偏移
        var noAnimation = Transaction()
        noAnimation.disablesAnimations = true
        withTransaction(noAnimation) {
            dragOffset = .zero
            swipeDirection = nil
            store.swipe(card, direction: direction)
        }

        // 飞出动画：处于独立悬浮层的 swipingCard 顺滑飞离屏幕并渐隐
        let targetX: CGFloat = direction == .left ? -760 : 760
        let targetY: CGFloat = initialOffset.height * 0.35 + (direction == .left ? -20 : 20)

        withAnimation(.easeOut(duration: 0.24)) {
            swipingOffset = CGSize(width: targetX, height: targetY)
        }

        // 飞离视野后安全销毁临时悬浮卡
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            swipingCard = nil
            swipingOffset = .zero
            swipingDirection = nil
        }
    }

    // MARK: - 布局与 3D 动力学参数

    private var rotationAngle: Angle {
        let degrees = Double(dragOffset.width / 18)   // 偏航倾斜
        return .degrees(min(max(degrees, -16), 16))
    }

    private func scaleFor(index: Int) -> CGFloat {
        let baseScale = 1.0 - CGFloat(index) * 0.045
        if index == 0 {
            let progress = min(1.0, abs(dragOffset.width) / 500)
            return 1.0 - progress * 0.025
        } else if index == 1 {
            // 顶卡拖动时，第二张卡平滑向前浮起放大
            let progress = min(1.0, abs(dragOffset.width) / 320)
            return baseScale + progress * 0.045
        } else {
            return baseScale
        }
    }

    private func offsetYFor(index: Int) -> CGFloat {
        let baseOffset = CGFloat(index) * 18   // 典雅层叠错位
        if index == 0 {
            return -abs(dragOffset.width) * 0.035
        } else if index == 1 {
            // 顶卡拖动时，第二张卡平滑向上抬升归位
            let progress = min(1.0, abs(dragOffset.width) / 320)
            return baseOffset - progress * 18
        } else {
            return baseOffset
        }
    }

    private var swipeBadge: some View {
        Group {
            if let dir = swipeDirection {
                VStack {
                    HStack {
                        if dir == .left {
                            badge("不喜欢", color: EditorialColor.dislikeRed, icon: "xmark")
                            Spacer()
                        } else {
                            Spacer()
                            badge("感兴趣", color: EditorialColor.likeGreen, icon: "heart.fill")
                        }
                    }
                    Spacer()
                }
                .padding(24)
                .opacity(min(1, abs(dragOffset.width) / 85))   // 徽章平滑浮现
            }
        }
    }

    private var flyingSwipeBadge: some View {
        Group {
            if let dir = swipingDirection {
                VStack {
                    HStack {
                        if dir == .left {
                            badge("不喜欢", color: EditorialColor.dislikeRed, icon: "xmark")
                            Spacer()
                        } else {
                            Spacer()
                            badge("感兴趣", color: EditorialColor.likeGreen, icon: "heart.fill")
                        }
                    }
                    Spacer()
                }
                .padding(24)
                .opacity(min(1, abs(swipingOffset.width) / 85))
            }
        }
    }

    private func badge(_ text: String, color: Color, icon: String) -> some View {
        Label(text, systemImage: icon)
            .font(.system(size: 18, weight: .bold))
            .tracking(1.2)
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .background(Color.black.opacity(0.45), in: RoundedRectangle(cornerRadius: EditorialRadius.pill, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: EditorialRadius.pill, style: .continuous)
                    .strokeBorder(color, lineWidth: 2.2)
            )
            .foregroundStyle(color)
            .shadow(color: color.opacity(0.35), radius: 10, y: 3)
    }

    // MARK: - 顶栏

    private var topBar: some View {
        HStack {
            Button { showingWorkspace = true } label: {
                Image(systemName: "arrow.left").padding(10)
            }.buttonStyle(.plain).help("返回学习工作台")
            VStack(alignment: .leading, spacing: 2) {
                Text("KnowFlick")
                    .font(EditorialFont.modalTitle)
                    .foregroundStyle(EditorialColor.textPrimary)
                HStack(spacing: 6) {
                    Text("今天也想学点新东西")
                        .font(.system(size: 11.5, weight: .medium))
                        .tracking(0.5)
                        .foregroundStyle(EditorialColor.textTertiary)
                    if store.deck.count > 0 {
                        Text("· \(store.deck.count) 张待刷")
                            .font(.system(size: 11.5, weight: .medium))
                            .foregroundStyle(EditorialColor.textMuted)
                    }
                }
            }

            Spacer()

            HStack(spacing: 12) {
                if store.isGenerating {
                    HStack(spacing: 6) {
                        ProgressView()
                            .controlSize(.small)
                            .tint(.white)
                        Text("正在收集新知识…")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(EditorialColor.textSecondary)
                    }
                    .padding(.horizontal, 13)
                    .padding(.vertical, 7)
                    .background(EditorialColor.glassSurface, in: Capsule())
                    .overlay(Capsule().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                }

                // 全局搜索快捷入口
                Button {
                    activeSheet = .search
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(EditorialColor.aiAmber)
                        Text("搜索")
                            .font(EditorialFont.labelSmall)
                            .foregroundStyle(EditorialColor.textSecondary)
                        Text("⌘F")
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .foregroundStyle(EditorialColor.textMuted)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 4))
                    }
                    .padding(.horizontal, 11)
                    .padding(.vertical, 6.5)
                    .background(EditorialColor.glassSurface, in: Capsule())
                    .overlay(Capsule().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                }
                .buttonStyle(PressableButtonStyle())
                .keyboardShortcut("f", modifiers: .command)
                .help("全局智能搜索与全文检索 ⌘F")

                // 语音朗读 / 磨耳朵
                iconButton(
                    store.speechService.isAmbientMode ? "headphones.circle.fill" : "headphones",
                    help: store.speechService.isAmbientMode ? "退出磨耳朵连续朗读 ⇧⌘P" : "磨耳朵连续朗读 ⇧⌘P"
                ) {
                    store.toggleAmbientSpeechMode()
                }
                .keyboardShortcut("p", modifiers: [.command, .shift])
                .disabled(store.topCard == nil)

                iconButton(store.settings.appearance.icon, help: "外观：\(store.settings.appearance.title)（点击切换）") {
                    let all = AppearanceMode.allCases
                    let currentIndex = all.firstIndex(of: store.settings.appearance) ?? 0
                    let nextIndex = (currentIndex + 1) % all.count
                    let nextMode = all[nextIndex]
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.75)) {
                        store.settings.appearance = nextMode
                    }
                    HapticFeedbackHelper.shared.cardSnapBack()
                    try? store.saveSettings(store.settings)
                }
                Menu {
                    Section("探索与学习") {
                        Button("全局搜索", systemImage: "magnifyingglass") { activeSheet = .search }
                            .keyboardShortcut("f", modifiers: .command)
                        Button("知识测验", systemImage: "graduationcap") { activeSheet = .quiz(category: nil) }
                        Button("知识星图", systemImage: "point.3.connected.trianglepath.dotted") { activeSheet = .graph }
                        Button(store.speechService.isAmbientMode ? "停止连续朗读" : "连续朗读", systemImage: "headphones") {
                            store.toggleAmbientSpeechMode()
                        }
                        .keyboardShortcut("p", modifiers: [.command, .shift])
                        .disabled(store.topCard == nil)
                        Button("知识收藏阁", systemImage: "bookmark") { activeSheet = .favorites }
                        Button("学习统计", systemImage: "chart.bar") { activeSheet = .stats }
                        Button("历史记录", systemImage: "clock") { activeSheet = .history }
                    }
                    Section("卡库管理") {
                        Button("换一批新知识", systemImage: "arrow.clockwise") {
                            triggerSheen.toggle()
                            Task { await store.refreshDeck() }
                        }
                        Button("重新探索全部卡片", systemImage: "arrow.counterclockwise") {
                            withAnimation(.spring(response: 0.35, dampingFraction: 0.75)) {
                                store.clearHistory()
                            }
                        }
                        Button("偏好设置", systemImage: "gearshape") { activeSheet = .settings }
                        Button("快捷键帮助", systemImage: "questionmark.circle") { activeSheet = .help }
                    }
                } label: {
                    Label("菜单", systemImage: "line.3.horizontal")
                        .font(EditorialFont.label)
                        .padding(.horizontal, 13)
                        .padding(.vertical, 8)
                        .background(EditorialColor.glassSurface, in: Capsule())
                        .overlay(Capsule().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .accessibilityLabel("展开功能菜单")

            }
        }
        .foregroundStyle(EditorialColor.textPrimary)
    }

    private func iconButton(_ icon: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 14.5, weight: .semibold))
                .foregroundStyle(EditorialColor.textSecondary)
                .frame(width: 35, height: 35)
                .background(EditorialColor.glassSurface, in: Circle())
                .overlay(Circle().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
        }
        .buttonStyle(PressableButtonStyle())
        .help(help)
    }

    // MARK: - 底栏

    private var bottomBar: some View {
        HStack(spacing: 24) {
            roundButton("arrow.uturn.backward", size: 42, tint: EditorialColor.textSecondary, help: "撤销上一张 ⌘Z") {
                withAnimation(.spring(response: 0.35, dampingFraction: 0.78)) {
                    store.undoLastSwipe()
                }
            }
            .keyboardShortcut("z", modifiers: .command)
            .disabled(store.history.isEmpty || swipingCard != nil || activeSheet != nil)

            roundButton("xmark", size: 60, tint: EditorialColor.dislikeRed, help: "不喜欢 ←") {
                performSwipe(.left)
            }
            .keyboardShortcut(.leftArrow, modifiers: [])
            .disabled(store.topCard == nil || swipingCard != nil)

            roundButton("arrow.up.left.and.arrow.down.right", size: 50, tint: EditorialColor.textPrimary, help: "查看详情 ⏎") {
                if let card = store.topCard { activeSheet = .detail(card) }
            }
            .keyboardShortcut(.return, modifiers: [])
            .disabled(store.topCard == nil || swipingCard != nil)

            roundButton("heart.fill", size: 60, tint: EditorialColor.likeGreen, help: "感兴趣 →") {
                performSwipe(.right)
            }
            .keyboardShortcut(.rightArrow, modifiers: [])
            .disabled(store.topCard == nil || swipingCard != nil)

            roundButton("dice", size: 42, tint: EditorialColor.aiAmber, help: !store.settings.isAIConfigured ? "配置 AI 后可生成新卡" : "AI 生成 3 张新卡 ⌘N") {
                if !store.settings.isAIConfigured {
                    activeSheet = .settings
                } else {
                    Task { await store.generateNewCards(count: 3) }
                }
            }
            .keyboardShortcut("n", modifiers: .command)

            Button("") {
                if let top = store.topCard {
                    activeSheet = .chat(top)
                }
            }
            .keyboardShortcut("j", modifiers: .command)
            .opacity(0)
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)
        }
        .padding(.horizontal, 30)
        .padding(.vertical, 16)
        .background(EditorialColor.glassSurface, in: Capsule())
        .overlay(Capsule().strokeBorder(EditorialColor.glassBorder, lineWidth: 1.2))
        .shadow(
            color: EditorialColor.dynamic(
                light: NSColor.black.withAlphaComponent(0.12),
                dark: NSColor.black.withAlphaComponent(0.40)
            ),
            radius: 24,
            y: 12
        )
    }

    private func roundButton(_ icon: String, size: CGFloat, tint: Color, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: size * 0.36, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: size, height: size)
                .background(EditorialColor.glassSurface, in: Circle())
                .overlay(Circle().strokeBorder(tint.opacity(0.5), lineWidth: 1.3))
                .shadow(color: tint.opacity(0.2), radius: 6, y: 2)
        }
        .buttonStyle(PressableButtonStyle())
        .help(help)
    }

    // MARK: - 空状态

    private var emptyStateSubtitle: String {
        if allSourcesDisabled {
            return "当前已关闭全部知识来源（预置精选库与 AI 生成），开启后即可继续刷卡片"
        }
        return !store.settings.isAIConfigured
            ? "去设置里配置 AI 服务，就能持续生成新知识"
            : "让 AI 为你生成一批新的冷知识"
    }

    private var emptyState: some View {
        VStack(spacing: 18) {
            Image(systemName: "sparkles")
                .font(.system(size: 44))
                .foregroundStyle(EditorialColor.textTertiary)
            Text("今天的知识刷完了")
                .font(EditorialFont.detailHeadline)
                .foregroundStyle(EditorialColor.textPrimary)
            Text(emptyStateSubtitle)
                .font(EditorialFont.bodySerif)
                .foregroundStyle(EditorialColor.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 12) {
                Button {
                    activeSheet = .search
                } label: {
                    Label("搜索知识库 ⌘F", systemImage: "magnifyingglass")
                        .font(EditorialFont.label)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                }
                .buttonStyle(PressableButtonStyle())
                .background(EditorialColor.glassSurface, in: Capsule())
                .overlay(Capsule().strokeBorder(EditorialColor.glassBorder, lineWidth: 1.2))
                .foregroundStyle(EditorialColor.textPrimary)

                if allSourcesDisabled {
                    // 来源全关时队列恒为空，clearHistory 无效，改为直接打开偏好设置
                    Button {
                        activeSheet = .settings
                    } label: {
                        Label("打开偏好设置", systemImage: "gearshape")
                            .font(EditorialFont.label)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                    }
                    .buttonStyle(PressableButtonStyle())
                    .background(currentTheme.accent.opacity(0.24), in: Capsule())
                    .overlay(Capsule().strokeBorder(currentTheme.accent.opacity(0.7), lineWidth: 1.3))
                    .foregroundStyle(EditorialColor.textPrimary)
                } else {
                    Button {
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.75)) {
                            store.clearHistory()
                        }
                    } label: {
                        Label("重新探索全部卡片", systemImage: "arrow.counterclockwise")
                            .font(EditorialFont.label)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                    }
                    .buttonStyle(PressableButtonStyle())
                    .background(currentTheme.accent.opacity(0.24), in: Capsule())
                    .overlay(Capsule().strokeBorder(currentTheme.accent.opacity(0.7), lineWidth: 1.3))
                    .foregroundStyle(EditorialColor.textPrimary)
                }

                if store.settings.isAIConfigured && store.settings.enableAI {
                    Button {
                        Task { await store.generateNewCards(count: 5) }
                    } label: {
                        Label("生成新知识", systemImage: "sparkles")
                            .font(EditorialFont.label)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                    }
                    .buttonStyle(PressableButtonStyle())
                    .background(EditorialColor.aiAmber.opacity(0.25), in: Capsule())
                    .overlay(Capsule().strokeBorder(EditorialColor.aiAmber.opacity(0.7), lineWidth: 1.3))
                    .foregroundStyle(EditorialColor.textPrimary)
                }
            }
        }
    }

    // MARK: - 背景（ambient 色温随卡片联动）

    private var ambientBackground: some View {
        ZStack {
            LinearGradient(colors: currentTheme.ambient, startPoint: .top, endPoint: .bottom)

            // 顶部光晕
            RadialGradient(
                colors: [currentTheme.accent.opacity(0.14), .clear],
                center: UnitPoint(x: 0.5, y: -0.1),
                startRadius: 60, endRadius: 620
            )
        }
    }

    // MARK: - 错误提示

    private func errorToast(_ msg: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
            Text(msg)
                .lineLimit(2)
            Button {
                errorBanner = false
                store.lastError = nil
            } label: {
                Image(systemName: "xmark")
            }
            .buttonStyle(.plain)
        }
        .font(.callout)
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Color(red: 0.55, green: 0.22, blue: 0.20).opacity(0.92), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.15), lineWidth: 1))
        .padding(.top, 14)
        .task {
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled else { return }
            errorBanner = false
            // 展示完毕即清空，保证下一次内容完全相同的错误仍能触发 onChange 重新弹出
            store.lastError = nil
        }
    }
}

// MARK: - 按压反馈按钮样式（hover 亮起 + 按压缩小）

struct PressableButtonStyle: ButtonStyle {
    var scale: CGFloat = 0.94

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1.0)
            .opacity(configuration.isPressed ? 0.85 : 1.0)
            .animation(.spring(response: 0.25, dampingFraction: 0.6), value: configuration.isPressed)
            .onHover { hovering in
                if hovering {
                    NSCursor.pointingHand.push()
                } else {
                    NSCursor.pop()
                }
            }
    }
}
