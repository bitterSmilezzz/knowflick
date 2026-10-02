import SwiftUI
import KnowFlickCore

// 统计页（自 InsightPlaceholderViews.swift 拆出）：总览 + 掌握度 + 记忆排程
// + 35 天热力图 / 近 7 天趋势 + 分类分布。数据全部走 StatsCalculator / LearningPlan 纯派生。

// MARK: - 统计

/// 统计页（Cutline 形态）：总览行 + 掌握度分布 + 艾宾浩斯概览 + 未来 7 天到期预测
/// + 35 天热力图 + 近 7 天趋势 + 分类分布（点击分类行局部 sheet 下钻 HistoryView）。
/// 功能自旧 StatsView 平移；数据全部走 StatsCalculator / LearningPlan 纯派生，视图只做格式化。
struct InsightStatsPlaceholder: View {
    @Bindable var store: AppStore

    /// 分类下钻载荷：点分类行 → 带筛选局部 sheet 打开 HistoryView（不经 ActiveSheet）
    @State private var historyCategory: CategoryNav?
    @State private var stats = StatsCalculator.compute(from: [])
    @State private var plan = LearningPlan(cards: [])
    @State private var daily35: [LearningStats.DailyCount] = []

    private func refreshSnapshot() {
        let now = Date()
        stats = StatsCalculator.compute(from: store.cards)
        plan = LearningPlan(cards: store.cards, now: now)
        daily35 = StatsCalculator.dailyCounts(cards: store.cards, days: 35)
    }

    var body: some View {
        InsightContentScaffold(
            title: "统计",
            subtitle: "浏览、掌握度与复习安排"
        ) {
            Group {
                if stats.seenCount == 0 && plan.masteryDistribution.totalReviews == 0 {
                    InsightEmptyState(icon: "chart.bar", title: "暂无数据", message: "刷过卡片后，这里会出现你的学习统计与记忆排程。")
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
                                statTile(
                                    value: "\(stats.likedCount)",
                                    label: "感兴趣",
                                    caption: "\(Int((stats.likeRate * 100).rounded()))%",
                                    tone: .success,
                                    index: 1
                                )
                                statTile(value: "\(stats.skipCount)", label: "系统跳过", tone: .warning, index: 2)
                                statTile(value: "\(stats.streakDays)", label: "连续天数", tone: .violet, index: 3)
                            }
                            StatsSections(plan: plan, stats: stats, daily35: daily35, daily7: Array(daily35.suffix(7)), onDrillDown: { category in
                                historyCategory = CategoryNav(category: category)
                            })
                        }
                        .padding(.horizontal, InsightLayout.contentPadding)
                        .padding(.bottom, InsightSpacing.large)
                    }
                }
            }
        }
        .onAppear(perform: refreshSnapshot)
        .onChange(of: store.cards) { _, _ in refreshSnapshot() }
        .onLearningDayChange(perform: refreshSnapshot)
        .sheet(item: $historyCategory) { nav in
            HistoryView(
                store: store,
                showAIMark: store.settings.showAIMark,
                categoryFilter: nav.category
            ) {
                historyCategory = nil
            }
        }
    }

    private func statTile(value: String, label: String, caption: String? = nil, tone: InsightPill.Tone, index: Int) -> some View {
        InsightCard(padding: InsightSpacing.default) {
            InsightStatBlock(value: value, label: label, caption: caption, tone: tone)
        }

    }
}

/// sheet(item:) 用的跳转载荷：点分类 → 带筛选打开历史页（与旧 StatsView 的 CategoryNav 模式一致）
private struct CategoryNav: Identifiable {
    let id = UUID()
    let category: String
}

// MARK: - 统计图表 section（Cutline 化）

/// 统计页的图表区：掌握度堆叠胶囊 / 艾宾浩斯概览 / 未来 7 天到期预测 / 35 天热力图 /
/// 近 7 天趋势 / 分类分布（下钻回调）。
/// 数据全部由宿主一次性算好后以值下发（与旧 StatsView 同源），此处不再触碰 store。
private struct StatsSections: View {
    let plan: LearningPlan
    let stats: LearningStats
    let daily35: [LearningStats.DailyCount]
    let daily7: [LearningStats.DailyCount]
    var onDrillDown: (String) -> Void

    private var dist: MasteryDistribution { plan.masteryDistribution }

