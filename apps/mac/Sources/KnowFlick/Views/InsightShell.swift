import SwiftUI
import KnowFlickCore

// MARK: - Cutline 式应用外壳（侧栏 + 内容区）
//
// 素材依据：`.scratch/ui-material/05_HTCuOh3aoAA4Qv0.png`（Cutline）
//   · 圆角浮动侧栏 20pt，与主内容区之间有可见的结构分区
//   · 侧栏内：品牌头 → 工作区卡 → 主导航 → 分区导航 → 工具导航
//   · 每行右侧带计数（mono 小字）
//   · 选中项为实心浅底圆角块 + 1pt 描边
//
// 本文件只做「外壳」：导航项声明 + 侧栏渲染 + 内容区切换。
// 各视图本体仍由 InsightMainView / LearningWorkspaceView 等承担。

/// 侧栏导航项。`destination` 决定点选后内容区显示什么。
enum InsightDestination: String, CaseIterable, Identifiable {
    case today      = "今日"
    case swipe      = "刷卡"
    case map        = "学习地图"
    case review     = "复习"
    case library    = "知识库"
    case favorites  = "收藏"
    case stats      = "统计"
    case history    = "历史"
    case graph      = "星图"
    case quiz       = "测验"
    case console    = "听书"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .swipe: return "rectangle.stack"
        case .today: return "sun.max"
        case .map: return "map"
        case .review: return "clock.arrow.circlepath"
        case .library: return "square.grid.2x2"
        case .favorites: return "heart"
        case .stats: return "chart.bar"
        case .history: return "clock"
        case .graph: return "point.3.connected.trianglepath.dotted"
        case .quiz: return "questionmark.circle"
        case .console: return "headphones"
        }
    }

    /// 分区：false = 主导航，true = 工具区（渲染时分组）
    var isUtility: Bool {
        switch self {
        case .swipe, .today, .map, .review, .library: return false
        case .favorites, .stats, .history, .graph, .quiz, .console: return true
        }
    }

    /// 计数来源：返回 nil 不显示计数
    @MainActor
    static func count(for destination: InsightDestination, store: AppStore) -> Int? {
        switch destination {
        case .swipe: return store.deck.count
        case .today: return LearningPlan(cards: store.cards).completedToday
        case .map: return store.studyScope.isActive ? StudyMap.remaining(store.cards, scope: store.studyScope) : nil
        case .review: return LearningPlan(cards: store.cards).due.count
        case .library: return store.cards.count
        case .favorites: return store.favorites.count
        case .stats: return nil
        case .history: return store.history.count
        default: return nil
        }
    }
}

/// 侧栏外壳容器：侧栏 + 内容区。
///
/// 内容区由调用方通过 `content` 提供，侧栏只负责导航选择。
/// 这样 InsightMainView 可以既当侧栏容器又当刷卡视图（「侧栏+刷卡合一」）。
struct InsightShell<Content: View>: View {
    @Bindable var store: AppStore
    @Binding var selection: InsightDestination
    var sidebarExpanded: Bool
    var onToggleSidebar: () -> Void
    /// 打开模态面板（沿用 AppStore 的 ActiveSheet 路由）
    var onOpenSheet: (ActiveSheet) -> Void
    /// 打开二级视图（搜索/导入/剪藏等也是 sheet，统一走 onOpenSheet）
    @ViewBuilder var content: Content

    @State private var hoveringSidebarToggle = false

    var body: some View {
        HStack(spacing: 0) {
            sidebar
                .frame(width: sidebarExpanded ? InsightLayout.sidebarExpanded : InsightLayout.sidebarCollapsed)
                .animation(InsightMotion.shell, value: sidebarExpanded)

            // 内容区：与侧栏之间留出画布色缝隙，形成 Cutline 的结构分区
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(InsightColor.canvas)
                .clipShape(RoundedRectangle(cornerRadius: InsightRadius.sidebar, style: .continuous))
                .padding(.trailing, 8)
                .padding(.vertical, 8)
                .animation(InsightMotion.shell, value: sidebarExpanded)
        }
        .background(InsightColor.sidebar)
    }

