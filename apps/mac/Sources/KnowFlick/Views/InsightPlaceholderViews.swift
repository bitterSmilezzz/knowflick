import SwiftUI
import KnowFlickCore

// MARK: - 侧栏各视图的内容区（Cutline 式）
//
// 每个视图统一形态：顶栏（标题 + 描述 + 右侧操作）+ 主体（卡片网格 / 列表 / 统计块）。
// 尚未深度改造的数据源仍复用旧面板：这些占位视图提供「Cutline 化」的入口与框架，
// 具体内容在下一批按使用频率逐个深化。

/// 通用内容区框架：Cutline 的「标题 + 描述 + 右侧操作」
struct InsightContentScaffold<Actions: View, Content: View>: View {
    let title: String
    let subtitle: String
    @ViewBuilder var actions: Actions
    @ViewBuilder var content: Content

    init(
        title: String,
        subtitle: String,
        @ViewBuilder actions: () -> Actions = { EmptyView() },
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.subtitle = subtitle
        self.actions = actions()
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: InsightSpacing.hair) {
                    Text(title)
                        .font(InsightFont.title)
                        .foregroundStyle(InsightColor.textPrimary)
                    Text(subtitle)
                        .font(InsightFont.callout)
                        .foregroundStyle(InsightColor.textTertiary)
                }
                Spacer(minLength: InsightSpacing.large)
                actions
            }
            .padding(.horizontal, InsightLayout.contentPadding)
            .padding(.top, InsightSpacing.large)
            .padding(.bottom, InsightSpacing.default)

            content
        }
    }
}

/// 空态（Cutline 用图标 + 标题 + 说明 + 动作）
struct InsightEmptyState: View {
    let icon: String
    let title: String
    let message: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: InsightSpacing.default) {
            Image(systemName: icon)
                .font(.system(size: 34))
                .foregroundStyle(InsightColor.textMuted)
            Text(title)
                .font(InsightFont.headline)
                .foregroundStyle(InsightColor.textSecondary)
            Text(message)
                .font(InsightFont.body)
                .foregroundStyle(InsightColor.textTertiary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 360)
            if let actionTitle, let action {
                InsightButton(title: actionTitle, style: .secondary, action: action)
                    .padding(.top, InsightSpacing.small)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - 今日 / 复习 / 知识库

struct InsightWorkspacePlaceholder: View {
    let destination: InsightDestination
    @Bindable var store: AppStore
    var onOpenSheet: (ActiveSheet) -> Void

    var body: some View {
        InsightContentScaffold(
            title: destination.rawValue,
            subtitle: subtitle
        ) {
            ScrollView {
                VStack(alignment: .leading, spacing: InsightSpacing.large) {
                    statRow
                    cardSection
                }
                .padding(.horizontal, InsightLayout.contentPadding)
                .padding(.bottom, InsightSpacing.large)
            }
        }
    }

    private var subtitle: String {
        switch destination {
        case .today: return "今日待刷与学习目标"
        case .review: return "按记忆排程到期的卡片"
        case .library: return "按主题浏览全部 \(store.cards.count) 张卡片"
        default: return ""
        }
    }

    /// Cutline 的统计块行（大数字 + 进度）
    private var statRow: some View {
        HStack(spacing: InsightSpacing.compact) {
            InsightCard(padding: InsightSpacing.default) {
                InsightStatBlock(
                    value: "\(store.deck.count)",
                    label: "待刷卡片",
                    tone: .accent
                )
            }
            InsightCard(padding: InsightSpacing.default) {
                InsightStatBlock(
                    value: "\(store.history.count)",
                    label: "已刷卡片",
                    tone: .success
                )
            }
            InsightCard(padding: InsightSpacing.default) {
                InsightStatBlock(
                    value: "\(store.favorites.count)",
                    label: "收藏卡片",
                    tone: .warning
                )
            }
        }
    }

    @ViewBuilder
    private var cardSection: some View {
        let cards = previewCards
        if cards.isEmpty {
            InsightEmptyState(
                icon: "tray",
                title: "暂无内容",
                message: "换一批新知识，或从其他视图开始探索。"
            )
        } else {
            VStack(alignment: .leading, spacing: InsightSpacing.default) {
                InsightSectionLabel(text: "推荐", trailing: "\(cards.count)")
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: InsightLayout.gridMinColumn), spacing: InsightSpacing.compact)],
                    spacing: InsightSpacing.compact
                ) {
                    ForEach(cards) { card in
                        InsightCardTile(card: card) {
                            onOpenSheet(.detail(card))
                        }
                    }
                }
            }
        }
    }

    private var previewCards: [KnowledgeCard] {
        switch destination {
        case .review:
            return Array(store.cards.filter { $0.seenAt != nil }.prefix(8))
        default:
            return Array(store.cards.prefix(8))
        }
    }
}

