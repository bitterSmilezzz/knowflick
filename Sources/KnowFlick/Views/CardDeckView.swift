import SwiftUI

/// 卡片堆叠主界面：左右拖动划走、点击看详情
struct CardDeckView: View {
    @Bindable var store: AppStore

    // 拖拽状态
    @State private var dragOffset: CGSize = .zero
    @State private var swipeDirection: SwipeDirection? = nil
    @State private var selectedCard: KnowledgeCard? = nil
    @State private var showSettings = false
    @State private var showHistory = false
    @State private var errorBanner = false

    var body: some View {
        ZStack {
            backgroundGradient
                .ignoresSafeArea()
                .animation(.easeInOut(duration: 0.6), value: store.topCard?.category)

            VStack(spacing: 0) {
                topBar
                    .padding(.horizontal, 32)
                    .padding(.top, 24)

                Spacer(minLength: 12)

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
                .padding(.horizontal, 90)
                .padding(.vertical, 20)
                .gesture(topCardGesture)

                Spacer(minLength: 12)

                bottomBar
                    .padding(.bottom, 30)
            }
        }
        .task(id: store.topCard?.id) {
            // 顶卡变化时复位拖拽状态
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
        .sheet(item: $selectedCard) { card in
            DetailView(card: card, store: store) {
                selectedCard = nil
            }
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
                let threshold: CGFloat = 110
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
            width: direction == .left ? -620 : 620,
            height: dragOffset.height * 0.6
        )
        withAnimation(.easeOut(duration: 0.22)) {
            dragOffset = target
            swipeDirection = direction
        }
        // 动画结束后落库并复位
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) {
            store.swipe(card, direction: direction)
            dragOffset = .zero
            swipeDirection = nil
        }
    }

    // MARK: - 布局参数

    private var rotationAngle: Angle {
        let degrees = Double(dragOffset.width / 22)
        return .degrees(min(max(degrees, -14), 14))
    }

    private func scaleFor(index: Int) -> CGFloat {
        guard index == 0 else { return 1.0 - CGFloat(index) * 0.045 }
        let progress = abs(dragOffset.width) / 620
        return 1.0 - progress * 0.06
    }

    private func offsetYFor(index: Int) -> CGFloat {
        guard index == 0 else { return CGFloat(index) * 18 }
        return -abs(dragOffset.width) * 0.04
    }

    private var swipeBadge: some View {
        Group {
            if let dir = swipeDirection {
                VStack {
                    HStack {
                        if dir == .left {
                            badge("不喜欢", color: .red, icon: "xmark")
                            Spacer()
                        } else {
                            Spacer()
                            badge("感兴趣", color: .green, icon: "heart.fill")
                        }
                    }
                    Spacer()
                }
                .padding(24)
                .opacity(min(1, abs(dragOffset.width) / 160))
            }
        }
    }

