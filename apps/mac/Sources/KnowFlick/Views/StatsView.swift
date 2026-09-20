import SwiftUI
import KnowFlickCore

/// 学习统计与记忆中心：
/// 1. 总览（已刷/感兴趣率/连续天数/熟练掌握）
/// 2. 艾宾浩斯 / SM-2 间隔复习概览卡（今日到期/今日已完成/记忆留存率）
/// 3. 掌握度三档分布可视化胶囊（熟练 7天 / 学习中 3天 / 需强化 1天 堆叠胶囊条）
/// 4. 未来 7 天到期预测时间线（前瞻排程柱状图）
/// 5. 35 天学习活跃打卡热力图
/// 6. 近 7 天学习趋势与分类分布
struct StatsView: View {
    let store: AppStore
    let onClose: () -> Void

    @State private var historyCategory: CategoryNav?

    // MARK: - 派生数据

    private var stats: LearningStats {
        StatsCalculator.compute(from: store.cards)
    }

    private var plan: LearningPlan {
        LearningPlan(cards: store.cards)
    }

    // MARK: - 视图主体

    var body: some View {
        ZStack {
            EditorialColor.canvasGradient
                .ignoresSafeArea()
            NoiseOverlay().ignoresSafeArea()

            VStack(spacing: 0) {
                header
                Divider().overlay(EditorialColor.glassDivider)

                if stats.seenCount == 0 {
                    Spacer()
                    VStack(spacing: 14) {
                        Image(systemName: "chart.bar.xaxis")
                            .font(.system(size: 42))
                            .foregroundStyle(EditorialColor.textMuted)
                        Text("刷过卡片后，这里会出现你的学习统计与记忆排程")
                            .font(EditorialFont.bodySerif)
                            .foregroundStyle(EditorialColor.textTertiary)
                    }
                    Spacer()
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 28) {
                            overview
                            ebbinghausSection
                            masterySection
                            upcomingScheduleSection
                            activityHeatmapSection
                            trendSection
                            categorySection
                        }
                        .padding(24)
                    }
                }
            }
        }
        .frame(minWidth: 720, minHeight: 600)
        .sheet(item: $historyCategory) { nav in
            HistoryView(store: store, showAIMark: store.settings.showAIMark, categoryFilter: nav.category) {
                historyCategory = nil
            }
        }
    }

    // MARK: - 顶栏

    private var header: some View {
        HStack {
            HStack(spacing: 10) {
                Image(systemName: "chart.bar.fill")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(EditorialColor.likeGreen)
                Text("学习与记忆统计")
                    .font(EditorialFont.modalTitle)
                    .foregroundStyle(EditorialColor.textPrimary)
            }
            Spacer()
            Button(action: onClose) {
                Text("完成")
                    .font(EditorialFont.label)
                    .foregroundStyle(EditorialColor.textSecondary)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 7)
                    .background(EditorialColor.glassSurface, in: Capsule())
                    .overlay(Capsule().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
            }
            .buttonStyle(PressableButtonStyle())
            .keyboardShortcut(.escape, modifiers: [])
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 18)
    }

    // MARK: - 总览（4项大字号专栏指标）

    private var overview: some View {
        HStack(spacing: 14) {
            statBlock(
                value: "\(stats.seenCount)",
                caption: "已刷卡片",
                icon: "square.stack.3d.up.fill",
                tint: EditorialColor.textPrimary
            )
            statBlock(
                value: "\(stats.likedCount) · \(Int((stats.likeRate * 100).rounded()))%",
                caption: "感兴趣（率）",
                icon: "heart.fill",
                tint: EditorialColor.likeGreen
            )
            statBlock(
                value: "\(stats.streakDays) 天",
                caption: "连续学习",
                icon: "flame.fill",
                tint: EditorialColor.aiAmber
            )
            statBlock(
                value: "\(plan.mastered) 张",
                caption: "熟练掌握",
                icon: "star.fill",
                tint: EditorialColor.likeGreen
            )
        }
    }

    private func statBlock(value: String, caption: String, icon: String, tint: Color) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 38, height: 38)
                .background(tint.opacity(0.12), in: Circle())
                .overlay(Circle().strokeBorder(tint.opacity(0.25), lineWidth: 1))
            VStack(alignment: .leading, spacing: 3) {
                Text(value)
                    .font(EditorialFont.statFigure)
                    .foregroundStyle(EditorialColor.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(caption)
                    .font(EditorialFont.caption)
                    .foregroundStyle(EditorialColor.textTertiary)
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .editorialGlassCard(cornerRadius: EditorialRadius.container)
    }

    // MARK: - 艾宾浩斯 / SM-2 间隔复习概览卡

    private var ebbinghausSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                HStack(spacing: 8) {
                    Image(systemName: "brain.head.profile")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(EditorialColor.aiAmber)
                    Text("艾宾浩斯间隔复习")
                        .font(EditorialFont.sectionTitle)
                        .foregroundStyle(EditorialColor.textPrimary)
                }
                Spacer()
                Text("基于 SM-2 记忆曲线排程")
                    .font(EditorialFont.captionSmall)
                    .foregroundStyle(EditorialColor.textMuted)
            }

            HStack(spacing: 12) {
                ebbinghausMetric(
                    title: "今日到期",
                    value: "\(plan.due.count)",
                    unit: "张",
                    icon: "clock.badge.exclamationmark.fill",
                    tint: plan.due.count > 0 ? EditorialColor.aiAmber : EditorialColor.likeGreen
                )
                ebbinghausMetric(
                    title: "今日已复习",
                    value: "\(plan.completedToday)",
                    unit: "张",
                    icon: "checkmark.seal.fill",
                    tint: EditorialColor.likeGreen
                )
                ebbinghausMetric(
                    title: "记忆留存率",
                    value: "\(plan.masteryDistribution.retentionRate)",
                    unit: "%",
                    icon: "chart.line.uptrend.xyaxis",
                    tint: EditorialColor.detailBlue
                )
            }
        }
    }

    private func ebbinghausMetric(title: String, value: String, unit: String, icon: String, tint: Color) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 36, height: 36)
                .background(tint.opacity(0.12), in: Circle())
                .overlay(Circle().strokeBorder(tint.opacity(0.25), lineWidth: 1))

            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .lastTextBaseline, spacing: 3) {
                    Text(value)
                        .font(EditorialFont.statFigure)
                        .foregroundStyle(EditorialColor.textPrimary)
                    Text(unit)
                        .font(EditorialFont.caption)
                        .foregroundStyle(EditorialColor.textSecondary)
                }
                Text(title)
                    .font(EditorialFont.caption)
                    .foregroundStyle(EditorialColor.textTertiary)
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .editorialGlassCard(cornerRadius: EditorialRadius.container)
    }

    // MARK: - 知识掌握度分布（三段堆叠胶囊条）

    private var masterySection: some View {
        let dist = plan.masteryDistribution
        let total = max(dist.totalCards, 1)
        let masteredWidth = CGFloat(dist.masteredCount) / CGFloat(total)
        let hesitantWidth = CGFloat(dist.hesitantCount) / CGFloat(total)
        let needsWidth = CGFloat(dist.needsReviewCount) / CGFloat(total)

        return VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("知识掌握度分布")
                    .font(EditorialFont.sectionTitle)
                    .foregroundStyle(EditorialColor.textPrimary)
                Spacer()
                Text("累计复习 \(dist.totalReviews) 人次")
                    .font(EditorialFont.captionSmall)
                    .foregroundStyle(EditorialColor.textMuted)
            }

            VStack(alignment: .leading, spacing: 14) {
                // 三段堆叠胶囊条
                GeometryReader { geo in
                    HStack(spacing: 3) {
                        if dist.masteredCount > 0 {
                            RoundedRectangle(cornerRadius: 4)
                                .fill(EditorialColor.likeGreen)
                                .frame(width: max(8, geo.size.width * masteredWidth - 2))
                        }
                        if dist.hesitantCount > 0 {
                            RoundedRectangle(cornerRadius: 4)
                                .fill(EditorialColor.aiAmber)
                                .frame(width: max(8, geo.size.width * hesitantWidth - 2))
                        }
                        if dist.needsReviewCount > 0 {
                            RoundedRectangle(cornerRadius: 4)
                                .fill(EditorialColor.glassBorder)
                                .frame(width: max(8, geo.size.width * needsWidth - 2))
                        }
                    }
                }
                .frame(height: 12)
                .padding(.vertical, 4)

                // 图例说明
                HStack(spacing: 24) {
                    masteryLegendItem(
                        title: "熟练掌握 (7天)",
                        count: dist.masteredCount,
                        percent: Int((Double(dist.masteredCount) / Double(total) * 100).rounded()),
                        color: EditorialColor.likeGreen
                    )
                    masteryLegendItem(
                        title: "学习中 (3天)",
                        count: dist.hesitantCount,
                        percent: Int((Double(dist.hesitantCount) / Double(total) * 100).rounded()),
                        color: EditorialColor.aiAmber
                    )
                    masteryLegendItem(
                        title: "需强化 (1天)",
                        count: dist.needsReviewCount,
                        percent: Int((Double(dist.needsReviewCount) / Double(total) * 100).rounded()),
                        color: EditorialColor.textMuted
                    )
                }
            }
            .padding(18)
            .editorialGlassCard(cornerRadius: EditorialRadius.container)
        }
    }

    private func masteryLegendItem(title: String, count: Int, percent: Int, color: Color) -> some View {
        HStack(spacing: 8) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(EditorialFont.captionSmall)
                    .foregroundStyle(EditorialColor.textTertiary)
                Text("\(count) 张 (\(percent)%)")
                    .font(EditorialFont.caption.weight(.semibold))
                    .foregroundStyle(EditorialColor.textPrimary)
            }
        }
    }

    // MARK: - 未来 7 天到期预测时间线

    private var upcomingScheduleSection: some View {
        let schedule = plan.upcomingSchedule(days: 7)
        let maxCount = max(schedule.map(\.count).max() ?? 1, 1)

        return VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("未来 7 天到期预测")
                    .font(EditorialFont.sectionTitle)
                    .foregroundStyle(EditorialColor.textPrimary)
                Spacer()
                Text("基于间隔复习排程推演")
                    .font(EditorialFont.captionSmall)
                    .foregroundStyle(EditorialColor.textMuted)
            }

            HStack(alignment: .bottom, spacing: 14) {
                ForEach(schedule) { item in
                    VStack(spacing: 8) {
                        Text("\(item.count)")
                            .font(EditorialFont.captionSmall)
                            .foregroundStyle(item.count > 0 ? (item.isToday ? EditorialColor.aiAmber : EditorialColor.textPrimary) : EditorialColor.textMuted)

                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .fill(
                                item.isToday
                                ? LinearGradient(colors: [EditorialColor.aiAmber, EditorialColor.aiAmber.opacity(0.65)], startPoint: .top, endPoint: .bottom)
                                : (item.count > 0
                                   ? LinearGradient(colors: [EditorialColor.detailBlue, EditorialColor.detailBlue.opacity(0.65)], startPoint: .top, endPoint: .bottom)
                                   : LinearGradient(colors: [EditorialColor.glassSurface, EditorialColor.glassSurface], startPoint: .top, endPoint: .bottom))
                            )
                            .frame(height: max(6, CGFloat(item.count) / CGFloat(maxCount) * 72))
                            .overlay(
                                RoundedRectangle(cornerRadius: 5, style: .continuous)
                                    .strokeBorder(item.isToday ? EditorialColor.aiAmber.opacity(0.4) : (item.count > 0 ? EditorialColor.detailBlue.opacity(0.4) : Color.clear), lineWidth: 1)
                            )
                            .shadow(color: item.isToday ? EditorialColor.aiAmber.opacity(0.3) : Color.clear, radius: 6, y: 2)

                        Text(dayLabel(item.date))
                            .font(EditorialFont.caption)
                            .foregroundStyle(item.isToday ? EditorialColor.aiAmber : EditorialColor.textTertiary)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .padding(20)
            .editorialGlassCard(cornerRadius: EditorialRadius.container)
        }
    }

    // MARK: - 35 天学习活跃打卡热力图

    private var activityHeatmapSection: some View {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        // 35 天 = 5 周 x 7 天
        let days = (0..<35).reversed().compactMap { offset -> (date: Date, count: Int)? in
            guard let date = calendar.date(byAdding: .day, value: -offset, to: today) else { return nil }
            let count = store.cards.filter { card in
                let seenMatch = card.seenAt.map { calendar.isDate($0, inSameDayAs: date) } ?? false
                let reviewMatch = card.lastReviewedAt.map { calendar.isDate($0, inSameDayAs: date) } ?? false
                return seenMatch || reviewMatch
            }.count
            return (date: date, count: count)
        }

        return VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("35 天研习活跃热力图")
                    .font(EditorialFont.sectionTitle)
                    .foregroundStyle(EditorialColor.textPrimary)
                Spacer()
                Text("近 5 周每日研习与复习足迹")
                    .font(EditorialFont.captionSmall)
                    .foregroundStyle(EditorialColor.textMuted)
            }

            VStack(alignment: .leading, spacing: 12) {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 7), spacing: 6) {
                    ForEach(days, id: \.date) { item in
                        let color: Color = {
                            if item.count == 0 { return EditorialColor.glassSurface }
                            if item.count <= 2 { return EditorialColor.likeGreen.opacity(0.35) }
                            if item.count <= 5 { return EditorialColor.likeGreen.opacity(0.65) }
                            return EditorialColor.likeGreen
                        }()

                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(color)
                            .aspectRatio(1, contentMode: .fit)
                            .overlay(
                                RoundedRectangle(cornerRadius: 4, style: .continuous)
                                    .strokeBorder(item.count > 0 ? Color.white.opacity(0.12) : EditorialColor.glassBorder, lineWidth: 0.8)
                            )
                            .help("\(Self.dateShortFormatter.string(from: item.date)): 研习 \(item.count) 张")
                    }
                }

                HStack {
                    Spacer()
                    Text("少")
                        .font(EditorialFont.captionSmall)
                        .foregroundStyle(EditorialColor.textMuted)
                    HStack(spacing: 4) {
                        RoundedRectangle(cornerRadius: 2).fill(EditorialColor.glassSurface).frame(width: 10, height: 10)
                        RoundedRectangle(cornerRadius: 2).fill(EditorialColor.likeGreen.opacity(0.35)).frame(width: 10, height: 10)
                        RoundedRectangle(cornerRadius: 2).fill(EditorialColor.likeGreen.opacity(0.65)).frame(width: 10, height: 10)
                        RoundedRectangle(cornerRadius: 2).fill(EditorialColor.likeGreen).frame(width: 10, height: 10)
                    }
                    Text("多")
                        .font(EditorialFont.captionSmall)
                        .foregroundStyle(EditorialColor.textMuted)
                }
                .padding(.top, 4)
            }
            .padding(18)
            .editorialGlassCard(cornerRadius: EditorialRadius.container)
        }
    }

    // MARK: - 近 7 天趋势

    private var trendSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("近 7 天学习趋势")
                .font(EditorialFont.sectionTitle)
                .foregroundStyle(EditorialColor.textPrimary)

            let daily = StatsCalculator.dailyCounts(cards: store.cards)
            let maxCount = max(daily.map(\.count).max() ?? 1, 1)
            HStack(alignment: .bottom, spacing: 14) {
                ForEach(daily) { item in
                    VStack(spacing: 8) {
                        Text("\(item.count)")
                            .font(EditorialFont.captionSmall)
                            .foregroundStyle(item.count > 0 ? EditorialColor.textPrimary : EditorialColor.textMuted)
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .fill(
                                item.count > 0
                                ? LinearGradient(colors: [EditorialColor.likeGreen, EditorialColor.likeGreen.opacity(0.65)], startPoint: .top, endPoint: .bottom)
                                : LinearGradient(colors: [EditorialColor.glassSurface, EditorialColor.glassSurface], startPoint: .top, endPoint: .bottom)
                            )
                            .frame(height: max(6, CGFloat(item.count) / CGFloat(maxCount) * 72))
                            .overlay(
                                RoundedRectangle(cornerRadius: 5, style: .continuous)
                                    .strokeBorder(item.count > 0 ? EditorialColor.likeGreen.opacity(0.4) : Color.clear, lineWidth: 1)
                            )
                            .shadow(color: item.count > 0 ? EditorialColor.likeGreen.opacity(0.3) : Color.clear, radius: 6, y: 2)
                        Text(dayLabel(item.day))
                            .font(EditorialFont.caption)
                            .foregroundStyle(EditorialColor.textTertiary)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .padding(20)
            .editorialGlassCard(cornerRadius: EditorialRadius.container)
        }
    }

    private func dayLabel(_ day: Date) -> String {
        if Calendar.current.isDateInToday(day) { return "今天" }
        return Self.weekdayFormatter.string(from: day)
    }

    private static let weekdayFormatter: DateFormatter = {
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "zh_CN")
        fmt.dateFormat = "E"
        return fmt
    }()

    private static let dateShortFormatter: DateFormatter = {
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "zh_CN")
        fmt.dateFormat = "M月d日"
        return fmt
    }()

    // MARK: - 分类统计

    private var categorySection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("分类浏览与感兴趣分布")
                    .font(EditorialFont.sectionTitle)
                    .foregroundStyle(EditorialColor.textPrimary)
                Spacer()
                Text("点击分类行可查看对应历史")
                    .font(EditorialFont.captionSmall)
                    .foregroundStyle(EditorialColor.textMuted)
            }

            let maxSeen = max(stats.categories.first?.seen ?? 1, 1)
            VStack(spacing: 10) {
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
            historyCategory = CategoryNav(category: stat.category)
        } label: {
            HStack(spacing: 14) {
                Text(stat.category)
                    .font(EditorialFont.label)
                    .foregroundStyle(EditorialColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(minWidth: 90, maxWidth: 150, alignment: .leading)

                GeometryReader { geo in
                    let barWidth = geo.size.width * CGFloat(stat.seen) / CGFloat(maxSeen)
                    ZStack(alignment: .leading) {
                        Capsule().fill(EditorialColor.glassSurface)
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
                    .font(EditorialFont.caption)
                    .foregroundStyle(EditorialColor.textSecondary)
                    .frame(width: 140, alignment: .trailing)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .editorialGlassCard(cornerRadius: EditorialRadius.control)
        }
        .buttonStyle(PressableButtonStyle(scale: 0.985))
    }
}

/// sheet(item:) 用的跳转载荷：点分类 → 带筛选打开历史页
private struct CategoryNav: Identifiable {
    let id = UUID()
    let category: String
}