// MARK: - 收藏

struct InsightFavoritesPlaceholder: View {
    @Bindable var store: AppStore
    var onOpenSheet: (ActiveSheet) -> Void

    var body: some View {
        InsightContentScaffold(
            title: "收藏",
            subtitle: store.favorites.isEmpty ? "右滑卡片即可加入收藏" : "\(store.favorites.count) 张已收藏"
        ) {
            Group {
                if store.favorites.isEmpty {
                    InsightEmptyState(
                        icon: "heart",
                        title: "还没有收藏",
                        message: "刷卡时右滑，或按 → 键把感兴趣的卡片收进这里。"
                    )
                } else {
                    ScrollView {
                        LazyVGrid(
                            columns: [GridItem(.adaptive(minimum: InsightLayout.gridMinColumn), spacing: InsightSpacing.compact)],
                            spacing: InsightSpacing.compact
                        ) {
                            ForEach(store.favorites) { card in
                                InsightCardTile(card: card) { onOpenSheet(.detail(card)) }
                            }
                        }
                        .padding(.horizontal, InsightLayout.contentPadding)
                        .padding(.bottom, InsightSpacing.large)
                    }
                }
            }
        }
    }
}

// MARK: - 历史

struct InsightHistoryPlaceholder: View {
    @Bindable var store: AppStore
    var onOpenSheet: (ActiveSheet) -> Void

    var body: some View {
        InsightContentScaffold(
            title: "历史",
            subtitle: "刷过的卡片按时间倒序"
        ) {
            Group {
                if store.history.isEmpty {
                    InsightEmptyState(icon: "clock", title: "还没有记录", message: "刷过的卡片会出现在这里。")
                } else {
                    ScrollView {
                        LazyVStack(spacing: InsightSpacing.tiny) {
                            ForEach(Array(store.history.prefix(80).enumerated()), id: \.element.id) { index, card in
                                InsightListRow(card: card, trailing: relativeTime(card.seenAt ?? card.createdAt)) {
                                    onOpenSheet(.detail(card))
                                }
                                .modifier(InsightStaggerReveal(index: index))
                            }
                        }
                        .padding(.horizontal, InsightLayout.contentPadding)
                        .padding(.bottom, InsightSpacing.large)
                    }
                }
            }
        }
    }

    private func relativeTime(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

/// 列表交错入场（素材 e7 的 stagger 手法）
struct InsightStaggerReveal: ViewModifier {
    let index: Int
    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown ? 0 : 8)
            .onAppear {
                withAnimation(InsightMotion.page.delay(Double(index) * InsightMotion.stagger)) {
                    shown = true
                }
            }
    }
}

// MARK: - 统计

struct InsightStatsPlaceholder: View {
    @Bindable var store: AppStore
    var onOpenSheet: (ActiveSheet) -> Void

    private var stats: LearningStats {
        StatsCalculator.compute(from: store.cards)
    }

    var body: some View {
        InsightContentScaffold(
            title: "统计",
            subtitle: "从刷卡记录派生的学习快照"
        ) {
            Group {
                if stats.seenCount == 0 {
                    InsightEmptyState(icon: "chart.bar", title: "暂无数据", message: "刷过卡片后，这里会出现你的学习统计。")
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: InsightSpacing.compact) {
                            InsightSectionLabel(text: "总览")
                                .padding(.bottom, InsightSpacing.tiny)
                            LazyVGrid(
                                columns: [GridItem(.adaptive(minimum: 180), spacing: InsightSpacing.compact)],
                                spacing: InsightSpacing.compact
                            ) {
                                statTile(value: "\(stats.seenCount)", label: "已刷卡片", tone: .accent, index: 0)
                                statTile(value: "\(stats.likedCount)", label: "感兴趣", tone: .success, index: 1)
                                statTile(value: "\(stats.skipCount)", label: "系统跳过", tone: .warning, index: 2)
                                statTile(value: "\(stats.streakDays)", label: "连续天数", tone: .violet, index: 3)
                            }
                            StatsSections(store: store)
                        }
                        .padding(.horizontal, InsightLayout.contentPadding)
                        .padding(.bottom, InsightSpacing.large)
                    }
                }
            }
        }
    }

    private func statTile(value: String, label: String, tone: InsightPill.Tone, index: Int) -> some View {
        InsightCard(padding: InsightSpacing.default) {
            InsightStatBlock(value: value, label: label, tone: tone)
        }
        .modifier(InsightStaggerReveal(index: index))
    }
}