    private func badge(_ text: String, color: Color, icon: String) -> some View {
        Label(text, systemImage: icon)
            .font(.title2.bold())
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .background(color.opacity(0.25), in: RoundedRectangle(cornerRadius: 14))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(color, lineWidth: 2.5)
            )
            .foregroundStyle(color)
    }

    // MARK: - 顶栏

    private var topBar: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("KnowFlick")
                    .font(.title2.bold())
                    .foregroundStyle(.white)
                Text("今天也想学点新东西")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.6))
            }

            Spacer()

            HStack(spacing: 14) {
                if store.isGenerating {
                    HStack(spacing: 6) {
                        ProgressView()
                            .controlSize(.small)
                            .tint(.white)
                        Text("AI 正在收集新知识…")
                            .font(.caption)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(.white.opacity(0.12), in: Capsule())
                }

                iconButton("clock.arrow.circlepath", help: "历史记录") { showHistory = true }
                iconButton("arrow.clockwise", help: "换一批新知识") { Task { await store.refreshDeck() } }
                iconButton("gearshape", help: "设置") { showSettings = true }
            }
        }
        .foregroundStyle(.white)
    }

    private func iconButton(_ icon: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                .frame(width: 36, height: 36)
                .background(.white.opacity(0.12), in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .help(help)
    }

    // MARK: - 底栏

    private var bottomBar: some View {
        HStack(spacing: 26) {
            roundButton("arrow.uturn.backward", size: 44, tint: .gray.opacity(0.9), help: "撤销上一张 ⌘Z") {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                    store.undoLastSwipe()
                }
            }
            .keyboardShortcut("z", modifiers: .command)
            .disabled(store.history.isEmpty)

            roundButton("xmark", size: 64, tint: .red, help: "不喜欢，划走 ←") {
                performSwipe(.left)
            }
            .keyboardShortcut(.leftArrow, modifiers: [])

            roundButton("magnifyingglass", size: 52, tint: .white, help: "查看详情 ⏎") {
                if let card = store.topCard { selectedCard = card }
            }
            .keyboardShortcut(.return, modifiers: [])

            roundButton("heart.fill", size: 64, tint: .green, help: "感兴趣，收藏 →") {
                performSwipe(.right)
            }
            .keyboardShortcut(.rightArrow, modifiers: [])

            roundButton("dice", size: 44, tint: .orange, help: "AI 生成 3 张新卡") {
                Task { await store.generateNewCards(count: 3) }
            }
            .keyboardShortcut("n", modifiers: .command)
        }
        .padding(.horizontal, 32)
        .padding(.vertical, 18)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(.white.opacity(0.12), lineWidth: 1))
    }

    private func roundButton(_ icon: String, size: CGFloat, tint: Color, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: size * 0.38, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: size, height: size)
                .background(.white.opacity(0.10), in: Circle())
                .overlay(Circle().strokeBorder(tint.opacity(0.6), lineWidth: 1.5))
        }
        .buttonStyle(.plain)
        .help(help)
    }

    // MARK: - 空状态

    private var emptyState: some View {
        VStack(spacing: 18) {
            Image(systemName: "sparkles")
                .font(.system(size: 44))
                .foregroundStyle(.white.opacity(0.7))
            Text("知识刷完了")
                .font(.title2.bold())
                .foregroundStyle(.white)
            Text(store.settings.apiKey.isEmpty
                 ? "去设置里配置 AI 服务，就能持续生成新知识"
                 : "让 AI 为你生成一批新的冷知识")
                .font(.callout)
                .foregroundStyle(.white.opacity(0.65))

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
                .font(.body.bold())
                .padding(.horizontal, 22)
                .padding(.vertical, 10)
            }
            .buttonStyle(.borderedProminent)
            .tint(.white.opacity(0.2))
        }
    }

    // MARK: - 背景

    private var backgroundGradient: some View {
        let base: [Color] = {
            switch store.topCard?.category {
            case "物理": [Color(red: 0.08, green: 0.12, blue: 0.28), Color(red: 0.05, green: 0.06, blue: 0.12)]
            case "生物": [Color(red: 0.05, green: 0.20, blue: 0.16), Color(red: 0.04, green: 0.07, blue: 0.10)]
            case "天文": [Color(red: 0.16, green: 0.08, blue: 0.26), Color(red: 0.05, green: 0.05, blue: 0.12)]
            case "数学": [Color(red: 0.26, green: 0.13, blue: 0.06), Color(red: 0.10, green: 0.06, blue: 0.08)]
            case "历史": [Color(red: 0.22, green: 0.15, blue: 0.07), Color(red: 0.09, green: 0.07, blue: 0.06)]
            case "心理", "脑科学": [Color(red: 0.25, green: 0.09, blue: 0.18), Color(red: 0.09, green: 0.05, blue: 0.10)]
            default: [Color(red: 0.09, green: 0.14, blue: 0.25), Color(red: 0.05, green: 0.07, blue: 0.13)]
            }
        }()
        return LinearGradient(colors: base, startPoint: .top, endPoint: .bottom)
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
        .background(.red.opacity(0.85), in: Capsule())
        .padding(.top, 16)
        .task {
            try? await Task.sleep(for: .seconds(5))
            errorBanner = false
        }
    }
}
