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
            LinearGradient(
                colors: [Color(red: 0.085, green: 0.095, blue: 0.12), Color(red: 0.045, green: 0.05, blue: 0.065)],
                startPoint: .top, endPoint: .bottom
            )
            .ignoresSafeArea()
            NoiseOverlay().ignoresSafeArea()

            VStack(spacing: 0) {
                header
                Divider().overlay(Color.white.opacity(0.08))

                if stats.seenCount == 0 {
                    Spacer()
                    VStack(spacing: 12) {
                        Image(systemName: "chart.bar")
                            .font(.system(size: 38))
                            .foregroundStyle(.white.opacity(0.3))
                        Text("刷过卡片后，这里会出现你的学习统计")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(.white.opacity(0.5))
                    }
                    Spacer()
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 26) {
                            overview
                            categorySection
                        }
                        .padding(22)
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
        .frame(minWidth: 660, minHeight: 520)
        .sheet(item: $historyCategory) { nav in
            HistoryView(store: store, categoryFilter: nav.category) {
                historyCategory = nil
            }
        }
    }

    private var header: some View {
        HStack {
            Text("学习统计")
                .font(.custom("Songti SC Black", size: 20))
                .foregroundStyle(Color(red: 0.96, green: 0.95, blue: 0.92))
            Spacer()
            Button(action: onClose) {
                Text("完成")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.75))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 7)
                    .background(Color.white.opacity(0.08), in: Capsule())
                    .overlay(Capsule().strokeBorder(Color.white.opacity(0.1), lineWidth: 1))
            }
            .buttonStyle(PressableButtonStyle())
            .keyboardShortcut(.escape, modifiers: [])
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 18)
    }

    // MARK: - 总览

    private var overview: some View {
        HStack(spacing: 12) {
            statBlock(
                value: "\(stats.seenCount)",
                caption: "已刷卡片",
                icon: "square.stack.3d.up.fill",
                tint: .white
            )
            statBlock(
                value: "\(stats.likedCount) · \(Int((stats.likeRate * 100).rounded()))%",
                caption: "感兴趣（率）",
                icon: "heart.fill",
                tint: Color(red: 0.45, green: 0.80, blue: 0.55)
            )
            statBlock(
                value: "\(stats.streakDays) 天",
                caption: "连续学习",
                icon: "flame.fill",
                tint: Color(red: 0.95, green: 0.72, blue: 0.42)
            )
        }
    }

    private func statBlock(value: String, caption: String, icon: String, tint: Color) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(tint.opacity(0.9))
                .frame(width: 40, height: 40)
                .background(tint.opacity(0.12), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(value)
                    .font(.custom("Songti SC Black", size: 21))
                    .foregroundStyle(Color(red: 0.96, green: 0.95, blue: 0.92))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text(caption)
                    .font(.system(size: 11.5, weight: .medium))
                    .foregroundStyle(.white.opacity(0.45))
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .strokeBorder(Color.white.opacity(0.06), lineWidth: 1)
        )
    }

    // MARK: - 分类统计

    private var categorySection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("分类统计")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white.opacity(0.55))

            let maxSeen = max(stats.categories.first?.seen ?? 1, 1)
            VStack(spacing: 8) {
                ForEach(stats.categories) { stat in
                    categoryRow(stat, maxSeen: maxSeen)
                }
            }

            Text("点击分类行可查看该分类的历史记录")
                .font(.system(size: 11))
                .foregroundStyle(.white.opacity(0.32))
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
                    .font(.system(size: 13.5, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.88))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(width: 84, alignment: .leading)

                GeometryReader { geo in
                    let barWidth = geo.size.width * CGFloat(stat.seen) / CGFloat(maxSeen)
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.07))
                        Capsule().fill(accent)
                            .frame(width: barWidth)
                        if stat.seen > 0 && stat.liked > 0 {
                            Capsule().fill(Color.white.opacity(0.5))
                                .frame(width: barWidth * CGFloat(stat.liked) / CGFloat(stat.seen))
                        }
                    }
                }
                .frame(height: 10)

                Text("\(stat.seen) 张 · \(Int((stat.likeRate * 100).rounded()))% 感兴趣")
                    .font(.system(size: 11.5, weight: .medium))
                    .foregroundStyle(.white.opacity(0.5))
                    .frame(width: 132, alignment: .trailing)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(PressableButtonStyle(scale: 0.985))
    }
}

/// sheet(item:) 用的跳转载荷：点分类 → 带筛选打开历史页
private struct CategoryNav: Identifiable {
    let id = UUID()
    let category: String
}
