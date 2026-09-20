import SwiftUI
import AppKit
import KnowFlickCore

/// 知识测验主视图：主动回忆答题、流畅卡片进出场、键盘盲操支持与测验结算总结
struct QuizView: View {
    let store: AppStore
    var category: String? = nil
    var plannedCards: [KnowledgeCard]? = nil
    var onOpenChat: ((KnowledgeCard) -> Void)? = nil
    let onClose: () -> Void

    @State private var quizCards: [KnowledgeCard] = []
    @State private var currentIndex: Int = 0
    @State private var isFlipped: Bool = false
    @State private var ratings: [UUID: AppStore.QuizRating] = [:]
    @State private var promotedCardIds: Set<UUID> = []
    @State private var isCompleted: Bool = false
    @State private var animateRing: Bool = false
    /// 评分输入锁：一次评分动作已受理、卡片切换动画尚未结束时，忽略重复的按钮/⌘1-3 输入，
    /// 避免第二次输入落到下一张用户还没看到的卡片上并给它错误评分。
    @State private var isAdvancing: Bool = false
    /// 结算面板「再测一组」的题源，提前算好，保证按钮文案题量与实际出题张数一致
    @State private var nextRoundCards: [KnowledgeCard] = []

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
        .frame(minWidth: 720, minHeight: 560)
        .onAppear {
            // 宿主重建视图身份时不清空答题进度（仅首次或明确重新开始时初始化）
            if quizCards.isEmpty {
                startNewQuiz(category: category)
            }
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
            GlassIconButton(icon: "xmark", iconSize: 12, help: "退出测验 (Esc)", action: onClose)
                .keyboardShortcut(.escape, modifiers: [])

            HStack(spacing: 8) {
                Image(systemName: "graduationcap.fill")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(EditorialColor.aiAmber)

                Text(plannedCards != nil ? "到期复习" : category.map { "\($0) · 专项测验" } ?? "沉浸式知识测验")
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
                    },
                    onOpenChat: {
                        onOpenChat?(card)
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

                let weakCards: [(KnowledgeCard, AppStore.QuizRating)] = quizCards.compactMap { card in
                    guard let rating = ratings[card.id], rating != .mastered else { return nil }
                    return (card, rating)
                }.sorted { $0.1 == .forgot && $1.1 != .forgot }

                if !weakCards.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("本轮待强化卡片 (\(weakCards.count) 张)")
                                .font(EditorialFont.modalTitle)
                                .foregroundStyle(EditorialColor.textPrimary)
                            Spacer()
                            Text("点击就地复盘")
                                .font(EditorialFont.captionSmall)
                                .foregroundStyle(EditorialColor.textTertiary)
                        }

                        VStack(spacing: 8) {
                            ForEach(weakCards, id: \.0.id) { (weakCard, rating) in
                                WeakCardRowView(
                                    card: weakCard,
                                    rating: rating,
                                    isPromoted: promotedCardIds.contains(weakCard.id),
                                    onPromote: {
                                        promotedCardIds.insert(weakCard.id)
                                        store.promoteToDeckTop(weakCard)
                                    },
                                    onChat: {
                                        onOpenChat?(weakCard)
                                    }
                                )
                            }
                        }
                    }
                    .frame(maxWidth: 560)
                }

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

                    // 题源在进入结算时算好（nextRoundCards），文案题量随实际张数变化；
                    // 到期复习场景重新拉取到期队列后可能已无到期卡片，此时不展示该按钮。
                    if !nextRoundCards.isEmpty {
                        Button {
                            startNextRound()
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "play.fill")
                                Text("再测一组 (\(nextRoundCards.count) 题)")
                            }
                            .font(EditorialFont.label)
                            .foregroundStyle(EditorialColor.textPrimary)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 12)
                            .background(EditorialColor.glassSurface, in: Capsule())
                            .overlay(Capsule().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                        }
                        .buttonStyle(PressableButtonStyle())
                    }

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
        let cards = plannedCards ?? store.generateQuizCards(category: category, limit: 10)
        self.quizCards = cards
        self.currentIndex = 0
        self.isFlipped = false
        self.ratings = [:]
        self.isCompleted = false
        self.animateRing = false
        self.isAdvancing = false
        self.nextRoundCards = []
    }

    /// 计算「再测一组」的题源。到期复习场景选择「重新拉取到期队列」而不是重测旧数组：
    /// 旧数组里的卡片刚在本轮被打分，`recordQuizResult` 已把 `lastReviewedAt` 推到今天，
    /// 再测一遍只会重复累计复习次数并二次覆盖掌握度；重新拉取 `LearningPlan.due` 才是
    /// 「到期复习」的语义（刚评过的卡若仍在到期窗口内会自然被再次纳入，否则不再出现）。
    private func makeNextRoundCards() -> [KnowledgeCard] {
        if plannedCards != nil {
            return Array(LearningPlan(cards: store.cards).due.prefix(10))
        }
        return store.generateQuizCards(category: category, limit: 10)
    }

    /// 结算面板「再测一组」：使用进入结算时预算好的题源，避免把已评分的旧数组再测一遍
    private func startNextRound() {
        let cards = nextRoundCards
        self.quizCards = cards
        self.currentIndex = 0
        self.isFlipped = false
        self.ratings = [:]
        self.isCompleted = false
        self.animateRing = false
        self.isAdvancing = false
        self.nextRoundCards = []
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
        self.isAdvancing = false
        self.nextRoundCards = []
    }

    private func toggleFlip() {
        guard !isCompleted && !quizCards.isEmpty else { return }
        withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
            isFlipped.toggle()
        }
    }

    private func rateCurrent(_ rating: AppStore.QuizRating) {
        guard !isCompleted, !isAdvancing, let card = currentCard else { return }
        // 同一张卡在本轮内只允许评分一次：连点（按钮双击/⌘1-3 连按）的第二次输入
        // 会被这里的双重守卫挡掉，不会落到下一张尚未展示的卡片上。
        guard ratings[card.id] == nil else { return }
        isAdvancing = true
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
            // 结算前算好下一轮题源：此时本轮的评分已全部写入 store，
            // 与用户点「再测一组」时的 store 状态一致，文案题量可直接取自它。
            nextRoundCards = makeNextRoundCards()
            withAnimation(.spring(response: 0.45, dampingFraction: 0.8)) {
                isCompleted = true
            }
        }
        // 卡片切换动画结束后再解锁输入，避免动画期间的连点误评下一张
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            isAdvancing = false
        }
    }

    private func submitRating(_ rating: AppStore.QuizRating) {
        rateCurrent(rating)
    }
}

