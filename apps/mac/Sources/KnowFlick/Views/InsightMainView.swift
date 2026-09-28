import SwiftUI
import KnowFlickCore

// MARK: - Cutline 式应用主界面（侧栏外壳 + 刷卡视图合一）
//
// 素材依据：`.scratch/ui-material/05_HTCuOh3aoAA4Qv0.png`（Cutline）
//   · 圆角浮动侧栏常驻，与内容区分区
//   · 内容区顶栏：视图标题 + 描述 + 右侧操作
//   · 卡片为深色 surface + 1pt 描边，无摄影大图
//   · 底部悬浮操作条（Cutline 的 footer 卡）
//
// 与旧 CardDeckView 的关系：
//   · 手势、快捷键、飞出层、AppStore 写入路径、sheet 路由全部原样保留
//   · 只替换视觉外壳与卡片样式
//   · Ambience/PaperTheme 底图路径不再由刷卡视图铺设，画布交给 InsightShell

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
    case webClip
    case plannedReview([KnowledgeCard])
    case editCard(KnowledgeCard)
    case sync
    case speechConsole

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
        case .webClip: return "webClip"
        case .plannedReview: return "plannedReview"
        case .editCard(let card): return "edit_\(card.id)"
        case .sync: return "sync"
        case .speechConsole: return "speechConsole"
        }
    }
}

struct InsightMainView: View {
    @Bindable var store: AppStore

    // 拖拽手势状态（1:1 直接跟随指针，无插值延迟）——逻辑与旧 CardDeckView 一致
    @State private var dragOffset: CGSize = .zero
    @State private var swipeDirection: SwipeDirection? = nil

    // 独立悬浮飞出层（划走瞬间解耦，底层卡堆直接就位，彻底解决闪烁与瞬跳）
    @State private var swipingCard: KnowledgeCard? = nil
    @State private var swipingOffset: CGSize = .zero
    @State private var swipingDirection: SwipeDirection? = nil

    @State private var activeSheet: ActiveSheet? = nil
    @State private var toast = ToastCenter()
    // 与 LearningWorkspaceView 共用同一 AppStorage 键，侧栏折叠状态全局一致
    @AppStorage("learning.sidebarExpanded") private var sidebarExpanded = true
    @State private var destination: InsightDestination = .today

    /// 三个知识来源（预置库 / AI 生成）全关时队列恒为空，空状态需给出可行动引导
    private var allSourcesDisabled: Bool {
        !store.settings.enableSeed && !store.settings.enableAI
    }

