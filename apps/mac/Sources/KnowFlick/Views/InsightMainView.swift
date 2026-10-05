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

struct InsightMainView: View {
    @Bindable var store: AppStore

    // 拖拽手势状态（1:1 直接跟随指针，无插值延迟）——逻辑与旧 CardDeckView 一致
    @State private var dragOffset: CGSize = .zero
    @State private var swipeDirection: SwipeDirection? = nil

    // 独立悬浮飞出层（划走瞬间解耦，底层卡堆直接就位，彻底解决闪烁与瞬跳）
    @State private var swipingCard: KnowledgeCard? = nil
    /// reduce-motion 下飞出层的透明度：整卡飞离属 large motion，塌为原地淡出
    @State private var flyingCardOpacity: Double = 1
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var swipingOffset: CGSize = .zero
    @State private var swipingDirection: SwipeDirection? = nil

    @State private var activeSheet: ActiveSheet? = nil
    @State private var toast = ToastCenter()
    // 与 LearningWorkspaceView 共用同一 AppStorage 键，侧栏折叠状态全局一致
    @AppStorage("learning.sidebarExpanded") private var sidebarExpanded = true
    @AppStorage("swipe.companionDockVisible") private var showCompanionDock = true
    @AppStorage("learning.dailyGoal") private var dailyGoal = 5
    @State private var destination: InsightDestination = .today
    @State private var toolReturnDestination: InsightDestination = .today

    /// 三个知识来源（预置库 / AI 生成）全关时队列恒为空，空状态需给出可行动引导
    private var allSourcesDisabled: Bool {
        !store.settings.enableSeed && !store.settings.enableAI
    }

