import SwiftUI
import AppKit
import KnowFlickCore

/// 知识测验主视图：主动回忆答题、流畅卡片进出场、键盘盲操支持与测验结算总结
struct QuizView: View {
    let store: AppStore
    var category: String? = nil
    let onClose: () -> Void

    @State private var quizCards: [KnowledgeCard] = []
    @State private var currentIndex: Int = 0
    @State private var isFlipped: Bool = false
    @State private var ratings: [UUID: AppStore.QuizRating] = [:]
    @State private var isCompleted: Bool = false
    @State private var animateRing: Bool = false

    private var currentCard: KnowledgeCard? {
        guard currentIndex >= 0 && currentIndex < quizCards.count else { return nil }
        return quizCards[currentIndex]
    }

    private var countMastered: Int {
        ratings.values.filter { $0 == .mastered }.count
    }

    private var countHesitant: Int {
        ratings.values.filter { $0 == .hesitant }.count
    }

    private var countForgot: Int {
        ratings.values.filter { $0 == .forgot }.count
    }

    /// 综合记忆留存率 (0 ~ 100%)
    private var retentionRate: Int {
        guard !quizCards.isEmpty else { return 0 }
        let score = Double(countMastered) * 1.0 + Double(countHesitant) * 0.5
        return Int((score / Double(quizCards.count)) * 100)
    }

    var body: some View {
        ZStack {
            EditorialColor.canvasGradient
                .ignoresSafeArea()
            NoiseOverlay()
                .ignoresSafeArea()

            VStack(spacing: 0) {
                topBar
                Divider().overlay(EditorialColor.glassDivider)

                if quizCards.isEmpty {
                    emptyView
                } else if isCompleted {
                    summaryView
                } else {
                    activeQuizArea
                }
            }
        }
        .frame(minWidth: 800, minHeight: 620)
        .onAppear {
            startNewQuiz(category: category)
        }
        // 全局键盘盲操快捷键绑定
        .background(
            Group {
                Button("") { toggleFlip() }
                    .keyboardShortcut(.space, modifiers: [])
                Button("") { toggleFlip() }
                    .keyboardShortcut(.return, modifiers: [])
                Button("") { rateCurrent(.forgot) }
                    .keyboardShortcut("1", modifiers: .command)
                Button("") { rateCurrent(.hesitant) }
                    .keyboardShortcut("2", modifiers: .command)
                Button("") { rateCurrent(.mastered) }
                    .keyboardShortcut("3", modifiers: .command)
            }
            .opacity(0)
            .accessibilityHidden(true)
        )
    }

    // MARK: - 顶栏