    var body: some View {
        InsightShell(
            store: store,
            selection: $destination,
            sidebarExpanded: sidebarExpanded,
            onToggleSidebar: { withAnimation(InsightMotion.shell) { sidebarExpanded.toggle() } },
            onOpenSheet: { sheet in activeSheet = sheet }
        ) {
            destinationContent
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
                Task { await store.refreshDeck() }
            }
        ))
        .sheet(item: $activeSheet) { sheet in
            sheetContent(for: sheet)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let warning = store.persistenceWarning {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "externaldrive.badge.exclamationmark")
                        .foregroundStyle(InsightColor.warning)
                    Text(warning).font(InsightFont.captionSmall)
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
            if let err {
                toast.show(err, style: .failure, duration: .seconds(5))
            }
        }
        // 提示结束（自动到期或手动关闭）即清空 lastError，
        // 保证下一次内容完全相同的错误仍能触发 onChange 重新弹出
        .onChange(of: toast.message) { _, message in
            if message == nil {
                store.lastError = nil
            }
        }
        .overlay(alignment: .top) {
            EditorialToast(center: toast, edge: .top)
                .padding(.top, 14)
        }
    }

    // MARK: - 内容区

    @ViewBuilder
    private var destinationContent: some View {
        switch destination {
        case .swipe:
            swipeView
        case .map:
            LearningMapView(store: store) {
                destination = .swipe
            }
        case .today, .review, .library:
            LearningWorkspaceView(
                store: store,
                open: { activeSheet = $0 },
                explore: { destination = .swipe },
                destination: destination,
                navigate: { destination = $0 }
            )
        case .favorites:
            InsightFavoritesPlaceholder(store: store, onOpenSheet: { activeSheet = $0 })
        case .history:
            InsightHistoryPlaceholder(store: store, onOpenSheet: { activeSheet = $0 })
        case .stats:
            InsightStatsPlaceholder(store: store, onOpenSheet: { activeSheet = $0 })
        case .graph:
            KnowledgeGraphView(
                store: store,
                onSelectCard: { activeSheet = .detail($0) },
                onClose: { destination = .swipe }
            )
        case .quiz:
            QuizView(store: store, onOpenChat: { activeSheet = .chat($0) }) {
                destination = .review
            }
        case .console:
            SpeechConsoleView(store: store) { destination = .swipe }
        }
    }

    /// 面板仍走 sheet（沿用 ActiveSheet 路由），与旧 CardDeckView 一致
    @ViewBuilder
    private func sheetContent(for sheet: ActiveSheet) -> some View {
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
                    if let next = store.topCard, next.id != card.id {
                        activeSheet = .detail(next)
                    } else if store.deck.count > 1 {
                        // 详情页查看的正是顶卡时，「下一张」以系统跳过语义刷过当前卡并前进
                        store.swipe(card, direction: .skip)
                        if let next = store.topCard { activeSheet = .detail(next) } else { activeSheet = nil }
                    }
                },
                onPrevious: {
                    if let prev = store.history.first { activeSheet = .detail(prev) }
                },
                onClose: { activeSheet = nil },
                relatedCards: store.getRelatedCards(for: card),
                onSelectCard: { target in
                    activeSheet = .detail(target)
                },
                onCompleteReading: destination != .swipe ? {
                    store.completeReading(card)
                    activeSheet = nil
                } : nil,
                onUndo: {
                    withAnimation(InsightMotion.shell) {
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
            HistoryView(store: store, showAIMark: store.settings.showAIMark, categoryFilter: nil) {
                activeSheet = nil
            }
        case .help:
            HelpView {
                activeSheet = nil
            }
        case .quiz(let category):
            QuizView(store: store, category: category, onOpenChat: { activeSheet = .chat($0) }) {
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
        case .webClip:
            WebClipModalView(store: store, onClose: { activeSheet = nil })
        case .plannedReview(let cards):
            QuizView(store: store, plannedCards: cards, onOpenChat: { activeSheet = .chat($0) }) { activeSheet = nil }
        case .editCard(let card):
            CardEditorView(card: card, store: store) { activeSheet = nil }
        case .sync:
            SyncSheetView(store: store) { activeSheet = nil }
        case .speechConsole:
            SpeechConsoleView(
                store: store,
                onPrevious: {
                    withAnimation(InsightMotion.shell) {
                        store.undoLastSwipe()
                        if let top = store.topCard {
                            store.speechService.speak(card: top, part: .full)
                        }
                    }
                },
                onNext: {
                    performSwipe(.skip)
                    if let next = store.topCard {
                        store.speechService.speak(card: next, part: .full)
                    }
                },
                onClose: { activeSheet = nil }
            )
        }
    }

    // MARK: - 刷卡视图

    private var swipeView: some View {
        VStack(spacing: 0) {
            swipeTopBar
                .zIndex(100)

            if store.speechService.isPreparing {
                HStack(spacing: InsightSpacing.small) {
                    ProgressView().controlSize(.small)
                    Text("正在合成语音…").font(InsightFont.caption).foregroundStyle(InsightColor.textSecondary)
                }
                .padding(.top, InsightSpacing.small)
            }
            if let message = store.speechService.lastError {
                Text(message)
                    .font(InsightFont.caption)
                    .foregroundStyle(InsightColor.warning)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, InsightLayout.contentPadding)
                    .padding(.top, InsightSpacing.small)
            }

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
            .padding(.horizontal, 56)
            .padding(.vertical, InsightSpacing.medium)
            .gesture(topCardGesture)

            if store.speechService.isAmbientMode {
                ambientBar
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(101)
            }

            actionBar
                .padding(.bottom, InsightSpacing.large)
                .zIndex(100)
        }
    }

    // MARK: 顶栏（Cutline 的视图标题 + 右侧操作）

    private var swipeTopBar: some View {
        HStack(alignment: .firstTextBaseline, spacing: InsightSpacing.medium) {
            VStack(alignment: .leading, spacing: InsightSpacing.hair) {
                Text("刷卡")
                    .font(InsightFont.title)
                    .foregroundStyle(InsightColor.textPrimary)
                Text(subtitleText)
                    .font(InsightFont.callout)
                    .foregroundStyle(InsightColor.textTertiary)
            }

            Spacer(minLength: InsightSpacing.large)

            HStack(spacing: InsightSpacing.compact) {
                // 学习范围徽标：地图下发的范围在刷卡页一目了然，一键退出
                if store.studyScope.isActive {
                    Button {
                        withAnimation(InsightMotion.shell) { store.studyScope = .none }
                    } label: {
                        HStack(spacing: InsightSpacing.small) {
                            Image(systemName: "map.fill")
                                .font(.system(size: 11, weight: .semibold))
                            Text(store.studyScope.describe())
                                .font(InsightFont.caption)
                            Text("还剩 \(StudyMap.remaining(store.cards, scope: store.studyScope)) 张")
                                .font(InsightFont.captionSmall)
                                .foregroundStyle(InsightColor.textTertiary)
                            Image(systemName: "xmark")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(InsightColor.textTertiary)
                        }
                        .foregroundStyle(InsightColor.accent)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(InsightColor.accentSoft, in: Capsule())
                        .overlay(Capsule().strokeBorder(InsightColor.accent.opacity(0.3), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .help("当前学习范围（点击退出，回到全景卡堆）")
                    .accessibilityLabel("退出学习范围 \(store.studyScope.describe())")
                }

                if store.isGenerating {
                    HStack(spacing: InsightSpacing.small) {
                        ProgressView().controlSize(.small).tint(InsightColor.warning)
                        Text("正在收集新知识…")
                            .font(InsightFont.caption)
                            .foregroundStyle(InsightColor.textSecondary)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(InsightColor.warningSoft, in: Capsule())
                    .overlay(Capsule().strokeBorder(InsightColor.warning.opacity(0.3), lineWidth: 1))
                }

                InsightIconButton(
                    icon: "magnifyingglass", help: "全局智能搜索与全文检索 ⌘F"
                ) {
                    activeSheet = .search
                }
                .keyboardShortcut("f", modifiers: .command)

                InsightIconButton(
                    icon: store.speechService.isAmbientMode ? "headphones.circle.fill" : "headphones",
                    activeTint: InsightColor.success,
                    isActive: store.speechService.isAmbientMode,
                    help: store.speechService.isAmbientMode ? "退出磨耳朵连续朗读 ⇧⌘P" : "磨耳朵连续朗读 ⇧⌘P"
                ) {
                    store.toggleAmbientSpeechMode()
                }
                .keyboardShortcut("p", modifiers: [.command, .shift])
                .disabled(store.topCard == nil)

                InsightIconButton(
                    icon: store.settings.appearance.icon,
                    help: "外观：\(store.settings.appearance.title)（点击切换）"
                ) {
                    let all = AppearanceMode.allCases
                    let currentIndex = all.firstIndex(of: store.settings.appearance) ?? 0
                    let nextMode = all[(currentIndex + 1) % all.count]
                    withAnimation(InsightMotion.shell) {
                        // 高频开关走轻量通道：内存即时生效，落盘异步节流，不阻塞主线程
                        store.applySettingsChange { $0.appearance = nextMode }
                    }
                    HapticFeedbackHelper.shared.cardSnapBack()
                }

                Menu {
                    Section("探索与学习") {
                        Button("学习地图", systemImage: "map") { destination = .map }
                        Button("全局搜索", systemImage: "magnifyingglass") { activeSheet = .search }
                            .keyboardShortcut("f", modifiers: .command)
                        Button("知识测验", systemImage: "graduationcap") { activeSheet = .quiz(category: nil) }
                        Button("知识星图", systemImage: "point.3.connected.trianglepath.dotted") { activeSheet = .graph }
                        Button(store.speechService.isAmbientMode ? "停止连续朗读" : "连续朗读", systemImage: "headphones") {
                            store.toggleAmbientSpeechMode()
                        }
                        .keyboardShortcut("p", modifiers: [.command, .shift])
                        .disabled(store.topCard == nil)
                        Button("语音听书控制台…", systemImage: "slider.horizontal.3") { activeSheet = .speechConsole }
                            .keyboardShortcut("p", modifiers: [.command, .option])
                        Button("知识收藏阁", systemImage: "bookmark") { activeSheet = .favorites }
                        Button("学习统计", systemImage: "chart.bar") { activeSheet = .stats }
                        Button("历史记录", systemImage: "clock") { activeSheet = .history }
                    }
                    Section("卡库管理") {
                        Button("换一批新知识", systemImage: "arrow.clockwise") {
                            Task { await store.refreshDeck() }
                        }
                        .disabled(store.isGenerating)
                        Button("重新探索全部卡片", systemImage: "arrow.counterclockwise") {
                            withAnimation(InsightMotion.shell) {
                                store.clearHistory()
                            }
                        }
                        Button("局域网极速同步…", systemImage: "arrow.triangle.2.circlepath") { activeSheet = .sync }
                        Button("偏好设置", systemImage: "gearshape") { activeSheet = .settings }
                        Button("快捷键帮助", systemImage: "questionmark.circle") { activeSheet = .help }
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(InsightColor.textSecondary)
                        .frame(width: 30, height: 30)
                        .background(InsightColor.surfaceSunken, in: Circle())
                        .overlay(Circle().strokeBorder(InsightColor.border, lineWidth: 1))
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .accessibilityLabel("展开功能菜单")
            }
        }
        .foregroundStyle(InsightColor.textPrimary)
        .padding(.horizontal, InsightLayout.contentPadding)
        .padding(.top, InsightSpacing.large)
        .padding(.bottom, InsightSpacing.compact)
    }

    private var subtitleText: String {
        if store.studyScope.isActive {
            var parts = [store.studyScope.describe()]
            parts.append("还剩 \(StudyMap.remaining(store.cards, scope: store.studyScope)) 张")
            return parts.joined(separator: " · ")
        }
        var parts: [String] = []
        parts.append("今天也想学点新东西")
        if store.deck.count > 0 {
            parts.append("\(store.deck.count) 张待刷")
        }
        return parts.joined(separator: " · ")
    }

    // MARK: 卡片堆叠（保留 3 张层叠与拖动动力学参数）

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
        let base = InsightCardView(
            card: card,
            showAIMark: store.settings.showAIMark,
            isTop: isTop,
            speechService: store.speechService
        )
        .scaleEffect(scaleFor(index: index))
        .offset(y: offsetYFor(index: index))

        if isTop {
            base
                .offset(dragOffset)
                .rotationEffect(rotationAngle)
                .overlay(swipeBadge)
                .zIndex(Double(visibleStack.count))
                .contentShape(RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
                .onTapGesture {
                    if swipingCard == nil && abs(dragOffset.width) < 10 {
                        AudioEffectManager.shared.playCardFlip()
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

        InsightCardView(
            card: card,
            showAIMark: store.settings.showAIMark,
            isTop: true,
            speechService: store.speechService
        )
        .offset(swipingOffset)
            .rotationEffect(.degrees(clampedDegrees))
            .overlay(flyingSwipeBadge)
            .opacity(max(0.0, 1.0 - (Double(abs(swipingOffset.width)) - 180.0) / 450.0))
            .zIndex(999)
            .allowsHitTesting(false)
            .transition(.identity)
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
                    withAnimation(InsightMotion.shell) {
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
        if direction == .right {
            AudioEffectManager.shared.playMasteryChime()
        } else {
            AudioEffectManager.shared.playPaperSlide()
        }

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

        // 飞出动画：处于独立悬浮层的 swipingCard 顺滑飞离屏幕并渐隐；完成后回收悬浮卡
        let targetX: CGFloat = direction == .left ? -760 : 760
        let targetY: CGFloat = initialOffset.height * 0.35 + (direction == .left ? -20 : 20)

        func reclaimFlyingCard() {
            swipingCard = nil
            swipingOffset = .zero
            swipingDirection = nil
        }

        withAnimation(.easeOut(duration: 0.24), completionCriteria: .removed, {
            swipingOffset = CGSize(width: targetX, height: targetY)
        }, completion: {
            reclaimFlyingCard()
        })
        // 兜底：飞行动画期间视图被整体卸载等极端情况下 completion 可能不回调，
        // 超时强制回收，防止 swipingCard 残留把卡堆锁死
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1))
            if swipingCard != nil {
                reclaimFlyingCard()
            }
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
                            badge("不喜欢", color: InsightColor.danger, icon: "xmark")
                            Spacer()
                        } else {
                            Spacer()
                            badge("感兴趣", color: InsightColor.success, icon: "heart.fill")
                        }
                    }
                    Spacer()
                }
                .padding(InsightSpacing.large)
                .opacity(min(1.0, Double(abs(dragOffset.width)) / 85.0))   // 徽章平滑浮现
            }
        }
    }

    private var flyingSwipeBadge: some View {
        Group {
            if let dir = swipingDirection {
                VStack {
                    HStack {
                        if dir == .left {
                            badge("不喜欢", color: InsightColor.danger, icon: "xmark")
                            Spacer()
                        } else if dir == .right {
                            Spacer()
                            badge("感兴趣", color: InsightColor.success, icon: "heart.fill")
                        } else {
                            // .skip 是系统跳过（磨耳朵「下一张」等系统批量操作），按领域契约不表达喜好：
                            // 此前落进 else 分支飞出绿色「感兴趣」章，与统计口径（skip 不计喜欢）自相矛盾。
                            Spacer()
                            badge("已跳过", color: InsightColor.neutral, icon: "forward.fill")
                        }
                    }
                    Spacer()
                }
                .padding(InsightSpacing.large)
                .opacity(min(1.0, Double(abs(swipingOffset.width)) / 85.0))
            }
        }
    }

    private func badge(_ text: String, color: Color, icon: String) -> some View {
        Label(text, systemImage: icon)
            .font(.system(size: 18, weight: .bold))
            .tracking(1.2)
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .background(Color.black.opacity(0.45), in: RoundedRectangle(cornerRadius: InsightRadius.pill, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: InsightRadius.pill, style: .continuous)
                    .strokeBorder(color, lineWidth: 2.2)
            )
            .foregroundStyle(color)
            .shadow(color: color.opacity(0.35), radius: 10, y: 3)
    }

    // MARK: - 底栏（Cutline 的 footer 卡）

    private var actionBar: some View {
        HStack(spacing: InsightSpacing.medium) {
            Spacer(minLength: 0)

            actionButton("arrow.uturn.backward", size: 40, tint: InsightColor.textSecondary, help: "撤销上一张 ⌘Z") {
                withAnimation(InsightMotion.shell) { store.undoLastSwipe() }
            }
            .keyboardShortcut("z", modifiers: .command)
            .disabled(store.history.isEmpty || swipingCard != nil || activeSheet != nil)

            actionButton("xmark", size: 54, tint: InsightColor.danger, help: "不喜欢 ←") {
                performSwipe(.left)
            }
            .keyboardShortcut(.leftArrow, modifiers: [])
            .disabled(store.topCard == nil || swipingCard != nil)

            actionButton("arrow.up.left.and.arrow.down.right", size: 44, tint: InsightColor.textPrimary, help: "查看详情 ⏎") {
                if let card = store.topCard { activeSheet = .detail(card) }
            }
            .keyboardShortcut(.return, modifiers: [])
            .disabled(store.topCard == nil || swipingCard != nil)

            actionButton("heart.fill", size: 54, tint: InsightColor.success, help: "感兴趣 →") {
                performSwipe(.right)
            }
            .keyboardShortcut(.rightArrow, modifiers: [])
            .disabled(store.topCard == nil || swipingCard != nil)

            actionButton("dice", size: 40, tint: InsightColor.warning, help: !store.settings.isAIConfigured ? "配置 AI 后可生成新卡" : "AI 生成 3 张新卡 ⌘N") {
                if !store.settings.isAIConfigured {
                    activeSheet = .settings
                } else {
                    Task { await store.generateNewCards(count: 3) }
                }
            }
            .keyboardShortcut("n", modifiers: .command)
            .disabled(store.isGenerating)

            Button("") {
                if let top = store.topCard {
                    activeSheet = .chat(top)
                }
            }
            .keyboardShortcut("j", modifiers: .command)
            .opacity(0)
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, InsightSpacing.large)
        .padding(.vertical, InsightSpacing.compact)
        .background(InsightColor.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(InsightColor.border, lineWidth: 1))
        .padding(.horizontal, InsightLayout.contentPadding)
    }

    private func actionButton(_ icon: String, size: CGFloat, tint: Color, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: size * 0.36, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: size, height: size)
                .background(InsightColor.surfaceSunken, in: Circle())
                .overlay(Circle().strokeBorder(tint.opacity(0.5), lineWidth: 1.3))
        }
        .buttonStyle(PressableButtonStyle())
        .help(help)
        .accessibilityLabel(help)
    }

    // MARK: - 磨耳朵播放条

    private var ambientBar: some View {
        AmbientAudioPlayerBar(
            store: store,
            isTransitioning: swipingCard != nil,
            onPrevious: {
                withAnimation(InsightMotion.shell) {
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
                withAnimation(InsightMotion.shell) { store.speechService.stopAmbientMode() }
            },
            onOpenConsole: { activeSheet = .speechConsole }
        )
        .padding(.bottom, InsightSpacing.small)
    }

    // MARK: - 空状态

    private var emptyStateSubtitle: String {
        if allSourcesDisabled {
            return "当前已关闭全部知识来源（预置精选库与 AI 生成），开启后即可继续刷卡片"
        }
        return !store.settings.isAIConfigured
            ? "去设置里配置 AI 服务，就能持续生成新知识"
            : "已看完全部卡片。换一批新知识，或重新探索全部卡片。"
    }

    private var emptyState: some View {
        VStack(spacing: InsightSpacing.large) {
            Image(systemName: "square.stack.3d.up.slash")
                .font(.system(size: 40))
                .foregroundStyle(InsightColor.textMuted)
            Text("今天的知识刷完了")
                .font(InsightFont.title)
                .foregroundStyle(InsightColor.textPrimary)
            Text(emptyStateSubtitle)
                .font(InsightFont.body)
                .foregroundStyle(InsightColor.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 380)

            HStack(spacing: InsightSpacing.compact) {
                InsightButton(title: "搜索知识库", icon: "magnifyingglass", style: .secondary) {
                    activeSheet = .search
                }
                if allSourcesDisabled {
                    // 来源全关时队列恒为空，clearHistory 无效，改为直接打开偏好设置
                    InsightButton(title: "打开偏好设置", icon: "gearshape", style: .secondary) {
                        activeSheet = .settings
                    }
                } else {
                    InsightButton(title: "重新探索全部卡片", icon: "arrow.counterclockwise", style: .secondary) {
                        withAnimation(InsightMotion.shell) { store.clearHistory() }
                    }
                }
                if store.settings.isAIConfigured && store.settings.enableAI {
                    InsightButton(
                        title: "生成新知识", icon: "sparkles",
                        style: .primary, tint: InsightColor.warning,
                        isEnabled: !store.isGenerating
                    ) {
                        Task { await store.generateNewCards(count: 5) }
                    }
                }
            }
            .padding(.top, InsightSpacing.small)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