// MARK: - 待强化错题复盘行组件

private struct WeakCardRowView: View {
    let card: KnowledgeCard
    let rating: AppStore.QuizRating
    let isPromoted: Bool
    let onPromote: () -> Void
    let onChat: () -> Void

    @State private var isExpanded: Bool = false

    private var theme: CategoryTheme {
        CategoryTheme.theme(for: card, cache: .shared)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text(card.category)
                    .font(EditorialFont.badge)
                    .foregroundStyle(theme.accent)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(theme.accent.opacity(0.12), in: Capsule())
                    .overlay(Capsule().strokeBorder(theme.accent.opacity(0.3), lineWidth: 0.8))

                Text(card.headline)
                    .font(EditorialFont.label)
                    .foregroundStyle(EditorialColor.textPrimary)
                    .lineLimit(isExpanded ? nil : 1)

                Spacer()

                let isForgot = (rating == .forgot)
                Text(isForgot ? "没想起来" : "犹豫想起")
                    .font(EditorialFont.captionSmall.weight(.bold))
                    .foregroundStyle(isForgot ? EditorialColor.dislikeRed : EditorialColor.aiAmber)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2.5)
                    .background(isForgot ? EditorialColor.dislikeRed.opacity(0.12) : EditorialColor.aiAmberBg, in: Capsule())
                    .overlay(Capsule().strokeBorder(isForgot ? EditorialColor.dislikeRed.opacity(0.4) : EditorialColor.aiAmberBorder, lineWidth: 0.8))

                Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(EditorialColor.textTertiary)
            }
            .contentShape(Rectangle())
            .onTapGesture {
                withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                    isExpanded.toggle()
                }
            }

            if isExpanded {
                VStack(alignment: .leading, spacing: 6) {
                    Text(card.summary)
                        .font(EditorialFont.summarySerif)
                        .foregroundStyle(EditorialColor.textSecondary)
                        .lineSpacing(4)
                        .padding(.top, 8)

                    Text("解析：" + card.details)
                        .font(EditorialFont.bodySerif)
                        .foregroundStyle(EditorialColor.textTertiary)
                        .lineSpacing(4)
                        .lineLimit(4)
                        .padding(.top, 4)
                }
            }

            HStack(spacing: 8) {
                Spacer()

                Button(action: onPromote) {
                    HStack(spacing: 4) {
                        Image(systemName: isPromoted ? "checkmark" : "arrow.up.to.line")
                            .font(.system(size: 10, weight: .bold))
                        Text(isPromoted ? "已置顶卡堆" : "置顶卡堆")
                            .font(EditorialFont.captionSmall.weight(.medium))
                    }
                    .foregroundStyle(isPromoted ? EditorialColor.likeGreen : EditorialColor.aiAmber)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4.5)
                    .background(isPromoted ? EditorialColor.likeGreen.opacity(0.12) : EditorialColor.aiAmberBg, in: Capsule())
                    .overlay(Capsule().strokeBorder(isPromoted ? EditorialColor.likeGreen.opacity(0.4) : EditorialColor.aiAmberBorder, lineWidth: 0.8))
                }
                .buttonStyle(PressableButtonStyle())
                .disabled(isPromoted)

                Button(action: onChat) {
                    HStack(spacing: 4) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 10, weight: .bold))
                        Text("AI 追问")
                            .font(EditorialFont.captionSmall.weight(.semibold))
                    }
                    .foregroundStyle(EditorialColor.aiAmber)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4.5)
                    .background(EditorialColor.aiAmberBg, in: Capsule())
                    .overlay(Capsule().strokeBorder(EditorialColor.aiAmberBorder, lineWidth: 0.8))
                }
                .buttonStyle(PressableButtonStyle())
            }
            .padding(.top, 10)
        }
        .padding(14)
        .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(EditorialColor.glassBorder, lineWidth: 1)
        )
    }
}