    private var topBar: some View {
        HStack(spacing: 16) {
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(EditorialColor.textPrimary)
                    .frame(width: 32, height: 32)
                    .background(EditorialColor.glassSurface, in: Circle())
                    .overlay(Circle().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
            }
            .buttonStyle(PressableButtonStyle())
            .keyboardShortcut(.escape, modifiers: [])
            .help("退出测验 (Esc)")

            HStack(spacing: 8) {
                Image(systemName: "graduationcap.fill")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(EditorialColor.aiAmber)

                Text(category.map { "\($0) · 专项测验" } ?? "沉浸式知识测验")
                    .font(EditorialFont.modalTitle)
                    .foregroundStyle(EditorialColor.textPrimary)

                if !quizCards.isEmpty && !isCompleted {
                    Text("\(currentIndex + 1) / \(quizCards.count)")
                        .font(EditorialFont.captionSmall.weight(.bold))
                        .foregroundStyle(EditorialColor.aiAmber)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(EditorialColor.aiAmberBg, in: Capsule())
                        .overlay(Capsule().strokeBorder(EditorialColor.aiAmberBorder, lineWidth: 1))
                }
            }

            Spacer()

            if !isCompleted && !quizCards.isEmpty {
                // 实时掌握度微缩计数
                HStack(spacing: 10) {
                    HStack(spacing: 4) {
                        Circle().fill(EditorialColor.likeGreen).frame(width: 7, height: 7)
                        Text("\(countMastered)")
                            .font(.system(size: 12, weight: .bold, design: .monospaced))
                            .foregroundStyle(EditorialColor.textSecondary)
                    }
                    HStack(spacing: 4) {
                        Circle().fill(EditorialColor.aiAmber).frame(width: 7, height: 7)
                        Text("\(countHesitant)")
                            .font(.system(size: 12, weight: .bold, design: .monospaced))
                            .foregroundStyle(EditorialColor.textSecondary)
                    }
                    HStack(spacing: 4) {
                        Circle().fill(EditorialColor.dislikeRed).frame(width: 7, height: 7)
                        Text("\(countForgot)")
                            .font(.system(size: 12, weight: .bold, design: .monospaced))
                            .foregroundStyle(EditorialColor.textSecondary)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(EditorialColor.glassSurface, in: Capsule())
                .overlay(Capsule().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 16)
    }

    // MARK: - 测验答题区

    private var activeQuizArea: some View {
        VStack(spacing: 16) {
            // 平滑进度指示条
            GeometryReader { geo in
                let progress = quizCards.isEmpty ? 0 : CGFloat(currentIndex + 1) / CGFloat(quizCards.count)
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(EditorialColor.glassBorder)
                        .frame(height: 4)

                    Capsule()
                        .fill(
                            LinearGradient(
                                colors: [EditorialColor.aiAmber, EditorialColor.likeGreen],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(width: max(8, geo.size.width * progress), height: 4)
                        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: progress)
                }
            }
            .frame(height: 4)
            .padding(.horizontal, 40)
            .padding(.top, 8)

            Spacer(minLength: 8)

            // 卡片主体
            if let card = currentCard {
                QuizCardView(
                    card: card,
                    isFlipped: isFlipped,
                    onFlip: {
                        withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                            isFlipped.toggle()
                        }
                    },
                    onRate: { rating in
                        submitRating(rating)
                    }
                )
                .id(card.id)
                .transition(.asymmetric(
                    insertion: .opacity.combined(with: .scale(scale: 0.96)),
                    removal: .opacity.combined(with: .scale(scale: 1.02))
                ))
            }

            Spacer(minLength: 8)

            // 底部提示
            Text("按 空格键/回车 翻看背面答案 · ⌘1 没想起来 · ⌘2 犹豫想起 · ⌘3 熟练掌握")
                .font(EditorialFont.captionSmall)
                .foregroundStyle(EditorialColor.textMuted)
                .padding(.bottom, 16)
        }
    }

    // MARK: - 测验完成结算面板

    private var summaryView: some View {
        ScrollView {
            VStack(spacing: 28) {
                Spacer(minLength: 10)

                // 顶端奖章与标题
                VStack(spacing: 8) {
                    Image(systemName: retentionRate >= 80 ? "medal.fill" : "sparkles")
                        .font(.system(size: 38))
                        .foregroundStyle(EditorialColor.aiAmber)

                    Text("本轮记忆测验已完成")
                        .font(EditorialFont.modalTitle)
                        .foregroundStyle(EditorialColor.textPrimary)

                    Text("艾宾浩斯记忆模型表明，及时主动提取能显著提升神经突触的长期连接。")
                        .font(EditorialFont.caption)
                        .foregroundStyle(EditorialColor.textSecondary)
                }

                // 留存率圆环展示
                ZStack {
                    Circle()
                        .stroke(EditorialColor.glassBorder, lineWidth: 14)
                        .frame(width: 140, height: 140)

                    Circle()
                        .trim(from: 0, to: animateRing ? CGFloat(retentionRate) / 100.0 : 0)
                        .stroke(
                            LinearGradient(
                                colors: [EditorialColor.aiAmber, EditorialColor.likeGreen],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            style: StrokeStyle(lineWidth: 14, lineCap: .round)
                        )
                        .rotationEffect(.degrees(-90))
                        .frame(width: 140, height: 140)
                        .animation(.easeOut(duration: 1.0), value: animateRing)

                    VStack(spacing: 2) {
                        Text("\(retentionRate)%")
                            .font(EditorialFont.statFigure)
                            .foregroundStyle(EditorialColor.textPrimary)
                        Text("记忆留存率")
                            .font(EditorialFont.captionSmall.weight(.medium))
                            .foregroundStyle(EditorialColor.textTertiary)
                    }
                }
                .padding(.vertical, 8)
                .onAppear {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                        animateRing = true
                    }
                }

                // 三分项指标卡片
                HStack(spacing: 16) {
                    statCard(
                        title: "熟练掌握",
                        count: countMastered,
                        total: quizCards.count,
                        color: EditorialColor.likeGreen,
                        icon: "checkmark.circle.fill"
                    )

                    statCard(
                        title: "犹豫想起",
                        count: countHesitant,
                        total: quizCards.count,
                        color: EditorialColor.aiAmber,
                        icon: "questionmark.circle.fill"
                    )

                    statCard(
                        title: "需要强化",
                        count: countForgot,
                        total: quizCards.count,
                        color: EditorialColor.dislikeRed,
                        icon: "xmark.circle.fill"
                    )
                }
                .frame(maxWidth: 560)

                // 底部行动按键组
                HStack(spacing: 16) {
                    if countForgot > 0 || countHesitant > 0 {
                        Button {
                            reviewWeakCards()
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "arrow.triangle.2.circlepath")
                                Text("针对性重测弱项 (\(countForgot + countHesitant) 题)")
                            }
                            .font(EditorialFont.label)
                            .foregroundStyle(Color.white)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 12)
                            .background(EditorialColor.aiAmber, in: Capsule())
                        }
                        .buttonStyle(PressableButtonStyle())
                    }

                    Button {
                        startNewQuiz(category: category)
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "play.fill")
                            Text("再测一组 (10 题)")
                        }
                        .font(EditorialFont.label)
                        .foregroundStyle(EditorialColor.textPrimary)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 12)
                        .background(EditorialColor.glassSurface, in: Capsule())
                        .overlay(Capsule().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                    }
                    .buttonStyle(PressableButtonStyle())

                    Button(action: onClose) {
                        Text("完成并返回")
                            .font(EditorialFont.label)
                            .foregroundStyle(EditorialColor.textSecondary)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 12)
                    }
                    .buttonStyle(PressableButtonStyle())
                }
                .padding(.top, 10)
                .padding(.bottom, 30)
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 32)
        }
    }

    private func statCard(title: String, count: Int, total: Int, color: Color, icon: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(color)

            Text("\(count)")
                .font(EditorialFont.statFigureSmall)
                .foregroundStyle(EditorialColor.textPrimary)

            Text(title)
                .font(EditorialFont.labelSmall)
                .foregroundStyle(EditorialColor.textSecondary)

            Text(total > 0 ? "\(Int(Double(count) / Double(total) * 100))%" : "0%")
                .font(EditorialFont.captionSmall)
                .foregroundStyle(EditorialColor.textMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(color.opacity(0.3), lineWidth: 1)
        )
    }

    // MARK: - 空状态

    private var emptyView: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "tray")
                .font(.system(size: 40))
                .foregroundStyle(EditorialColor.textMuted)
            Text("暂无可测验的卡片")
                .font(EditorialFont.modalTitle)
                .foregroundStyle(EditorialColor.textPrimary)
            Text("请先在主界面多浏览几张知识卡片，或将感兴趣的冷知识加入收藏阁。")
                .font(EditorialFont.caption)
                .foregroundStyle(EditorialColor.textSecondary)
            Button(action: onClose) {
                Text("返回主界面")
                    .font(EditorialFont.label)
                    .foregroundStyle(Color.white)
                    .padding(.horizontal, 22)
                    .padding(.vertical, 10)
                    .background(EditorialColor.aiAmber, in: Capsule())
            }
            .buttonStyle(PressableButtonStyle())
            .padding(.top, 10)
            Spacer()
        }
    }

    // MARK: - 交互动作

    private func startNewQuiz(category: String?) {
        let cards = store.generateQuizCards(category: category, limit: 10)
        self.quizCards = cards
        self.currentIndex = 0
        self.isFlipped = false
        self.ratings = [:]
        self.isCompleted = false
        self.animateRing = false
    }

    private func reviewWeakCards() {
        let weakIds = Set(ratings.filter { $0.value != .mastered }.map(\.key))
        let weakCards = quizCards.filter { weakIds.contains($0.id) }
        self.quizCards = weakCards.shuffled()
        self.currentIndex = 0
        self.isFlipped = false
        self.ratings = [:]
        self.isCompleted = false
        self.animateRing = false
    }

    private func toggleFlip() {
        guard !isCompleted && !quizCards.isEmpty else { return }
        withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
            isFlipped.toggle()
        }
    }

    private func rateCurrent(_ rating: AppStore.QuizRating) {
        guard !isCompleted, let card = currentCard else { return }
        // 如果尚未翻面，允许快速翻看后打分，或直接记录
        ratings[card.id] = rating
        store.recordQuizResult(cardId: card.id, rating: rating)
        HapticFeedbackHelper.shared.cardSwiped()

        advanceToNext()
    }

    private func advanceToNext() {
        if currentIndex + 1 < quizCards.count {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                currentIndex += 1
                isFlipped = false
            }
        } else {
            withAnimation(.spring(response: 0.45, dampingFraction: 0.8)) {
                isCompleted = true
            }
        }
    }

    private func submitRating(_ rating: AppStore.QuizRating) {
        rateCurrent(rating)
    }
}
