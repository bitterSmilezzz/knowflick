import SwiftUI
import AppKit
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
        case .review: return "arrow.triangle.2.circlepath"
        case .library: return "square.grid.2x2"
        case .favorites: return "heart"
        case .stats: return "chart.bar"
        case .history: return "clock"
        case .graph: return "point.3.connected.trianglepath.dotted"
        case .quiz: return "graduationcap.fill"
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

    /// 计数来源：返回 nil 不显示计数。
    /// 实际数值由 `InsightShell` 按卡库变化一次性缓存到 `badgeCounts`——
    /// 这里不再按行重建 LearningPlan（O(n) 且带日历运算），否则侧栏每次
    /// 重绘（含展开/折叠动画的每一帧）都会全量重算，导航点击就会卡顿。
    @MainActor
    static func count(for destination: InsightDestination, badgeCounts: [InsightDestination: Int]) -> Int? {
        badgeCounts[destination]
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

    @State private var availableWidth: CGFloat = .infinity
    @State private var brandHovered = false
    private var isSidebarExpanded: Bool { sidebarExpanded && availableWidth >= 1040 }

    /// 系统减弱动态效果：侧栏整壳移动属 large motion，塌为直出（ui-research 共识 5 的分层判据）
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// 侧栏开合的动画档：正常时展开长弹簧 / 折叠短弹簧，reduce-motion 下不加动画
    private var shellTiming: Animation? {
        reduceMotion ? nil : (isSidebarExpanded ? InsightMotion.shellOpen : InsightMotion.shellClose)
    }

    /// 侧栏计数徽章缓存：仅在卡库或学习范围变化时重算一次，
    /// 而不是每行每次渲染都重建 LearningPlan（侧栏动画逐帧重绘时的主要卡顿源）
    @State private var badgeCounts: [InsightDestination: Int] = [:]

    var body: some View {
        GeometryReader { geometry in
            HStack(spacing: 0) {
                sidebar
                    .frame(width: isSidebarExpanded ? InsightLayout.sidebarExpanded : InsightLayout.sidebarCollapsed)
                    // 展开走长弹簧、折叠走短弹簧：动画参数按「这扇门往哪开」取档（ui-research 共识 27）
                    .animation(shellTiming, value: isSidebarExpanded)

                // 内容区：与侧栏之间留出画布色缝隙，形成 Cutline 的结构分区
                content
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(InsightColor.canvas)
                    .clipShape(RoundedRectangle(cornerRadius: InsightRadius.sidebar, style: .continuous))
                    .padding(.trailing, 8)
                    .padding(.vertical, 8)
                    .animation(shellTiming, value: isSidebarExpanded)
            }
            .onAppear { availableWidth = geometry.size.width }
            .onChange(of: geometry.size.width) { _, width in availableWidth = width }
        }
        .sidebarHoverTipLayer()
        .background(InsightColor.sidebar)
        .onAppear(perform: refreshBadgeCounts)
        .onLearningDayChange(perform: refreshBadgeCounts)
        .onChange(of: store.deck.count) { _, _ in refreshBadgeCounts() }
        .onChange(of: store.cards) { _, _ in refreshBadgeCounts() }
        .onChange(of: store.studyScope) { _, _ in refreshBadgeCounts() }
    }

    /// 一次性重算全部侧栏计数（单次 LearningPlan 构造，服务所有行）
    private func refreshBadgeCounts() {
        let plan = LearningPlan(cards: store.cards)
        var counts: [InsightDestination: Int] = [:]
        counts[.swipe] = store.deck.count
        counts[.today] = plan.completedToday
        counts[.map] = store.studyScope.isActive ? StudyMap.remaining(store.cards, scope: store.studyScope) : nil
        counts[.review] = plan.due.count
        counts[.library] = store.cards.count
        counts[.favorites] = store.favorites.count
        counts[.history] = store.history.count
        badgeCounts = counts
    }

    // MARK: 侧栏

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: InsightSpacing.large) {
            // 品牌头 + 折叠开关
            HStack(spacing: InsightSpacing.compact) {
                if isSidebarExpanded {
                    brandMark.accessibilityHidden(true)
                } else {
                    collapsedBrandButton
                }
                if isSidebarExpanded {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("KnowFlick")
                            .font(InsightFont.bodyStrong)
                            .foregroundStyle(InsightColor.textPrimary)
                        Text("知识卡片")
                            .font(InsightFont.captionSmall)
                            .foregroundStyle(InsightColor.textMuted)
                    }
                    .transition(.opacity)
                }
                Spacer(minLength: 0)
                if isSidebarExpanded {
                    InsightIconButton(
                        icon: "sidebar.left",
                        help: "折叠侧栏",
                        action: onToggleSidebar
                    )
                    .transition(.opacity)
                }
            }
            .frame(height: 40)
            .padding(.leading, isSidebarExpanded ? 14 : 16)
            .padding(.trailing, isSidebarExpanded ? 10 : 0)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: InsightSpacing.large) {
                    // 搜索入口（Cutline 侧栏顶部固定搜索框）
                    sidebarSearchButton

                    // 主导航
                    navGroup(items: InsightDestination.allCases.filter { !$0.isUtility }, label: "学习")

                    // 工具导航
                    navGroup(items: InsightDestination.allCases.filter { $0.isUtility }, label: "资料与工具")

                    if isSidebarExpanded {
                        VStack(alignment: .leading, spacing: InsightSpacing.compact) {
                            InsightSectionLabel(text: "采集")
                                .padding(.leading, 10)
                            InsightSidebarRow(icon: "square.and.arrow.down", title: "导入笔记", isExpanded: true, helpText: "导入笔记\n将 Markdown、文本或资料整理成知识卡片") {
                                onOpenSheet(.importNotes)
                            }
                            InsightSidebarRow(icon: "link", title: "网页剪藏", isExpanded: true, helpText: "网页剪藏\n输入网页链接，将文章内容保存为知识卡片") {
                                onOpenSheet(.webClip)
                            }
                        }
                        .transition(.opacity)
                    }
                }
                .padding(.horizontal, isSidebarExpanded ? 10 : 12)
            }

            Spacer(minLength: 0)

            // 底部工具行：设置/帮助（仍在侧栏内，不占内容区）
            VStack(spacing: InsightSpacing.tiny) {
                InsightSidebarRow(
                    icon: "gearshape",
                    title: "偏好设置",
                    isSelected: false,
                    isExpanded: isSidebarExpanded,
                    helpText: "偏好设置\n调整外观、内容来源、AI 服务与朗读选项"
                ) { onOpenSheet(.settings) }
                InsightSidebarRow(
                    icon: "keyboard",
                    title: "快捷键帮助",
                    isSelected: false,
                    isExpanded: isSidebarExpanded,
                    helpText: "快捷键帮助\n查看导航、刷卡、搜索与朗读的键盘操作"
                ) { onOpenSheet(.help) }
            }
            .padding(.horizontal, isSidebarExpanded ? 10 : 12)
            .padding(.bottom, 14)
        }
        .padding(.top, 14)
        // 折叠/展开的统一动画上下文：宽度之外，品牌文字/按钮/采集组的内边距与行淡出
        // 全部被同一条弹簧覆盖（ui-research 共识 4：卡顿感来自没被动画覆盖的属性）
        .animation(shellTiming, value: isSidebarExpanded)
    }

    // 品牌标：直接用真实 App 图标（icns），与 Dock / 访达一致，不另造符号
    private var brandMark: some View {
        Group {
            if let icon = NSApp?.applicationIconImage, icon.size.width > 1 {
                Image(nsImage: icon)
                    .resizable()
                    .interpolation(.high)
                    .frame(width: 30, height: 30)
                    .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
            } else {
                Text("K")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(InsightColor.accent, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
        }
    }

    /// One control, two appearances: the logo at rest and an expand icon under the pointer.
    private var collapsedBrandButton: some View {
        Button(action: onToggleSidebar) {
            ZStack {
                brandMark.opacity(brandHovered ? 0 : 1)
                Image(systemName: "sidebar.left")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(InsightColor.textPrimary)
                    .opacity(brandHovered ? 1 : 0)
            }
            .frame(width: 40, height: 40)
            .background(brandHovered ? InsightColor.neutralSoft : .clear,
                        in: RoundedRectangle(cornerRadius: InsightRadius.control))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { brandHovered = $0 }
        .onDisappear { brandHovered = false }
        .disabled(availableWidth < 1040)
        .sidebarHoverTip(availableWidth < 1040
              ? "展开侧栏\n加宽窗口后可显示导航名称与计数"
              : "展开侧栏\n显示导航名称、卡片计数与采集工具", enabled: true)
        .accessibilityLabel("展开侧栏")
    }

    private var sidebarSearchButton: some View {
        Button { onOpenSheet(.search) } label: {
            HStack(spacing: InsightSpacing.compact) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 13, weight: .medium))
                    .frame(width: 20)
                if isSidebarExpanded {
                    Text("搜索")
                        .font(InsightFont.body)
                    Spacer(minLength: 0)
                    Text("⌘F")
                        .font(InsightFont.monoSmall)
                        .foregroundStyle(InsightColor.textMuted)
                }
            }
            .foregroundStyle(InsightColor.textTertiary)
            .padding(.horizontal, isSidebarExpanded ? 10 : 0)
            .padding(.vertical, 7)
            .frame(maxWidth: .infinity, alignment: isSidebarExpanded ? .leading : .center)
            .background(InsightColor.surfaceSunken, in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
                    .strokeBorder(InsightColor.border, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(isSidebarExpanded ? "搜索知识 · ⌘F\n按标题、正文或拼音查找卡片，可筛选主题、来源与收藏" : "")
        .sidebarHoverTip("搜索知识 · ⌘F\n按标题、正文或拼音查找卡片，可筛选主题、来源与收藏", enabled: !isSidebarExpanded)
        .accessibilityLabel("搜索知识")
    }

    private func navGroup(items: [InsightDestination], label: String) -> some View {
        VStack(alignment: .leading, spacing: InsightSpacing.tiny) {
            if isSidebarExpanded {
                InsightSectionLabel(text: label)
                    .padding(.leading, 10)
                    .padding(.bottom, 2)
            }
            ForEach(items) { item in
                InsightSidebarRow(
                    icon: item.icon,
                    title: item.rawValue,
                    count: InsightDestination.count(for: item, badgeCounts: badgeCounts),
                    isSelected: selection == item,
                    isExpanded: isSidebarExpanded,
                    helpText: navigationHelp(for: item)
                ) {
                    selection = item
                }
            }
        }
    }
    private func navigationHelp(for destination: InsightDestination) -> String {
        let count = badgeCounts[destination] ?? 0
        let detail: String
        switch destination {
        case .today: detail = "查看今日目标、下一张阅读与复习安排\n今日已完成 \(count) 张"
        case .swipe: detail = "逐张浏览知识，记录兴趣并收藏\n还有 \(count) 张可阅读"
        case .map: detail = "按主题选择学习范围，查看各主题的阅读与掌握进度"
        case .review: detail = "先回忆，再揭晓答案；每轮最多 10 张\n当前有 \(count) 张到期"
        case .library: detail = "浏览全部卡片，按主题、来源与学习状态筛选\n卡库共 \(count) 张"
        case .favorites: detail = "重读已收藏的知识，或导出为笔记与闪卡\n已收藏 \(count) 张"
        case .stats: detail = "查看阅读记录、知识掌握度与未来复习安排"
        case .history: detail = "回看浏览过的卡片，按兴趣与主题筛选\n已有 \(count) 张浏览记录"
        case .graph: detail = "从知识星图中查看主题与卡片的关联"
        case .quiz: detail = "进行自由测验，检验回忆并记录掌握程度"
        case .console: detail = "朗读知识卡片，控制语速与连续播放"
        }
        return "\(destination.rawValue)\n\(detail)"
    }

}
