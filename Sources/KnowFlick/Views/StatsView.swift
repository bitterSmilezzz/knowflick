import SwiftUI
import KnowFlickCore

/// 学习统计：总览（已刷/感兴趣/连续天数）+ 分类条形图，数据全部从 store.cards 派生
struct StatsView: View {
    let store: AppStore
    let onClose: () -> Void

    @State private var historyCategory: CategoryNav?

    // MARK: - 派生数据（纯计算在 StatsCalculator，这里只做格式化）

    private var stats: LearningStats {
        StatsCalculator.compute(from: store.cards)
    }

    // MARK: - 视图

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
                        Text("刷过卡片后，这里会出现你的学习统计")
                            .font(EditorialFont.bodySerif)
                            .foregroundStyle(EditorialColor.textTertiary)
                    }
                    Spacer()
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 28) {
                            overview
                            trendSection
                            categorySection
                        }
                        .padding(24)
                    }
                }
            }
        }
        .frame(minWidth: 680, minHeight: 540)
        .sheet(item: $historyCategory) { nav in
            HistoryView(store: store, showAIMark: store.settings.showAIMark, categoryFilter: nav.category) {
                historyCategory = nil
            }
        }
    }

    private var header: some View {
        HStack {
            HStack(spacing: 10) {
                Image(systemName: "chart.bar.fill")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(EditorialColor.likeGreen)
                Text("学习统计")
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

    // MARK: - 总览（大字号专栏指标）

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
        }
    }

    private func statBlock(value: String, caption: String, icon: String, tint: Color) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 42, height: 42)
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
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .editorialGlassCard(cornerRadius: EditorialRadius.container)
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
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "zh_CN")
        fmt.dateFormat = "E"
        return fmt.string(from: day)
    }

    // MARK: - 分类统计

    private var categorySection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("分类知识掌握度")
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
        let accent = CategoryTheme.theme(for: stat.category, cache: .shared).accent
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