// MARK: - 统计图表 section（Cutline 化）

/// 统计页的图表区：掌握度堆叠胶囊 / 排程 / 35 天热力图 / 近 7 天趋势。
/// 数据全部走 StatsCalculator / LearningPlan，与旧 StatsView 同源。
private struct StatsSections: View {
    @Bindable var store: AppStore

    private var plan: LearningPlan { LearningPlan(cards: store.cards) }
    private var dist: MasteryDistribution { plan.masteryDistribution }

    var body: some View {
        VStack(alignment: .leading, spacing: InsightSpacing.compact) {
            masterySection
            scheduleSection
            heatmapSection
            trendSection
        }
    }

    // 掌握度三段堆叠胶囊
    private var masterySection: some View {
        let total = max(dist.totalCards, 1)
        return InsightCard {
            VStack(alignment: .leading, spacing: InsightSpacing.default) {
                HStack {
                    Text("知识掌握度分布").font(InsightFont.headline).foregroundStyle(InsightColor.textPrimary)
                    Spacer()
                    Text("累计复习 \(dist.totalReviews) 人次")
                        .font(InsightFont.captionSmall).foregroundStyle(InsightColor.textMuted)
                }
                HStack(spacing: 3) {
                    if dist.masteredCount > 0 {
                        Capsule().fill(InsightColor.success)
                            .frame(width: max(8, 600 * CGFloat(dist.masteredCount) / CGFloat(total)))
                    }
                    if dist.hesitantCount > 0 {
                        Capsule().fill(InsightColor.warning)
                            .frame(width: max(8, 600 * CGFloat(dist.hesitantCount) / CGFloat(total)))
                    }
                    if dist.needsReviewCount > 0 {
                        Capsule().fill(InsightColor.textMuted)
                            .frame(width: max(8, 600 * CGFloat(dist.needsReviewCount) / CGFloat(total)))
                    }
                }
                .frame(height: 10)
                HStack(spacing: InsightSpacing.large) {
                    legend("熟练掌握", count: dist.masteredCount, color: InsightColor.success)
                    legend("学习中", count: dist.hesitantCount, color: InsightColor.warning)
                    legend("需强化", count: dist.needsReviewCount, color: InsightColor.textMuted)
                }
            }
        }
    }