    var body: some View {
        InsightShell(
            store: store,
            selection: $destination,
            sidebarExpanded: sidebarExpanded,
            onToggleSidebar: { sidebarExpanded.toggle() },
            onOpenSheet: { route($0) }
        ) {
            destinationContent
                // 目的地切换转场：此前是整块硬切，每次点侧栏都发生。
                // 进场轻微上浮 + 淡入，退场干净淡出——不对内容做大幅度搬运，保持「简洁精炼」。
                .transition(destinationTransition)
                .animation(reduceMotion ? Animation.easeInOut(duration: 0.16) : InsightMotion.page,
                           value: destination)
        }
        .onChange(of: destination) { previous, next in
            if InsightDestination.tools.contains(next), !InsightDestination.tools.contains(previous) {
                toolReturnDestination = previous
            }
        }
        .focusedSceneValue(\.macActions, MacActions(
            canOpen: activeSheet == nil,
            hasCard: store.topCard != nil,
            open: { route($0) },
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
        .background(
            Group {
                // ⌘1-4 快速切换主导航视图 (今日 / 刷卡 / 复习 / 知识库)
                Button("") { destination = .today }
                    .keyboardShortcut("1", modifiers: .command)
                    .frame(width: 0, height: 0).opacity(0).accessibilityHidden(true)

                Button("") { destination = .swipe }
                    .keyboardShortcut("2", modifiers: .command)
                    .frame(width: 0, height: 0).opacity(0).accessibilityHidden(true)

                Button("") { destination = .review }
                    .keyboardShortcut("3", modifiers: .command)
                    .frame(width: 0, height: 0).opacity(0).accessibilityHidden(true)

                Button("") { destination = .library }
                    .keyboardShortcut("4", modifiers: .command)
                    .frame(width: 0, height: 0).opacity(0).accessibilityHidden(true)

                // ⌘D / F 快速切换顶卡收藏
                Button("") { toggleTopCardFavorite() }
                    .keyboardShortcut("d", modifiers: .command)
                    .frame(width: 0, height: 0)
                    .opacity(0)
                    .accessibilityHidden(true)

                Button("") { toggleTopCardFavorite() }
                    .keyboardShortcut("f", modifiers: [])
                    .frame(width: 0, height: 0)
                    .opacity(0)
                    .accessibilityHidden(true)

                // Space 空格键 播放/暂停顶卡语音
                Button("") {
                    if activeSheet == nil {
                        store.toggleSpeechForTopCard()
                    }
                }
                .keyboardShortcut(.space, modifiers: [])
                .frame(width: 0, height: 0)
                .opacity(0)
                .accessibilityHidden(true)
            }
        )
        .overlay(alignment: .top) {
            InsightToast(center: toast, edge: .top)
                .padding(.top, 14)
        }
    }

    // MARK: - 路由

    /// 面板路由统一入口：收藏 / 统计 / 历史已是侧栏目的地，拦截对应 case 重定向到目的地导航；
    /// 其余 case 照旧走 ActiveSheet sheet。menubar 的三个条目（MacCommands，不改）也经此归一。
    private func route(_ sheet: ActiveSheet) {
        switch sheet {
        case .favorites: navigate(to: .favorites)
        case .stats: navigate(to: .stats)
        case .history: navigate(to: .history)
        case .graph: navigate(to: .graph)
        case .speechConsole: navigate(to: .console)
        case .quiz(category: nil): navigate(to: .quiz)
        default: activeSheet = sheet
        }
    }

    private func navigate(to target: InsightDestination) {
        destination = target
    }

    /// 目的地切换的转场与动画档（reduce-motion 退化为快速淡入淡出）
    private var destinationTransition: AnyTransition {
        reduceMotion ? .opacity : .asymmetric(
            insertion: .offset(y: 14).combined(with: .opacity),
            removal: .opacity
        )
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
        case .today, .review, .library, .favorites, .history:
            LearningWorkspaceView(
                store: store,
                open: { route($0) },
                explore: { destination = .swipe },
                destination: destination,
                navigate: { destination = $0 }
            )
        case .stats:
            InsightStatsPlaceholder(store: store)
        case .graph:
            KnowledgeGraphView(
                store: store,
                onSelectCard: { activeSheet = .detail($0) },
                onClose: { destination = toolReturnDestination }
            )
        case .quiz:
            QuizView(store: store, onOpenChat: { activeSheet = .chat($0) }) {
                destination = toolReturnDestination
            }
        case .console:
            SpeechConsoleView(store: store) { destination = toolReturnDestination }
        }
    }

    /// 面板 sheet（沿用 ActiveSheet 路由）。
    /// 收藏 / 统计 / 历史三个面板已统一为侧栏目的地，不再在此挂载：
    /// favorites/stats 被 route(_:) 重定向，分支仅保留穷举所需（不可达）；
    /// HistoryView 只从统计页分类下钻以局部 sheet 打开（InsightStatsPlaceholder）。
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
        case .favorites, .stats:
            // 收藏 / 统计已升级为侧栏目的地（InsightFavoritesPlaceholder / InsightStatsPlaceholder），
            // 旧面板 FavoritesView / StatsView 已归档至 Views/_archived/。
            // 这两个 case 只作为 menubar 路由信号被 route(_:) 重定向，永远不会到达这里。
            EmptyView()
        case .settings:
            SettingsView(store: store)
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

            GeometryReader { proxy in
                // 900 起即挂伴侣坞：默认 1180 窗口（内容区 ~948）刚好放得下
                // 卡片 600 + 坞 290，两侧不再留出大片空洞
                let canShowDock = proxy.size.width >= 900 && showCompanionDock
                HStack(alignment: .center, spacing: canShowDock ? InsightSpacing.large : 0) {
                    Spacer(minLength: 0)

                    swipeCardArea
                        .frame(maxWidth: min(600, proxy.size.width - (canShowDock ? 330 : 36)), maxHeight: 660)
                        .padding(.horizontal, InsightSpacing.compact)
                        .padding(.vertical, InsightSpacing.tiny)

                    if canShowDock {
                        swipeCompanionDock
                            .frame(width: 290)
                            .padding(.trailing, InsightSpacing.large)
                            .transition(.opacity.combined(with: .move(edge: .trailing)))
                    } else {
                        Spacer(minLength: 0)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .animation(InsightMotion.shell, value: canShowDock)
            }

            if store.speechService.isAmbientMode {
                ambientBar
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(101)
            }

            actionBar
                .padding(.bottom, 14)
                .zIndex(100)
        }
        // 磨耳朵条与合成提示条的插入/移除此前不在动画上下文内（顶栏按钮直接切换状态），
        // 过渡声明了但等于没有——在这里统一补上
        .animation(reduceMotion ? nil : InsightMotion.shell, value: store.speechService.isAmbientMode)
        .animation(reduceMotion ? nil : InsightMotion.shell, value: store.speechService.isPreparing)
    }

    // MARK: - 核心卡片堆叠交互区

    private var swipeCardArea: some View {
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
        .gesture(topCardGesture)
    }

    // MARK: - 宽屏刷卡伴侣侧栏 (Companion Dock: 消除大屏幕空洞)

    private var swipeCompanionDock: some View {
        VStack(alignment: .leading, spacing: InsightSpacing.medium) {
            // 1. 今日学习脉搏微仪表
            let plan = LearningPlan(cards: store.cards)
            HStack(spacing: InsightSpacing.default) {
                ZStack {
                    Circle().stroke(InsightColor.accentSoft, lineWidth: 3.5)
                    Circle().trim(from: 0, to: min(1, Double(plan.completedToday) / Double(max(1, dailyGoal))))
                        .stroke(
                            LinearGradient(
                                colors: [InsightColor.accent, InsightColor.seal],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            style: StrokeStyle(lineWidth: 3.5, lineCap: .round)
                        )
                        .rotationEffect(.degrees(-90))
                    Text("\(Int(min(1, Double(plan.completedToday) / Double(max(1, dailyGoal))) * 100))%")
                        .font(InsightFont.monoSmall)
                        .foregroundStyle(InsightColor.textPrimary)
                }
                .frame(width: 36, height: 36)
                .animation(reduceMotion ? nil : InsightMotion.value, value: plan.completedToday)

                VStack(alignment: .leading, spacing: 2) {
                    Text(plan.completedToday >= dailyGoal ? "今日目标已达成 ✨" : "今日学习目标")
                        .font(InsightFont.caption)
                        .foregroundStyle(InsightColor.textSecondary)
                    HStack(alignment: .firstTextBaseline, spacing: 3) {
                        Text("\(plan.completedToday)")
                            .font(InsightFont.statMedium)
                            .monospacedDigit()
                        Text("/ \(dailyGoal) 张")
                            .font(InsightFont.caption)
                            .foregroundStyle(InsightColor.textTertiary)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(InsightSpacing.default)
            .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous)
                    .strokeBorder(InsightColor.doubleBezelStroke, lineWidth: 1)
            )

            // 2. 待刷队列随动雷达
            VStack(alignment: .leading, spacing: InsightSpacing.compact) {
                HStack {
                    InsightSectionLabel(text: "待刷队列", trailing: "\(store.deck.count) 张待读")
                    Spacer()
                }

                let upcomingCards = Array(store.deck.dropFirst().prefix(3))
                if upcomingCards.isEmpty {
                    Text("队列即将见底，完成本次刷卡或换一批。")
                        .font(InsightFont.captionSmall)
                        .foregroundStyle(InsightColor.textMuted)
                        .padding(InsightSpacing.default)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous).strokeBorder(InsightColor.doubleBezelStroke, lineWidth: 1))
                } else {
                    VStack(spacing: 0) {
                        ForEach(upcomingCards) { card in
                            Button {
                                activeSheet = .detail(card)
                            } label: {
                                HStack(spacing: InsightSpacing.compact) {
                                    let theme = CategoryTheme.theme(for: card)
                                    Image(systemName: theme.iconName)
                                        .font(.system(size: 9.5, weight: .bold))
                                        .foregroundStyle(theme.accent)
                                        .frame(width: 22, height: 22)
                                        .background(theme.accent.opacity(0.12), in: Circle())

                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(card.displayHeadline)
                                            .font(InsightFont.caption)
                                            .foregroundStyle(InsightColor.textPrimary)
                                            .lineLimit(1)
                                        Text(card.category)
                                            .font(InsightFont.captionSmall)
                                            .foregroundStyle(InsightColor.textTertiary)
                                    }
                                    Spacer(minLength: 0)
                                    Image(systemName: "chevron.right")
                                        .font(.system(size: 8, weight: .semibold))
                                        .foregroundStyle(InsightColor.textMuted)
                                }
                                .padding(.horizontal, InsightSpacing.default)
                                .padding(.vertical, 8)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            if card.id != upcomingCards.last?.id {
                                Divider().padding(.leading, 32).overlay(InsightColor.divider)
                            }
                        }
                    }
                    .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous).strokeBorder(InsightColor.doubleBezelStroke, lineWidth: 1))
                }
            }

            // 3. 极速键盘操作指南
            VStack(alignment: .leading, spacing: InsightSpacing.compact) {
                InsightSectionLabel(text: "高频快捷键", trailing: "macOS")
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 6) {
                    shortcutTile(key: "Space", desc: "朗读卡片")
                    shortcutTile(key: "← / →", desc: "跳过 / 喜欢")
                    shortcutTile(key: "⏎", desc: "查看详情")
                    shortcutTile(key: "⌘D / F", desc: "快速收藏")
                    shortcutTile(key: "⌘Z", desc: "撤销操作")
                    shortcutTile(key: "⌘J", desc: "AI 伴学")
                }
                .padding(InsightSpacing.default)
                .background(InsightColor.surfaceSunken, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous).strokeBorder(InsightColor.doubleBezelStroke, lineWidth: 1))
            }
        }
    }

    private func shortcutTile(key: String, desc: String) -> some View {
        HStack(spacing: 4) {
            Text(key)
                .font(InsightFont.monoSmall)
                .foregroundStyle(InsightColor.accent)
                .padding(.horizontal, 4.5)
                .padding(.vertical, 2)
                .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: 3))
                .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(InsightColor.border, lineWidth: 0.8))
            Text(desc)
                .font(InsightFont.captionSmall)
                .foregroundStyle(InsightColor.textTertiary)
                .lineLimit(1)
        }
    }

    // MARK: 顶栏（Cutline 的视图标题 + 右侧操作）

    private var swipeTopBar: some View {
        HStack(alignment: .center, spacing: InsightSpacing.compact) {
            Text("刷卡")
                .font(InsightFont.title)
                .foregroundStyle(InsightColor.textPrimary)

            if !subtitleText.isEmpty {
                Text("·")
                    .font(InsightFont.callout)
                    .foregroundStyle(InsightColor.textMuted)

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
                                .font(.system(size: 10, weight: .semibold))
                            Text(store.studyScope.describe())
                                .font(InsightFont.caption)
                            Text("还剩 \(StudyMap.remaining(store.cards, scope: store.studyScope)) 张")
                                .font(InsightFont.captionSmall)
                                .foregroundStyle(InsightColor.textTertiary)
                            Image(systemName: "xmark")
                                .font(.system(size: 8.5, weight: .bold))
                                .foregroundStyle(InsightColor.textTertiary)
                        }
                        .foregroundStyle(InsightColor.accent)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4.5)
                        .background(InsightColor.accentSoft, in: Capsule())
                        .overlay(Capsule().strokeBorder(InsightColor.accent.opacity(0.3), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .help("当前学习范围（点击退出，回到全景卡堆）")
                    .accessibilityLabel("退出学习范围 \(store.studyScope.describe())")
                }

                if store.isGenerating {
                    HStack(spacing: 6) {
                        ProgressView().controlSize(.small).tint(InsightColor.warning)
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            let elapsed = max(0, Int(context.date.timeIntervalSince(store.generationStartedAt ?? context.date)))
                            HStack(spacing: 3) {
                                Text("AI 探索中")
                                    .font(InsightFont.caption.weight(.medium))
                                    .foregroundStyle(InsightColor.textPrimary)
                                Text(elapsed > 0 ? "\(elapsed)s" : "…")
                                    .font(InsightFont.monoSmall)
                                    .monospacedDigit()
                                    .foregroundStyle(InsightColor.warning)
                                    .contentTransition(.numericText())
                                    .animation(InsightMotion.value, value: elapsed)
                            }
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4.5)
                    .background(InsightColor.warningSoft, in: Capsule())
                    .overlay(Capsule().strokeBorder(InsightColor.warning.opacity(0.38), lineWidth: 1))
                    .transition(.opacity)
                }

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
                    icon: "sidebar.right",
                    activeTint: InsightColor.accent,
                    isActive: showCompanionDock,
                    help: showCompanionDock ? "隐藏刷卡伴侣侧栏" : "显示刷卡伴侣侧栏"
                ) {
                    withAnimation(InsightMotion.shell) {
                        showCompanionDock.toggle()
                    }
                }

                Menu {
                    Button("选择学习范围", systemImage: "map") { destination = .map }
                    Button("换一批卡片", systemImage: "arrow.clockwise") {
                        Task { await store.refreshDeck() }
                    }
                    .disabled(store.isGenerating)
                    Button("重新浏览已读卡片", systemImage: "arrow.counterclockwise") {
                        withAnimation(InsightMotion.shell) { store.clearHistory() }
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(InsightColor.textSecondary)
                        .frame(width: 30, height: 30)
                        .background(InsightColor.surfaceSunken, in: Circle())
                        .overlay(Circle().strokeBorder(InsightColor.border, lineWidth: 1))
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .accessibilityLabel("刷卡选项")
            }
        }
        .foregroundStyle(InsightColor.textPrimary)
        .padding(.horizontal, InsightLayout.contentPadding)
        .padding(.top, 14)
        .padding(.bottom, 6)
    }

    private var subtitleText: String {
        if store.studyScope.isActive {
            return "\(store.studyScope.describe()) · 还剩 \(StudyMap.remaining(store.cards, scope: store.studyScope)) 张"
        }
        if store.deck.count > 0 {
            return "\(store.deck.count) 张待刷"
        }
        return ""
    }

    // MARK: 卡片堆叠（保留 3 张层叠与拖动动力学参数）

    private var visibleStack: [KnowledgeCard] {
        Array(store.deck.prefix(3))
    }

    @ViewBuilder
    private func cardStack(top: KnowledgeCard) -> some View {
        ZStack {
            ForEach(Array(visibleStack.enumerated()), id: \.element.id) { index, card in
                stackedCard(card: card, index: index, top: top)
            }
        }
    }

    @ViewBuilder
    private func stackedCard(card: KnowledgeCard, index: Int, top: KnowledgeCard) -> some View {
        let isTop = (index == 0)
        let base = InsightCardView(
            card: card,
            showAIMark: store.settings.showAIMark,
            isTop: isTop,
            speechService: store.speechService,
            isFavorited: store.isFavorite(card),
            onToggleFavorite: isTop ? { toggleTopCardFavorite(card) } : nil
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
                .simultaneousGesture(
                    TapGesture(count: 2).onEnded {
                        toggleTopCardFavorite(top)
                    }
                )
                .contextMenu {
                    Button {
                        toggleTopCardFavorite(top)
                    } label: {
                        Label(
                            store.isFavorite(top) ? "从知识收藏阁移除" : "加入知识收藏阁 ⌘D",
                            systemImage: store.isFavorite(top) ? "bookmark.slash" : "bookmark"
                        )
                    }
                    Divider()
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
                        Label("向卡片追问 (AI 伴学) ⌘J", systemImage: "cpu")
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
        let degrees = Double(swipingOffset.width / 16)
        let clampedDegrees = min(max(degrees, -24), 24)

        InsightCardView(
            card: card,
            showAIMark: store.settings.showAIMark,
            isTop: true,
            speechService: store.speechService,
            isFavorited: store.isFavorite(card),
            onToggleFavorite: nil
        )
        .offset(swipingOffset)
        .rotation3DEffect(.degrees(clampedDegrees * 0.75), axis: (x: 0, y: 1, z: 0))
        .rotationEffect(.degrees(clampedDegrees))
        .overlay(flyingSwipeBadge)
        .scaleEffect(1.0 - min(0.12, abs(swipingOffset.width) / 2400.0))
        // 正常路径按飞行距离渐隐；reduce-motion 路径由 performSwipe 直接驱动原地淡出
        .opacity(reduceMotion ? flyingCardOpacity : max(0.0, 1.0 - (Double(abs(swipingOffset.width)) - 140.0) / 420.0))
        .shadow(color: Color.black.opacity(0.45), radius: 28, y: 14)
        .zIndex(999)
        .allowsHitTesting(false)
        .transition(.identity)
    }

    // MARK: - 手势驱动与物理惯性动力学

    private var topCardGesture: some Gesture {
        DragGesture(minimumDistance: 4)
            .onChanged { value in
                guard store.topCard != nil, swipingCard == nil else { return }

                let rawTx = value.translation.width
                let rawTy = value.translation.height

                // 非线性物理阻尼：85pt 以内 1:1 跟手，超过 85pt 产生张力渐进阻尼
                let threshold: CGFloat = 85
                let physicalX: CGFloat
                if abs(rawTx) <= threshold {
                    physicalX = rawTx
                } else {
                    let excess = abs(rawTx) - threshold
                    let dampedExcess = excess / (1.0 + excess * 0.0032) * 0.62
                    physicalX = (rawTx > 0 ? 1 : -1) * (threshold + dampedExcess)
                }
                // 垂直分量引入磁吸托盘阻尼
                let physicalY = rawTy * 0.52
                dragOffset = CGSize(width: physicalX, height: physicalY)

                let isRight = rawTx > 20
                let isLeft = rawTx < -20
                swipeDirection = isRight ? .right : (isLeft ? .left : nil)

                let transAbs = abs(rawTx)
                if transAbs >= 85 {
                    if !HapticFeedbackHelper.shared.hasCrossedThreshold {
                        AudioEffectManager.shared.playRatchetTick()
                    }
                    HapticFeedbackHelper.shared.cardThresholdReached()
                } else if transAbs >= 44 {
                    HapticFeedbackHelper.shared.tensionNotch(step: 1)
                } else if transAbs >= 18 {
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
                // 结合位移与加速度释放（支持极速惯性甩卡）
                let shouldSwipeRight = value.translation.width > threshold || (value.translation.width > 24 && predictedEnd > 180)
                let shouldSwipeLeft = value.translation.width < -threshold || (value.translation.width < -24 && predictedEnd < -180)

                if shouldSwipeRight {
                    performSwipe(.right)
                } else if shouldSwipeLeft {
                    performSwipe(.left)
                } else {
                    HapticFeedbackHelper.shared.cardSnapBack()
                    AudioEffectManager.shared.playMagneticSnap()
                    withAnimation(InsightMotion.magneticSnap) {
                        dragOffset = .zero
                        swipeDirection = nil
                    }
                }
            }
    }

    private func toggleTopCardFavorite(_ targetCard: KnowledgeCard? = nil) {
        guard let card = targetCard ?? store.topCard, swipingCard == nil else { return }
        let willFavorite = !store.isFavorite(card)
        store.toggleFavorite(card)
        if willFavorite {
            AudioEffectManager.shared.playCelestialStar()
            HapticFeedbackHelper.shared.favoriteHeartbeat()
            toast.show("已加入收藏阁 ⭐️", style: .success, duration: .seconds(2))
        } else {
            AudioEffectManager.shared.playMagneticSnap()
            HapticFeedbackHelper.shared.cardSnapBack()
            toast.show("已从收藏阁移除", style: .neutral, duration: .seconds(2))
        }
    }

    private func performSwipe(_ direction: SwipeDirection) {
        guard let card = store.topCard else { return }
        guard swipingCard == nil else { return }
        HapticFeedbackHelper.shared.cardSwiped()
        AudioEffectManager.shared.playSwoosh()
        if direction == .right {
            AudioEffectManager.shared.playMasteryChime()
        } else {
            AudioEffectManager.shared.playPaperSlide()
        }

        let initialOffset = dragOffset
        swipingCard = card
        swipingOffset = initialOffset
        swipingDirection = direction
        flyingCardOpacity = 1

        // 立即将 store 里的卡片划走，并无动画重置底层卡堆的拖拽偏移
        var noAnimation = Transaction()
        noAnimation.disablesAnimations = true
        withTransaction(noAnimation) {
            dragOffset = .zero
            swipeDirection = nil
            store.swipe(card, direction: direction)
        }

        func reclaimFlyingCard() {
            swipingCard = nil
            swipingOffset = .zero
            swipingDirection = nil
            flyingCardOpacity = 1
        }

        if reduceMotion {
            // 减弱动态：整卡飞离屏幕属 large motion，塌为原地淡出
            //（ui-research 共识 5 的分层判据）；手势拖动阶段是直接操纵，不在其列
            withAnimation(.easeOut(duration: 0.18), completionCriteria: .removed, {
                flyingCardOpacity = 0
            }, completion: {
                reclaimFlyingCard()
            })
        } else {
            // 飞出动画：处于独立悬浮层的 swipingCard 顺滑飞离屏幕并渐隐；完成后回收悬浮卡
            let targetX: CGFloat = direction == .left ? -760 : 760
            let targetY: CGFloat = initialOffset.height * 0.35 + (direction == .left ? -20 : 20)
            withAnimation(.easeOut(duration: 0.24), completionCriteria: .removed, {
                swipingOffset = CGSize(width: targetX, height: targetY)
            }, completion: {
                reclaimFlyingCard()
            })
        }
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
        let progress = min(1.0, abs(dragOffset.width) / 320)
        if index == 0 {
            let topProgress = min(1.0, abs(dragOffset.width) / 500)
            return 1.0 - topProgress * 0.025
        } else if index == 1 {
            // 顶卡拖动时，第二张卡平滑向前浮起放大
            return baseScale + progress * 0.045
        } else if index == 2 {
            // 第三张卡产生次级向前共振浮起
            return baseScale + progress * 0.02
        } else {
            return baseScale
        }
    }

    private func offsetYFor(index: Int) -> CGFloat {
        let baseOffset = CGFloat(index) * 18   // 典雅层叠错位
        let progress = min(1.0, abs(dragOffset.width) / 320)
        if index == 0 {
            return -abs(dragOffset.width) * 0.035
        } else if index == 1 {
            // 顶卡拖动时，第二张卡平滑向上抬升归位
            return baseOffset - progress * 18
        } else if index == 2 {
            // 第三张卡次级平滑抬升
            return baseOffset - progress * 8
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
            .font(.system(size: 16, weight: .bold))
            .tracking(1.1)
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .background(Color.black.opacity(0.70), in: RoundedRectangle(cornerRadius: InsightRadius.pill, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: InsightRadius.pill, style: .continuous)
                    .strokeBorder(color.opacity(0.45), lineWidth: 1.5)
            )
            .foregroundStyle(color)
            .shadow(color: color.opacity(0.22), radius: 9, y: 3)
            .scaleEffect(min(1.12, 0.92 + Double(abs(dragOffset.width)) / 320.0))
            .animation(InsightMotion.tactile, value: dragOffset)
    }

    // MARK: - 底栏（现代极简工具风悬浮控制 HUD）

    private var actionBar: some View {
        HStack {
            Spacer(minLength: 0)

            HStack(spacing: 8) {
                actionButton("arrow.uturn.backward", size: 32, tint: InsightColor.textSecondary, help: "撤销上一张 ⌘Z") {
                    withAnimation(InsightMotion.shell) { store.undoLastSwipe() }
                }
                .keyboardShortcut("z", modifiers: .command)
                .disabled(store.history.isEmpty || swipingCard != nil || activeSheet != nil)

                capsuleDivider

                actionButton("xmark", size: 36, tint: InsightColor.textPrimary, hoverTint: InsightColor.danger, help: "不喜欢 ←") {
                    performSwipe(.left)
                }
                .keyboardShortcut(.leftArrow, modifiers: [])
                .disabled(store.topCard == nil || swipingCard != nil)

                actionButton("arrow.up.left.and.arrow.down.right", size: 36, tint: InsightColor.textPrimary, hoverTint: InsightColor.textPrimary, help: "查看详情 ⏎") {
                    if let card = store.topCard { activeSheet = .detail(card) }
                }
                .keyboardShortcut(.return, modifiers: [])
                .disabled(store.topCard == nil || swipingCard != nil)

                actionButton("heart.fill", size: 36, tint: InsightColor.textPrimary, hoverTint: InsightColor.success, help: "感兴趣 →") {
                    performSwipe(.right)
                }
                .keyboardShortcut(.rightArrow, modifiers: [])
                .disabled(store.topCard == nil || swipingCard != nil)

                capsuleDivider

                actionButton("dice", size: 32, tint: InsightColor.textSecondary, help: !store.settings.isAIConfigured ? "配置 AI 后可生成新卡" : "AI 生成 3 张新卡 ⌘N") {
                    if !store.settings.isAIConfigured {
                        activeSheet = .settings
                    } else {
                        Task { await store.generateNewCards(count: 3) }
                    }
                }
                .keyboardShortcut("n", modifiers: .command)
                .disabled(store.isGenerating)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(InsightColor.surface.opacity(0.96))
            .clipShape(Capsule())
            .overlay(
                Capsule()
                    .strokeBorder(InsightColor.border, lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.12), radius: 14, y: 4)

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
        .padding(.horizontal, InsightLayout.contentPadding)
    }

    private func actionButton(_ icon: String, size: CGFloat, tint: Color, hoverTint: Color? = nil, help: String, action: @escaping () -> Void) -> some View {
        ActionButtonItem(icon: icon, size: size, tint: tint, hoverTint: hoverTint ?? tint, help: help, action: action)
    }

    /// 底栏胶囊的内部分层线
    private var capsuleDivider: some View {
        Capsule().fill(InsightColor.border).frame(width: 1, height: 16)
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
                        title: "生成新知识", icon: "cpu",
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

private struct ActionButtonItem: View {
    let icon: String
    let size: CGFloat
    let tint: Color
    var hoverTint: Color? = nil
    let help: String
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: size * 0.40, weight: .medium))
                .foregroundStyle(isHovered ? (hoverTint ?? tint) : tint)
                .frame(width: size, height: size)
                .background {
                    if isHovered {
                        Circle().fill(InsightColor.surfaceSunken)
                    }
                }
                .clipShape(Circle())
                .overlay(
                    Circle()
                        .strokeBorder(
                            isHovered ? InsightColor.borderStrong : Color.clear,
                            lineWidth: 1
                        )
                )
        }
        .buttonStyle(PressableButtonStyle(scale: 0.95))
        .onHover { isHovered = $0 }
        .help(help)
        .accessibilityLabel(help)
    }
}