    var body: some View {
        VStack(alignment: .leading, spacing: InsightSpacing.compact) {
            masterySection
            ebbinghausSection
            forecastSection
            heatmapSection
            trendSection
            categorySection
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
                    Text("累计复习 \(dist.totalReviews) 次")
                        .font(InsightFont.captionSmall).foregroundStyle(InsightColor.textMuted)
                }
                GeometryReader { geometry in
                    let segments: [(Int, Color)] = [
                        (dist.masteredCount, InsightColor.success),
                        (dist.hesitantCount, InsightColor.warning),
                        (dist.needsReviewCount, InsightColor.textMuted)
                    ].filter { $0.0 > 0 }
                    let usable = max(0, geometry.size.width - CGFloat(max(0, segments.count - 1)) * 3)
                    HStack(spacing: 3) {
                        ForEach(segments.indices, id: \.self) { index in
                            Capsule().fill(segments[index].1)
                                .frame(width: usable * CGFloat(segments[index].0) / CGFloat(total))
                        }
                    }
                }
                .frame(height: 10)
                .accessibilityHidden(true)
                HStack(spacing: InsightSpacing.large) {
                    legend(
                        "熟练掌握", count: dist.masteredCount,
                        percent: Int((Double(dist.masteredCount) / Double(total) * 100).rounded()),
                        color: InsightColor.success
                    )
                    legend(
                        "学习中", count: dist.hesitantCount,
                        percent: Int((Double(dist.hesitantCount) / Double(total) * 100).rounded()),
                        color: InsightColor.warning
                    )
                    legend(
                        "需强化", count: dist.needsReviewCount,
                        percent: Int((Double(dist.needsReviewCount) / Double(total) * 100).rounded()),
                        color: InsightColor.textMuted
                    )
                }
            }
        }
    }

    private func legend(_ title: String, count: Int, percent: Int, color: Color) -> some View {
        HStack(spacing: InsightSpacing.small) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(title).font(InsightFont.caption).foregroundStyle(InsightColor.textSecondary)
            Text("\(count) 张 (\(percent)%)")
                .font(InsightFont.monoSmall).monospacedDigit()
                .foregroundStyle(InsightColor.textPrimary)
        }
    }

    // 艾宾浩斯 / SM-2 间隔复习概览（自旧 StatsView 平移）
    private var ebbinghausSection: some View {
        InsightCard {
            VStack(alignment: .leading, spacing: InsightSpacing.default) {
                HStack {
                    Text("间隔复习").font(InsightFont.headline).foregroundStyle(InsightColor.textPrimary)
                    Spacer()
                    Text("按回忆反馈安排 1、3、7 天间隔")
                        .font(InsightFont.captionSmall).foregroundStyle(InsightColor.textMuted)
                }
                HStack(spacing: InsightSpacing.compact) {
                    metricTile(
                        title: "今日到期",
                        value: "\(plan.due.count)", unit: "张",
                        tone: plan.due.isEmpty ? .success : .warning
                    )
                    metricTile(title: "今日已复习", value: "\(plan.completedToday)", unit: "张", tone: .success)
                    metricTile(title: "掌握度估算", value: "\(dist.retentionRate)", unit: "%", tone: .accent)
                }
            }
        }
    }

    private func metricTile(title: String, value: String, unit: String, tone: InsightPill.Tone) -> some View {
        VStack(alignment: .leading, spacing: InsightSpacing.tiny) {
            HStack(alignment: .firstTextBaseline, spacing: InsightSpacing.hair) {
                Text(value)
                    .font(InsightFont.statMedium)
                    .foregroundStyle(tone.foreground)
                    .monospacedDigit()
                Text(unit)
                    .font(InsightFont.caption)
                    .foregroundStyle(InsightColor.textSecondary)
            }
            Text(title)
                .font(InsightFont.caption)
                .foregroundStyle(InsightColor.textTertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(InsightSpacing.default)
        .background(InsightColor.surfaceSunken, in: RoundedRectangle(cornerRadius: InsightRadius.inset, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: InsightRadius.inset, style: .continuous)
                .strokeBorder(InsightColor.border, lineWidth: 1)
        )
    }

    // 未来 7 天到期预测（自旧 StatsView 平移）
    private var forecastSection: some View {
        let schedule = plan.upcomingSchedule(days: 7)
        let maxCount = max(schedule.map(\.count).max() ?? 1, 1)
        return InsightCard {
            VStack(alignment: .leading, spacing: InsightSpacing.default) {
                HStack {
                    Text("未来 7 天到期预测").font(InsightFont.headline).foregroundStyle(InsightColor.textPrimary)
                    Spacer()
                    Text("基于间隔复习排程推演")
                        .font(InsightFont.captionSmall).foregroundStyle(InsightColor.textMuted)
                }
                HStack(alignment: .bottom, spacing: InsightSpacing.small) {
                    ForEach(schedule) { item in
                        VStack(spacing: InsightSpacing.tiny) {
                            Text("\(item.count)")
                                .font(InsightFont.captionSmall).monospacedDigit()
                                .foregroundStyle(item.isToday ? InsightColor.warning : (item.count > 0 ? InsightColor.textPrimary : InsightColor.textMuted))
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .fill(item.isToday ? InsightColor.warning : (item.count > 0 ? InsightColor.accent : InsightColor.surfaceSunken))
                                .frame(height: max(6, CGFloat(item.count) / CGFloat(maxCount) * 64))
                            Text(dayLabel(item.date))
                                .font(InsightFont.captionSmall)
                                .foregroundStyle(item.isToday ? InsightColor.warning : InsightColor.textTertiary)
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                .frame(height: 112, alignment: .bottom)
            }
        }
    }

    private func dayLabel(_ day: Date) -> String {
        if plan.calendar.isDate(day, inSameDayAs: plan.now) { return "今天" }
        return Self.weekdayFormatter.string(from: day)
    }

    private static let weekdayFormatter: DateFormatter = {
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "zh_CN")
        fmt.dateFormat = "E"
        return fmt
    }()

    // 35 天热力图
    private var heatmapSection: some View {
        InsightCard {
            VStack(alignment: .leading, spacing: InsightSpacing.default) {
                Text("学习足迹").font(InsightFont.headline).foregroundStyle(InsightColor.textPrimary)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 5), count: 7), spacing: 5) {
                    ForEach(daily35, id: \.day) { item in
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
                            .help(Self.dateFormatter.string(from: item.day) + ": 阅读 \(item.count) 张")
                            .accessibilityLabel(Self.dateFormatter.string(from: item.day) + ": 阅读 \(item.count) 张")
                    }
                }
                .frame(maxWidth: 340, alignment: .leading)
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
        let maxCount = max(daily7.map(\.count).max() ?? 1, 1)
        return InsightCard {
            VStack(alignment: .leading, spacing: InsightSpacing.default) {
                Text("近 7 天学习趋势").font(InsightFont.headline).foregroundStyle(InsightColor.textPrimary)
                HStack(alignment: .bottom, spacing: InsightSpacing.small) {
                    ForEach(daily7, id: \.day) { item in
                        VStack(spacing: InsightSpacing.tiny) {
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .fill(item.count > 0 ? InsightColor.accent : InsightColor.surfaceSunken)
                                .frame(height: max(2, CGFloat(item.count) / CGFloat(maxCount) * 64))
                            Text("\(item.count)").font(InsightFont.captionSmall).monospacedDigit()
                                .foregroundStyle(InsightColor.textSecondary)
                            Text(dayLabel(item.day)).font(InsightFont.captionSmall)
                                .foregroundStyle(InsightColor.textSecondary)
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                .frame(height: 110, alignment: .bottom)
            }
        }
    }

    // 分类浏览与感兴趣分布：点击分类行 → 下钻对应历史（onDrillDown → 统计页局部 sheet）
    private var categorySection: some View {
        InsightCard {
            VStack(alignment: .leading, spacing: InsightSpacing.small) {
                HStack {
                    Text("分类浏览与感兴趣分布").font(InsightFont.headline).foregroundStyle(InsightColor.textPrimary)
                    Spacer()
                    Text("点击分类行可查看对应历史")
                        .font(InsightFont.captionSmall).foregroundStyle(InsightColor.textMuted)
                }

                let maxSeen = max(stats.categories.first?.seen ?? 1, 1)
                ForEach(stats.categories) { stat in
                    categoryRow(stat, maxSeen: maxSeen)
                }
            }
        }
    }

    /// 一行分类：名称 + 条形（总宽=已刷占比，白色段=感兴趣占比）+ 数值
    private func categoryRow(_ stat: LearningStats.CategoryStat, maxSeen: Int) -> some View {
        let accent = CategoryTheme.visualSpec(for: stat.category).accent
        return Button {
            onDrillDown(stat.category)
        } label: {
            HStack(spacing: InsightSpacing.default) {
                Text(stat.category)
                    .font(InsightFont.bodyStrong)
                    .foregroundStyle(InsightColor.textPrimary)
                    .lineLimit(1)
                    .frame(minWidth: 90, maxWidth: 150, alignment: .leading)

                GeometryReader { geo in
                    let barWidth = geo.size.width * CGFloat(stat.seen) / CGFloat(maxSeen)
                    ZStack(alignment: .leading) {
                        Capsule().fill(InsightColor.surface)
                        Capsule().fill(accent)
                            .frame(width: barWidth)
                        if stat.seen > 0 && stat.liked > 0 {
                            Capsule().fill(Color.white.opacity(0.55))
                                .frame(width: barWidth * CGFloat(stat.liked) / CGFloat(stat.seen))
                        }
                    }
                }
                .frame(height: 10)

                Text("\(stat.seen) 张 · \(Int((stat.likeRate * 100).rounded()))% 感兴趣")
                    .font(InsightFont.caption)
                    .foregroundStyle(InsightColor.textSecondary)
                    .frame(width: 150, alignment: .trailing)
            }
            .padding(.horizontal, InsightSpacing.default)
            .padding(.vertical, InsightSpacing.small)
            .background(InsightColor.surfaceSunken, in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
                    .strokeBorder(InsightColor.border, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "M月d日"
        return f
    }()
}
