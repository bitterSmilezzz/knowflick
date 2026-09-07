import SwiftUI
import KnowFlickCore

/// 模态弹窗类型（统一入口，彻底杜绝 macOS SwiftUI 多 sheet 链式挂载相互覆盖失效）
enum ActiveSheet: Identifiable {
    case settings
    case stats
    case history
    case help

    var id: String {
        switch self {
        case .settings: return "settings"
        case .stats: return "stats"
        case .history: return "history"
        case .help: return "help"
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

    // 弹窗状态
    @State private var selectedCard: KnowledgeCard? = nil
    @State private var activeSheet: ActiveSheet? = nil
    @State private var errorBanner = false

    // 同步计算当前主题，绝不在 .task 异步延迟加载，杜绝换卡时背景与边框闪烁
    private var currentTheme: CategoryTheme {
        CategoryTheme.theme(for: swipingCard ?? store.topCard, cache: .shared)
    }

    var body: some View {
        ZStack {
            ambientBackground
                .ignoresSafeArea()
                .animation(.easeInOut(duration: 0.45), value: (swipingCard ?? store.topCard)?.id.uuidString ?? "")

            VStack(spacing: 0) {
                topBar
                    .padding(.horizontal, 30)
                    .padding(.top, 20)
                    .sheet(item: $activeSheet) { sheet in
                        switch sheet {
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
                        }
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
                .sheet(item: $selectedCard) { card in
                    DetailView(
                        card: card,
                        showAIMark: store.settings.showAIMark,
                        hasPrevious: store.history.first != nil,
                        hasNext: store.deck.count > 1,
                        onSwipe: { direction in
                            store.swipe(card, direction: direction)
                            // 连续刷卡：直接切到下一张；刷完则关闭
                            if let next = store.topCard { selectedCard = next } else { selectedCard = nil }
                        },
                        onNext: {
                            if let next = store.topCard, next.id != card.id { selectedCard = next }
                        },
                        onPrevious: {
                            if let prev = store.history.first { selectedCard = prev }
                        },
                        onClose: { selectedCard = nil }
                    )
                }

                Spacer(minLength: 8)

                bottomBar
                    .padding(.bottom, 26)
            }
        }
        .onChange(of: store.lastError) { _, err in
            if err != nil {
                errorBanner = true
            }
        }
        .overlay(alignment: .top) {
            if errorBanner, let msg = store.lastError {
                errorToast(msg)
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
        let base = CardView(card: card, showAIMark: store.settings.showAIMark)
            .scaleEffect(scaleFor(index: index))
            .offset(y: offsetYFor(index: index))

        if isTop {
            base
                .offset(dragOffset)
                .rotationEffect(rotationAngle)
                .overlay(swipeBadge)
                .zIndex(Double(visibleStack.count))
                .onTapGesture {
                    if swipingCard == nil && abs(dragOffset.width) < 10 {
                        selectedCard = top
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

        CardView(card: card, showAIMark: store.settings.showAIMark)
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
                let isRight = value.translation.width > 25
                let isLeft = value.translation.width < -25
                swipeDirection = isRight ? .right : (isLeft ? .left : nil)

                if abs(value.translation.width) >= 85 {
                    HapticFeedbackHelper.shared.cardThresholdReached()
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
                iconButton("chart.bar", help: "学习统计") { activeSheet = .stats }
                iconButton("clock.arrow.circlepath", help: "历史记录") { activeSheet = .history }
                iconButton("arrow.clockwise", help: "换一批新知识") { Task { await store.refreshDeck() } }
                iconButton("gearshape", help: "设置") { activeSheet = .settings }
                iconButton("questionmark.circle", help: "快捷键 ⌘?") { activeSheet = .help }
                    .keyboardShortcut("?", modifiers: .command)
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
            .disabled(store.history.isEmpty || swipingCard != nil)

            roundButton("xmark", size: 60, tint: EditorialColor.dislikeRed, help: "不喜欢 ←") {
                performSwipe(.left)
            }
            .keyboardShortcut(.leftArrow, modifiers: [])
            .disabled(store.topCard == nil || swipingCard != nil)

            roundButton("arrow.up.left.and.arrow.down.right", size: 50, tint: EditorialColor.textPrimary, help: "查看详情 ⏎") {
                if let card = store.topCard { selectedCard = card }
            }
            .keyboardShortcut(.return, modifiers: [])
            .disabled(store.topCard == nil || swipingCard != nil)

            roundButton("heart.fill", size: 60, tint: EditorialColor.likeGreen, help: "感兴趣 →") {
                performSwipe(.right)
            }
            .keyboardShortcut(.rightArrow, modifiers: [])
            .disabled(store.topCard == nil || swipingCard != nil)

            roundButton("dice", size: 42, tint: EditorialColor.aiAmber, help: store.settings.apiKey.isEmpty ? "配置 AI 后可生成新卡" : "AI 生成 3 张新卡 ⌘N") {
                if store.settings.apiKey.isEmpty {
                    activeSheet = .settings
                } else {
                    Task { await store.generateNewCards(count: 3) }
                }
            }
            .keyboardShortcut("n", modifiers: .command)
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

    private var emptyState: some View {
        VStack(spacing: 18) {
            Image(systemName: "sparkles")
                .font(.system(size: 44))
                .foregroundStyle(EditorialColor.textTertiary)
            Text("今天的知识刷完了")
                .font(EditorialFont.detailHeadline)
                .foregroundStyle(EditorialColor.textPrimary)
            Text(store.settings.apiKey.isEmpty
                 ? "去设置里配置 AI 服务，就能持续生成新知识"
                 : "让 AI 为你生成一批新的冷知识")
                .font(EditorialFont.bodySerif)
                .foregroundStyle(EditorialColor.textSecondary)

            Button {
                if store.settings.apiKey.isEmpty {
                    activeSheet = .settings
                } else {
                    Task { await store.generateNewCards(count: 5) }
                }
            } label: {
                Label(
                    store.settings.apiKey.isEmpty ? "配置 AI" : "生成新知识",
                    systemImage: store.settings.apiKey.isEmpty ? "gearshape" : "sparkles"
                )
                .font(EditorialFont.label)
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
            }
            .buttonStyle(PressableButtonStyle(scale: 1.03))
            .background(currentTheme.accent.opacity(0.24), in: Capsule())
            .overlay(Capsule().strokeBorder(currentTheme.accent.opacity(0.7), lineWidth: 1.3))
            .foregroundStyle(EditorialColor.textPrimary)
            .shadow(color: currentTheme.accent.opacity(0.3), radius: 12, y: 4)
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
            errorBanner = false
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


