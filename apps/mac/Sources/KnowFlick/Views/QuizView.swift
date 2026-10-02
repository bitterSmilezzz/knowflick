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
            InsightColor.canvas
                .ignoresSafeArea()
            NoiseOverlay()
                .ignoresSafeArea()

            VStack(spacing: 0) {
                topBar
                Divider().overlay(InsightColor.divider)

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
        HStack(spacing: InsightSpacing.medium) {
            GlassIconButton(icon: "xmark", iconSize: 12, help: "退出测验 (Esc)", action: onClose)
                .keyboardShortcut(.escape, modifiers: [])

            HStack(spacing: InsightSpacing.compact) {
                Image(systemName: "graduationcap.fill")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(InsightColor.accent)

                Text(plannedCards != nil ? "到期复习" : category.map { "\($0) · 专项测验" } ?? "沉浸式知识测验")
                    .font(InsightFont.title)
                    .foregroundStyle(InsightColor.textPrimary)

                if !quizCards.isEmpty && !isCompleted {
                    InsightPill(text: "\(currentIndex + 1) / \(quizCards.count)", tone: .accent)
                }
            }

            Spacer()

            if !isCompleted && !quizCards.isEmpty {
                // 实时掌握度微缩计数（对错反馈语义色 success/warning/danger 原样）
                HStack(spacing: InsightSpacing.compact) {
                    HStack(spacing: InsightSpacing.tiny) {
                        Circle().fill(InsightColor.success).frame(width: 7, height: 7)
                        Text("\(countMastered)")
                            .font(InsightFont.mono)
                            .monospacedDigit()
                            .foregroundStyle(InsightColor.textSecondary)
                    }
                    HStack(spacing: InsightSpacing.tiny) {
                        Circle().fill(InsightColor.warning).frame(width: 7, height: 7)
                        Text("\(countHesitant)")
                            .font(InsightFont.mono)
                            .monospacedDigit()
                            .foregroundStyle(InsightColor.textSecondary)
                    }
                    HStack(spacing: InsightSpacing.tiny) {
                        Circle().fill(InsightColor.danger).frame(width: 7, height: 7)
                        Text("\(countForgot)")
                            .font(InsightFont.mono)
                            .monospacedDigit()
                            .foregroundStyle(InsightColor.textSecondary)
                    }
                }
                .padding(.horizontal, InsightSpacing.default)
                .padding(.vertical, InsightSpacing.small)
                .background(InsightColor.surface, in: Capsule())
                .overlay(Capsule().strokeBorder(InsightColor.border, lineWidth: 1))
            }
        }
        .padding(.horizontal, InsightLayout.contentPadding)
        .padding(.vertical, InsightSpacing.medium)
    }

    // MARK: - 测验答题区

    private var activeQuizArea: some View {
        VStack(spacing: InsightSpacing.medium) {
            // 平滑进度指示条（Cutline 单色进度条，替代旧琥珀→绿渐变）
            InsightProgressBar(
                value: quizCards.isEmpty ? 0 : Double(currentIndex + 1) / Double(quizCards.count),
                tint: InsightColor.accent,
                height: 4
            )
            .padding(.horizontal, InsightSpacing.xl)
            .padding(.top, InsightSpacing.compact)

            Spacer(minLength: InsightSpacing.compact)

            // 卡片主体
            if let card = currentCard {
                QuizCardView(
                    card: card,
                    isFlipped: isFlipped,
                    onFlip: {
                        withAnimation(InsightMotion.page) {
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

            Spacer(minLength: InsightSpacing.compact)

            // 底部提示
            Text("按 空格键/回车 翻看背面答案 · ⌘1 没想起来 · ⌘2 犹豫想起 · ⌘3 熟练掌握")
                .font(InsightFont.captionSmall)
                .foregroundStyle(InsightColor.textMuted)
                .padding(.bottom, InsightSpacing.medium)
        }
    }

    // MARK: - 测验完成结算面板

    private var summaryView: some View {
        ScrollView {
            VStack(spacing: InsightSpacing.xl) {
                Spacer(minLength: 10)

                // 顶端奖章与标题
                VStack(spacing: InsightSpacing.compact) {
                    Image(systemName: retentionRate >= 80 ? "medal.fill" : "chart.bar.fill")
                        .font(.system(size: 38))
                        .foregroundStyle(InsightColor.accent)

                    Text("本轮记忆测验已完成")
                        .font(InsightFont.title)
                        .foregroundStyle(InsightColor.textPrimary)

                    Text("艾宾浩斯记忆模型表明，及时主动提取能显著提升神经突触的长期连接。")
                        .font(InsightFont.caption)
                        .foregroundStyle(InsightColor.textSecondary)
                }

                // 留存率圆环展示（Cutline 单色强调，替代旧琥珀→绿渐变）
                ZStack {
                    Circle()
                        .stroke(InsightColor.border, lineWidth: 14)
                        .frame(width: 140, height: 140)

                    Circle()
                        .trim(from: 0, to: animateRing ? CGFloat(retentionRate) / 100.0 : 0)
                        .stroke(
                            InsightColor.accent,
                            style: StrokeStyle(lineWidth: 14, lineCap: .round)
                        )
                        .rotationEffect(.degrees(-90))
                        .frame(width: 140, height: 140)
                        .animation(.easeOut(duration: 1.0), value: animateRing)

                    VStack(spacing: InsightSpacing.tiny) {
                        Text("\(retentionRate)%")
                            .font(InsightFont.statLarge)
                            .foregroundStyle(InsightColor.textPrimary)
                        Text("记忆留存率")
                            .font(InsightFont.captionSmall.weight(.medium))
                            .foregroundStyle(InsightColor.textTertiary)
                    }
                }
                .padding(.vertical, InsightSpacing.compact)
                .onAppear {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                        animateRing = true
                    }
                }

                // 三分项指标卡片（对错反馈语义色原样）
                HStack(spacing: InsightSpacing.medium) {
                    statCard(
                        title: "熟练掌握",
                        count: countMastered,
                        total: quizCards.count,
                        color: InsightColor.success,
                        icon: "checkmark.circle.fill"
                    )

                    statCard(
                        title: "犹豫想起",
                        count: countHesitant,
                        total: quizCards.count,
                        color: InsightColor.warning,
                        icon: "questionmark.circle.fill"
                    )

                    statCard(
                        title: "需要强化",
                        count: countForgot,
                        total: quizCards.count,
                        color: InsightColor.danger,
                        icon: "xmark.circle.fill"
                    )
                }
                .frame(maxWidth: 560)

                let weakCards: [(KnowledgeCard, AppStore.QuizRating)] = quizCards.compactMap { card in
                    guard let rating = ratings[card.id], rating != .mastered else { return nil }
                    return (card, rating)
                }.sorted { $0.1 == .forgot && $1.1 != .forgot }

                if !weakCards.isEmpty {
                    VStack(alignment: .leading, spacing: InsightSpacing.default) {
                        HStack {
                            Text("本轮待强化卡片 (\(weakCards.count) 张)")
                                .font(InsightFont.headline)
                                .foregroundStyle(InsightColor.textPrimary)
                            Spacer()
                            Text("点击就地复盘")
                                .font(InsightFont.captionSmall)
                                .foregroundStyle(InsightColor.textTertiary)
                        }

                        VStack(spacing: InsightSpacing.compact) {
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
                HStack(spacing: InsightSpacing.medium) {
                    if countForgot > 0 || countHesitant > 0 {
                        InsightButton(
                            title: "针对性重测弱项 (\(countForgot + countHesitant) 题)",
                            icon: "arrow.triangle.2.circlepath",
                            style: .primary
                        ) {
                            reviewWeakCards()
                        }
                    }

                    // 题源在进入结算时算好（nextRoundCards），文案题量随实际张数变化；
                    // 到期复习场景重新拉取到期队列后可能已无到期卡片，此时不展示该按钮。
                    if !nextRoundCards.isEmpty {
                        InsightButton(
                            title: "再测一组 (\(nextRoundCards.count) 题)",
                            icon: "play.fill",
                            style: .secondary
                        ) {
                            startNextRound()
                        }
                    }

                    InsightButton(title: "完成并返回", style: .plain) {
                        onClose()
                    }
                }
                .padding(.top, 10)
                .padding(.bottom, 30)
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 32)
        }
    }

    private func statCard(title: String, count: Int, total: Int, color: Color, icon: String) -> some View {
        VStack(spacing: InsightSpacing.small) {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(color)

            Text("\(count)")
                .font(InsightFont.statMedium)
                .monospacedDigit()
                .foregroundStyle(InsightColor.textPrimary)

            Text(title)
                .font(InsightFont.callout)
                .foregroundStyle(InsightColor.textSecondary)

            Text(total > 0 ? "\(Int(Double(count) / Double(total) * 100))%" : "0%")
                .font(InsightFont.captionSmall)
                .monospacedDigit()
                .foregroundStyle(InsightColor.textMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, InsightSpacing.medium)
        .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous)
                .strokeBorder(color.opacity(0.3), lineWidth: 1)
        )
    }

    // MARK: - 空状态

    private var emptyView: some View {
        VStack(spacing: InsightSpacing.medium) {
            Spacer()
            Image(systemName: "tray")
                .font(.system(size: 40))
                .foregroundStyle(InsightColor.textMuted)
            Text("暂无可测验的卡片")
                .font(InsightFont.title)
                .foregroundStyle(InsightColor.textPrimary)
            Text("请先在主界面多浏览几张知识卡片，或将感兴趣的冷知识加入收藏阁。")
                .font(InsightFont.caption)
                .foregroundStyle(InsightColor.textSecondary)
            InsightButton(title: "返回主界面", style: .primary) {
                onClose()
            }
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
        withAnimation(InsightMotion.page) {
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
            withAnimation(InsightMotion.shell) {
                currentIndex += 1
                isFlipped = false
            }
        } else {
            // 结算前算好下一轮题源：此时本轮的评分已全部写入 store，
            // 与用户点「再测一组」时的 store 状态一致，文案题量可直接取自它。
            nextRoundCards = makeNextRoundCards()
            withAnimation(InsightMotion.page) {
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
            HStack(spacing: InsightSpacing.compact) {
                Text(card.category)
                    .font(InsightFont.callout)
                    .foregroundStyle(theme.accent)
                    .padding(.horizontal, InsightSpacing.small)
                    .padding(.vertical, 3)
                    .background(theme.accent.opacity(0.12), in: Capsule())
                    .overlay(Capsule().strokeBorder(theme.accent.opacity(0.3), lineWidth: 1))

                Text(card.headline)
                    .font(InsightFont.bodyStrong)
                    .foregroundStyle(InsightColor.textPrimary)
                    .lineLimit(isExpanded ? nil : 1)

                Spacer()

                // 评分回显胶囊（对错反馈语义色 danger/warning 原样）
                let isForgot = (rating == .forgot)
                InsightPill(text: isForgot ? "没想起来" : "犹豫想起", tone: isForgot ? .danger : .warning)

                Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(InsightColor.textTertiary)
            }
            .contentShape(Rectangle())
            .onTapGesture {
                withAnimation(InsightMotion.shell) {
                    isExpanded.toggle()
                }
            }

            if isExpanded {
                VStack(alignment: .leading, spacing: InsightSpacing.small) {
                    Text(card.summary)
                        .font(InsightFont.body)
                        .foregroundStyle(InsightColor.textSecondary)
                        .lineSpacing(4)
                        .padding(.top, InsightSpacing.compact)

                    Text("解析：" + card.details)
                        .font(InsightFont.body)
                        .foregroundStyle(InsightColor.textTertiary)
                        .lineSpacing(4)
                        .lineLimit(4)
                        .padding(.top, InsightSpacing.tiny)
                }
            }

            HStack(spacing: InsightSpacing.compact) {
                Spacer()

                Button(action: onPromote) {
                    HStack(spacing: InsightSpacing.tiny) {
                        Image(systemName: isPromoted ? "checkmark" : "arrow.up.to.line")
                            .font(.system(size: 10, weight: .bold))
                        Text(isPromoted ? "已置顶卡堆" : "置顶卡堆")
                            .font(InsightFont.captionSmall.weight(.medium))
                    }
                    .foregroundStyle(isPromoted ? InsightColor.success : InsightColor.accent)
                    .padding(.horizontal, InsightSpacing.default)
                    .padding(.vertical, 4.5)
                    .background(isPromoted ? InsightColor.successSoft : InsightColor.accentSoft, in: Capsule())
                    .overlay(
                        Capsule().strokeBorder(
                            (isPromoted ? InsightColor.success : InsightColor.accent).opacity(0.35),
                            lineWidth: 1
                        )
                    )
                }
                .buttonStyle(PressableButtonStyle())
                .disabled(isPromoted)

                // AI 相关入口保留 warning 语义
                Button(action: onChat) {
                    HStack(spacing: InsightSpacing.tiny) {
                        Image(systemName: "cpu")
                            .font(.system(size: 10, weight: .bold))
                        Text("AI 追问")
                            .font(InsightFont.captionSmall.weight(.semibold))
                    }
                    .foregroundStyle(InsightColor.warning)
                    .padding(.horizontal, InsightSpacing.default)
                    .padding(.vertical, 4.5)
                    .background(InsightColor.warningSoft, in: Capsule())
                    .overlay(Capsule().strokeBorder(InsightColor.warning.opacity(0.35), lineWidth: 1))
                }
                .buttonStyle(PressableButtonStyle())
            }
            .padding(.top, 10)
        }
        .padding(InsightSpacing.medium)
        .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.inset, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: InsightRadius.inset, style: .continuous)
                .strokeBorder(InsightColor.border, lineWidth: 1)
        )
    }
}