    // MARK: 侧栏

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: InsightSpacing.large) {
            // 品牌头 + 折叠开关
            HStack(spacing: InsightSpacing.compact) {
                Image(systemName: "sparkles")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(InsightColor.accent, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                if sidebarExpanded {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("KnowFlick")
                            .font(InsightFont.bodyStrong)
                            .foregroundStyle(InsightColor.textPrimary)
                        Text("知识卡片")
                            .font(InsightFont.captionSmall)
                            .foregroundStyle(InsightColor.textMuted)
                    }
                }
                Spacer(minLength: 0)
                if sidebarExpanded {
                    InsightIconButton(
                        icon: "sidebar.left",
                        help: "折叠侧栏",
                        action: onToggleSidebar
                    )
                }
            }
            .padding(.leading, sidebarExpanded ? 14 : 0)
            .padding(.trailing, sidebarExpanded ? 10 : 0)

            if !sidebarExpanded {
                InsightIconButton(icon: "sidebar.left", help: "展开侧栏", action: onToggleSidebar)
                    .padding(.leading, 21)
            }

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: InsightSpacing.large) {
                    // 搜索入口（Cutline 侧栏顶部固定搜索框）
                    sidebarSearchButton

                    // 主导航
                    navGroup(items: InsightDestination.allCases.filter { !$0.isUtility }, label: "学习")

                    // 工具导航
                    navGroup(items: InsightDestination.allCases.filter { $0.isUtility }, label: "资料与工具")

                    if sidebarExpanded {
                        VStack(alignment: .leading, spacing: InsightSpacing.compact) {
                            InsightSectionLabel(text: "采集")
                                .padding(.leading, 10)
                            InsightSidebarRow(icon: "square.and.arrow.down", title: "导入笔记", isExpanded: true) {
                                onOpenSheet(.importNotes)
                            }
                            InsightSidebarRow(icon: "link", title: "网页剪藏", isExpanded: true) {
                                onOpenSheet(.webClip)
                            }
                        }
                    }
                }
                .padding(.horizontal, sidebarExpanded ? 10 : 12)
            }

            Spacer(minLength: 0)

            // 底部工具行：设置/帮助（仍在侧栏内，不占内容区）
            VStack(spacing: InsightSpacing.tiny) {
                InsightSidebarRow(
                    icon: "gearshape",
                    title: "偏好设置",
                    isSelected: false,
                    isExpanded: sidebarExpanded
                ) { onOpenSheet(.settings) }
                InsightSidebarRow(
                    icon: "questionmark.circle",
                    title: "快捷键帮助",
                    isSelected: false,
                    isExpanded: sidebarExpanded
                ) { onOpenSheet(.help) }
            }
            .padding(.horizontal, sidebarExpanded ? 10 : 12)
            .padding(.bottom, 14)
        }
        .padding(.top, 14)
    }

    private var sidebarSearchButton: some View {
        Button { onOpenSheet(.search) } label: {
            HStack(spacing: InsightSpacing.compact) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 13, weight: .medium))
                    .frame(width: 20)
                if sidebarExpanded {
                    Text("搜索")
                        .font(InsightFont.body)
                    Spacer(minLength: 0)
                    Text("⌘F")
                        .font(InsightFont.monoSmall)
                        .foregroundStyle(InsightColor.textMuted)
                }
            }
            .foregroundStyle(InsightColor.textTertiary)
            .padding(.horizontal, sidebarExpanded ? 10 : 0)
            .padding(.vertical, 7)
            .frame(maxWidth: .infinity, alignment: sidebarExpanded ? .leading : .center)
            .background(InsightColor.surfaceSunken, in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
                    .strokeBorder(InsightColor.border, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func navGroup(items: [InsightDestination], label: String) -> some View {
        VStack(alignment: .leading, spacing: InsightSpacing.tiny) {
            if sidebarExpanded {
                InsightSectionLabel(text: label)
                    .padding(.leading, 10)
                    .padding(.bottom, 2)
            }
            ForEach(items) { item in
                InsightSidebarRow(
                    icon: item.icon,
                    title: item.rawValue,
                    count: InsightDestination.count(for: item, store: store),
                    isSelected: selection == item,
                    isExpanded: sidebarExpanded
                ) {
                    withAnimation(InsightMotion.shell) { selection = item }
                }
            }
        }
    }
}