    private func legend(_ title: String, count: Int, color: Color) -> some View {
        HStack(spacing: InsightSpacing.small) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(title).font(InsightFont.caption).foregroundStyle(InsightColor.textSecondary)
            Text("\(count)").font(InsightFont.monoSmall).monospacedDigit().foregroundStyle(InsightColor.textPrimary)
        }
    }

    // 排程三块
    private var scheduleSection: some View {
        InsightCard {
            VStack(alignment: .leading, spacing: InsightSpacing.default) {
                Text("接下来的安排").font(InsightFont.headline).foregroundStyle(InsightColor.textPrimary)
                HStack(spacing: InsightSpacing.compact) {
                    scheduleTile(title: "今日到期", count: plan.due.count, tone: .danger)
                    scheduleTile(title: "已熟练掌握", count: dist.masteredCount, tone: .success)
                    scheduleTile(title: "需强化", count: dist.needsReviewCount, tone: .warning)
                }
            }
        }
    }

    private func scheduleTile(title: String, count: Int, tone: InsightPill.Tone) -> some View {
        VStack(alignment: .leading, spacing: InsightSpacing.tiny) {
            Text("\(count)").font(InsightFont.statMedium).foregroundStyle(tone.foreground).monospacedDigit()
            Text(title).font(InsightFont.caption).foregroundStyle(InsightColor.textTertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(InsightSpacing.default)
        .background(InsightColor.surfaceSunken, in: RoundedRectangle(cornerRadius: InsightRadius.inset, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: InsightRadius.inset, style: .continuous)
                .strokeBorder(InsightColor.border, lineWidth: 1)
        )
    }

    // 35 天热力图
    private var heatmapSection: some View {
        InsightCard {
            VStack(alignment: .leading, spacing: InsightSpacing.default) {
                Text("学习足迹").font(InsightFont.headline).foregroundStyle(InsightColor.textPrimary)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 5), count: 7), spacing: 5) {
                    ForEach(daily(days: 35), id: \.day) { item in
                        let color: Color = {
                            if item.count == 0 { return InsightColor.surfaceSunken }
                            if item.count <= 2 { return InsightColor.success.opacity(0.35) }
                            if item.count <= 5 { return InsightColor.success.opacity(0.65) }
                            return InsightColor.success
                        }()
                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .fill(color).aspectRatio(1, contentMode: .fit)
                            .overlay(
                                RoundedRectangle(cornerRadius: 3, style: .continuous)
                                    .strokeBorder(item.count > 0 ? Color.white.opacity(0.10) : InsightColor.border, lineWidth: 0.8)
                            )
                            .help(Self.dateFormatter.string(from: item.day) + ": 研习 \(item.count) 张")
                    }
                }
                HStack {
                    Spacer()
                    Text("少").font(InsightFont.captionSmall).foregroundStyle(InsightColor.textMuted)
                    HStack(spacing: 3) {
                        ForEach([InsightColor.surfaceSunken, InsightColor.success.opacity(0.35),
                                 InsightColor.success.opacity(0.65), InsightColor.success], id: \.self) { c in
                            RoundedRectangle(cornerRadius: 2).fill(c).frame(width: 9, height: 9)
                        }
                    }
                    Text("多").font(InsightFont.captionSmall).foregroundStyle(InsightColor.textMuted)
                }
            }
        }
    }

    // 近 7 天趋势柱
    private var trendSection: some View {
        InsightCard {
            VStack(alignment: .leading, spacing: InsightSpacing.default) {
                Text("近 7 天学习趋势").font(InsightFont.headline).foregroundStyle(InsightColor.textPrimary)
                HStack(alignment: .bottom, spacing: InsightSpacing.small) {
                    ForEach(daily(days: 7), id: \.day) { item in
                        VStack(spacing: InsightSpacing.tiny) {
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .fill(item.count > 0 ? InsightColor.accent : InsightColor.surfaceSunken)
                                .frame(height: CGFloat(item.count) * 12)
                            Text("\(item.count)").font(InsightFont.captionSmall).monospacedDigit()
                                .foregroundStyle(InsightColor.textMuted)
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                .frame(height: 110, alignment: .bottom)
            }
        }
    }

    private func daily(days: Int) -> [LearningStats.DailyCount] {
        StatsCalculator.dailyCounts(cards: store.cards, days: days)
    }

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "M月d日"
        return f
    }()
}

// MARK: - 星图 / 测验 / 听书 —— 仍在深化的功能，给 Cutline 化入口

struct InsightGraphPlaceholder: View {
    @Bindable var store: AppStore
    var onOpen: () -> Void

    var body: some View {
        InsightContentScaffold(
            title: "知识星图",
            subtitle: "Card 之间的关联网络"
        ) {
            InsightEmptyState(
                icon: "point.3.connected.trianglepath.dotted",
                title: "全屏星图",
                message: "星图需要大画布，将在独立窗口中打开。",
                actionTitle: "打开星图",
                action: onOpen
            )
        }
    }
}

struct InsightQuizPlaceholder: View {
    @Bindable var store: AppStore
    var onOpen: () -> Void

    var body: some View {
        InsightContentScaffold(
            title: "知识测验",
            subtitle: "主动回忆，检验记忆"
        ) {
            InsightEmptyState(
                icon: "questionmark.circle",
                title: "开始测验",
                message: "从到期卡片中抽取题目，先回忆再揭晓答案。",
                actionTitle: "开始测验",
                action: onOpen
            )
        }
    }
}

struct InsightConsolePlaceholder: View {
    @Bindable var store: AppStore
    var onOpen: () -> Void

    var body: some View {
        InsightContentScaffold(
            title: "听书",
            subtitle: "语速、音调与睡前淡出"
        ) {
            InsightEmptyState(
                icon: "headphones",
                title: "语音控制台",
                message: "调节朗读档位、定时与淡出曲线。",
                actionTitle: "打开控制台",
                action: onOpen
            )
        }
    }
}
