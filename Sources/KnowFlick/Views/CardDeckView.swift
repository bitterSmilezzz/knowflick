import SwiftUI
import KnowFlickCore

/// 卡片堆叠主界面：左右拖动划走、点击看详情
struct CardDeckView: View {
    @Bindable var store: AppStore

    // 拖拽状态
    @State private var dragOffset: CGSize = .zero
    @State private var swipeDirection: SwipeDirection? = nil
    @State private var selectedCard: KnowledgeCard? = nil
    @State private var showSettings = false
    @State private var showHistory = false
    @State private var showStats = false
    @State private var showHelp = false
    @State private var errorBanner = false
    @State private var currentTheme: CategoryTheme = .empty

    var body: some View {
        ZStack {
            ambientBackground
                .ignoresSafeArea()
                .animation(.easeInOut(duration: 0.7), value: currentTheme.category)

            VStack(spacing: 0) {
                topBar
                    .padding(.horizontal, 30)
                    .padding(.top, 20)

                Spacer(minLength: 8)

                // 卡片堆叠区
                ZStack {
                    if let top = store.topCard {
                        ForEach(Array(visibleStack.enumerated()), id: \.element.id) { index, card in
                            CardView(card: card)
                                .scaleEffect(scaleFor(index: index))
                                .offset(y: offsetYFor(index: index))
                                .offset(index == 0 ? dragOffset : .zero)
                                .rotationEffect(index == 0 ? rotationAngle : .zero)
                                .overlay(index == 0 ? swipeBadge : nil)
                                .zIndex(Double(visibleStack.count - index))
                                .onTapGesture {
                                    if index == 0 { selectedCard = top }
                                }
                        }
                        .animation(.snappy(duration: 0.25), value: dragOffset)
                    } else {
                        emptyState
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.horizontal, 95)
                .padding(.vertical, 16)
                .gesture(topCardGesture)

                Spacer(minLength: 8)

                bottomBar
                    .padding(.bottom, 26)
            }
        }
        .task(id: store.topCard?.id) {
            if let cat = store.topCard?.category {
                currentTheme = CategoryTheme.theme(for: cat, cache: .shared)
            }
            if dragOffset != .zero || swipeDirection != nil {
                dragOffset = .zero
                swipeDirection = nil
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
        .sheet(isPresented: $showSettings) {
            SettingsView(store: store)
        }
        .sheet(isPresented: $showStats) {
            StatsView(store: store) {
                showStats = false
            }
        }
        .sheet(isPresented: $showHelp) {
            HelpView {
                showHelp = false
            }
        }
        .sheet(item: $selectedCard) { card in
            DetailView(
                card: card,
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
        .sheet(isPresented: $showHistory) {
            HistoryView(store: store) {
                showHistory = false
            }
        }
    }

    // MARK: - 可见卡片栈（最多 3 张）

    private var visibleStack: [KnowledgeCard] {
        Array(store.deck.prefix(3))
    }

    private var topCardGesture: some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                guard store.topCard != nil else { return }
                dragOffset = value.translation
                swipeDirection = value.translation.width > 30 ? .right
                    : (value.translation.width < -30 ? .left : nil)
            }
            .onEnded { value in
                let threshold: CGFloat = 92   // 手感：更容易划走
                if value.translation.width > threshold {
                    performSwipe(.right)
                } else if value.translation.width < -threshold {
                    performSwipe(.left)
                } else {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.7)) {
                        dragOffset = .zero
                        swipeDirection = nil
                    }
                }
            }
    }

    private func performSwipe(_ direction: SwipeDirection) {
        guard let card = store.topCard else { return }
        let target = CGSize(
            width: direction == .left ? -640 : 640,
            height: dragOffset.height * 0.6
        )
        withAnimation(.easeOut(duration: 0.22)) {
            dragOffset = target
            swipeDirection = direction
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) {
            store.swipe(card, direction: direction)
            dragOffset = .zero
            swipeDirection = nil
        }
    }

    // MARK: - 布局参数

    private var rotationAngle: Angle {
        let degrees = Double(dragOffset.width / 18)   // 更跟手的倾斜响应
        return .degrees(min(max(degrees, -16), 16))
    }

    private func scaleFor(index: Int) -> CGFloat {
        guard index == 0 else { return 1.0 - CGFloat(index) * 0.05 }
        let progress = abs(dragOffset.width) / 640
        return 1.0 - progress * 0.05
    }

    private func offsetYFor(index: Int) -> CGFloat {
        guard index == 0 else { return CGFloat(index) * 20 }   // 层叠错位更明显
        return -abs(dragOffset.width) * 0.04
    }

    private var swipeBadge: some View {
        Group {
            if let dir = swipeDirection {
                VStack {
                    HStack {
                        if dir == .left {
                            badge("不喜欢", color: Color(red: 0.92, green: 0.45, blue: 0.42), icon: "xmark")
                            Spacer()
                        } else {
                            Spacer()
                            badge("感兴趣", color: Color(red: 0.45, green: 0.78, blue: 0.55), icon: "heart.fill")
                        }
                    }
                    Spacer()
                }
                .padding(22)
                .opacity(min(1, abs(dragOffset.width) / 140))   // 徽章更早浮现
            }
        }
    }

    private func badge(_ text: String, color: Color, icon: String) -> some View {
        Label(text, systemImage: icon)
            .font(.title3.bold())
            .tracking(1)
            .padding(.horizontal, 16)
            .padding(.vertical, 9)
            .background(.black.opacity(0.35), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(color, lineWidth: 2.2)
            )
            .foregroundStyle(color)
    }

    // MARK: - 顶栏

    private var topBar: some View {
        HStack {
            VStack(alignment: .leading, spacing: 1) {
                Text("KnowFlick")
                    .font(.custom("Songti SC Black", size: 21))
                    .foregroundStyle(Color(red: 0.96, green: 0.95, blue: 0.92))
                HStack(spacing: 6) {
                    Text("今天也想学点新东西")
                        .font(.system(size: 11.5, weight: .medium))
                        .tracking(0.5)
                        .foregroundStyle(.white.opacity(0.48))
                    if store.deck.count > 0 {
                        Text("· \(store.deck.count) 张待刷")
                            .font(.system(size: 11.5, weight: .medium))
                            .foregroundStyle(.white.opacity(0.35))
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
                    }
                    .padding(.horizontal, 13)
                    .padding(.vertical, 7)
                    .background(Color.white.opacity(0.09), in: Capsule())
                }

                iconButton("chart.bar", help: "学习统计") { showStats = true }
                iconButton("clock.arrow.circlepath", help: "历史记录") { showHistory = true }
                iconButton("arrow.clockwise", help: "换一批新知识") { Task { await store.refreshDeck() } }
                iconButton("gearshape", help: "设置") { showSettings = true }
                iconButton("questionmark.circle", help: "快捷键 ⌘?") { showHelp = true }
                    .keyboardShortcut("?", modifiers: .command)
            }
        }
        .foregroundStyle(.white)
    }

    private func iconButton(_ icon: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 14.5, weight: .semibold))
                .foregroundStyle(.white.opacity(0.78))
                .frame(width: 34, height: 34)
                .background(Color.white.opacity(0.08), in: Circle())
                .overlay(Circle().strokeBorder(Color.white.opacity(0.10), lineWidth: 1))
        }
        .buttonStyle(PressableButtonStyle())
        .help(help)
    }

    // MARK: - 底栏

    private var bottomBar: some View {
        HStack(spacing: 24) {
            roundButton("arrow.uturn.backward", size: 42, tint: Color(white: 0.72), help: "撤销上一张 ⌘Z") {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                    store.undoLastSwipe()
                }
            }
            .keyboardShortcut("z", modifiers: .command)
            .disabled(store.history.isEmpty)

            roundButton("xmark", size: 60, tint: Color(red: 0.92, green: 0.48, blue: 0.45), help: "不喜欢 ←") {
                performSwipe(.left)
            }
            .keyboardShortcut(.leftArrow, modifiers: [])

            roundButton("arrow.up.left.and.arrow.down.right", size: 50, tint: .white, help: "查看详情 ⏎") {
                if let card = store.topCard { selectedCard = card }
            }
            .keyboardShortcut(.return, modifiers: [])

            roundButton("heart.fill", size: 60, tint: Color(red: 0.45, green: 0.80, blue: 0.55), help: "感兴趣 →") {
                performSwipe(.right)
            }
            .keyboardShortcut(.rightArrow, modifiers: [])

            roundButton("dice", size: 42, tint: Color(red: 0.95, green: 0.72, blue: 0.42), help: store.settings.apiKey.isEmpty ? "配置 AI 后可生成新卡" : "AI 生成 3 张新卡 ⌘N") {
                if store.settings.apiKey.isEmpty {
                    showSettings = true
                } else {
                    Task { await store.generateNewCards(count: 3) }
                }
            }
            .keyboardShortcut("n", modifiers: .command)
        }
        .padding(.horizontal, 30)
        .padding(.vertical, 16)
        .background(Color.white.opacity(0.055), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.09), lineWidth: 1))
    }

    private func roundButton(_ icon: String, size: CGFloat, tint: Color, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: size * 0.36, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: size, height: size)
                .background(Color.white.opacity(0.07), in: Circle())
                .overlay(Circle().strokeBorder(tint.opacity(0.45), lineWidth: 1.3))
        }
        .buttonStyle(PressableButtonStyle())
        .help(help)
    }

    // MARK: - 空状态

    private var emptyState: some View {
        VStack(spacing: 18) {
            Image(systemName: "sparkles")
                .font(.system(size: 42))
                .foregroundStyle(.white.opacity(0.65))
            Text("今天的知识刷完了")
                .font(.custom("Songti SC Black", size: 24))
                .foregroundStyle(Color(red: 0.96, green: 0.95, blue: 0.92))
            Text(store.settings.apiKey.isEmpty
                 ? "去设置里配置 AI 服务，就能持续生成新知识"
                 : "让 AI 为你生成一批新的冷知识")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(.white.opacity(0.6))

            Button {
                if store.settings.apiKey.isEmpty {
                    showSettings = true
                } else {
                    Task { await store.generateNewCards(count: 5) }
                }
            } label: {
                Label(
                    store.settings.apiKey.isEmpty ? "配置 AI" : "生成新知识",
                    systemImage: store.settings.apiKey.isEmpty ? "gearshape" : "sparkles"
                )
                .font(.system(size: 14, weight: .semibold))
                .padding(.horizontal, 22)
                .padding(.vertical, 11)
            }
            .buttonStyle(PressableButtonStyle(scale: 1.03))
            .background(currentTheme.accent.opacity(0.22), in: Capsule())
            .overlay(Capsule().strokeBorder(currentTheme.accent.opacity(0.65), lineWidth: 1.3))
            .foregroundStyle(.white)
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

            // 细噪点纹理，去掉「数字平板感」
            NoiseOverlay()
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

// MARK: - 噪点纹理

struct NoiseOverlay: View {
    var body: some View {
        Canvas { context, size in
            var generator = SystemRandomNumberGenerator()
            for _ in 0..<2200 {
                let x = CGFloat.random(in: 0...size.width, using: &generator)
                let y = CGFloat.random(in: 0...size.height, using: &generator)
                let alpha = Double.random(in: 0.012...0.05, using: &generator)
                context.fill(
                    Path(CGRect(x: x, y: y, width: 1, height: 1)),
                    with: .color(.white.opacity(alpha))
                )
            }
        }
        .allowsHitTesting(false)
    }
}
