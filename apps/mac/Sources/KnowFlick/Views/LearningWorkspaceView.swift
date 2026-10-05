import SwiftUI
import KnowFlickCore

/// 学习工作台内容区（今日 / 复习 / 知识库）。
/// 在 InsightShell 体系下由 `InsightMainView` 携 `destination` 调用，导航由外壳承担；
/// 旧独立模式（自带侧栏与页头）已随 CardDeckView 一并归档淘汰。
struct LearningWorkspaceView: View {
    @Bindable var store: AppStore
    let open: (ActiveSheet) -> Void
    let explore: () -> Void
    var destination: InsightDestination? = nil
    var navigate: ((InsightDestination) -> Void)? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage("learning.dailyGoal") private var dailyGoal = 5
    /// 学习计划缓存：按卡库变化刷新
    @State private var plan = LearningPlan(cards: [])
    @State private var section = Section.today
    @State private var query = ""
    @State private var category = "全部主题"
    @State private var filter = LibraryFilter.all
    @State private var newestFirst = true
    @State private var isGridLayout = true
    /// 双栏断点用的内容区实测宽度：ViewThatFits 依赖「理想宽度」，行内长单行文本
    /// （无 lineLimit 的标题/摘要）会把理想宽撑到虚高，宽窗口也会误落单列。
    @State private var workspaceWidth: CGFloat = 0

    /// 主列 + 侧栏(320) + 间距(18) 能并排的最小内容宽
    private var isTwoColumn: Bool { workspaceWidth >= 720 }

    private enum Section: String, CaseIterable {
        case today = "今日学习", review = "复习计划", library = "知识库"
        var icon: String {
            switch self { case .today: "square.grid.2x2"; case .review: "arrow.triangle.2.circlepath"; case .library: "books.vertical" }
        }
    }
    private enum LibraryFilter: String, CaseIterable {
        case all = "不限", unread = "未读", imported = "笔记", mastered = "已掌握"
    }
    private enum LibraryCollection: String, CaseIterable {
        case all = "全部", saved = "收藏", history = "历史"
        var destination: InsightDestination {
            switch self { case .all: .library; case .saved: .favorites; case .history: .history }
        }
    }
    private var collection: LibraryCollection {
        switch destination { case .favorites: .saved; case .history: .history; default: .all }
    }
    private var activeFilterCount: Int { (category == "全部主题" ? 0 : 1) + (filter == .all ? 0 : 1) }

    private var categories: [String] { Array(Set(store.cards.map(\.category))).sorted() }

    private var filteredCards: [KnowledgeCard] {
        let historyIDs = collection == .history ? Set(store.history.map(\.id)) : Set<UUID>()
        return store.cards.filter { card in
            (collection == .all || collection == .saved && card.isFavorite ||
             collection == .history && historyIDs.contains(card.id)) &&
            (category == "全部主题" || card.category == category) &&
            (query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
             "\(card.headline) \(card.summary) \(card.details) \(card.category)".localizedStandardContains(query.trimmingCharacters(in: .whitespacesAndNewlines))) &&
            (filter == .all || filter == .unread && card.seenAt == nil ||
             filter == .imported && card.source == .imported ||
             filter == .mastered && card.masteryLevel >= 2)
        }.sorted {
            let first = collection == .history ? ($0.seenAt ?? $0.createdAt) : $0.createdAt
            let second = collection == .history ? ($1.seenAt ?? $1.createdAt) : $1.createdAt
            if first == second { return $0.id.uuidString < $1.id.uuidString }
            return newestFirst ? first > second : first < second
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: InsightSpacing.large) {
                switch section {
                case .today: today(plan: plan)
                case .review: review(plan: plan)
                case .library: library
                }
            }
            .padding(InsightLayout.contentPadding)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            // 段落切换的进场：轻微上浮 + 淡入（.id(section) 仍负责滚动归位）
            .transition(sectionTransition)
        }
        .id(section)
        .animation(reduceMotion ? Animation.easeInOut(duration: 0.16) : InsightMotion.page, value: section)
        .background(InsightColor.canvas)
        .foregroundStyle(InsightColor.textPrimary)
        .background {
            // 内容区宽度计量：驱动双栏/单栏断点（见 isTwoColumn 注释）
            GeometryReader { geo in
                Color.clear.preference(key: WorkspaceWidthKey.self, value: geo.size.width)
            }
        }
        .onPreferenceChange(WorkspaceWidthKey.self) { workspaceWidth = $0 }
        .onAppear {
            refreshPlan()
            syncSectionWithDestination()
        }
        .onChange(of: destination) { _, _ in syncSectionWithDestination() }
        .onChange(of: store.cards) { _, _ in refreshPlan() }
        .onLearningDayChange(perform: refreshPlan)
    }

    /// 今日 / 复习 / 知识库三段切换的转场：reduce-motion 退化为纯淡入淡出
    private var sectionTransition: AnyTransition {
        reduceMotion ? .opacity : .asymmetric(
            insertion: .offset(y: 12).combined(with: .opacity),
            removal: .opacity
        )
    }

    private func refreshPlan() {
        plan = LearningPlan(cards: store.cards)
    }

    private func syncSectionWithDestination() {
        switch destination {
        case .today: section = .today
        case .review: section = .review
        case .library, .favorites, .history: section = .library; filter = .all
        default: break
        }
    }

    private func show(_ target: InsightDestination) {
        if let navigate {
            navigate(target)
        } else {
            syncSection(to: target)
        }
    }

    private func syncSection(to target: InsightDestination) {
        switch target {
        case .today: section = .today
        case .review: section = .review
        case .library, .favorites, .history: section = .library; filter = .all
        default: break
        }
    }

    // MARK: - 今日学习

    private func today(plan: LearningPlan) -> some View {
        VStack(alignment: .leading, spacing: InsightSpacing.large) {
            // 页头：问候与日期
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: InsightSpacing.hair) {
                    Text("今日学习")
                        .font(InsightFont.largeTitle)
                        .accessibilityAddTraits(.isHeader)
                    Text("保持专注与好奇心 · 每天沉淀优质认知")
                        .font(InsightFont.caption)
                        .foregroundStyle(InsightColor.textTertiary)
                }
                Spacer()
                HStack(spacing: InsightSpacing.small) {
                    Image(systemName: "calendar")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(InsightColor.accent)
                    Text(Date.now.formatted(.dateTime.month().day().weekday(.wide)))
                        .font(InsightFont.callout)
                        .foregroundStyle(InsightColor.textSecondary)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(InsightColor.surface, in: Capsule())
                .overlay(Capsule().strokeBorder(InsightColor.border, lineWidth: 1))
            }

            // 今日全景 Bento 仪表条
            todayBentoBar(plan: plan)

            // 主工作区：双栏紧凑排布（显式宽度断点，见 isTwoColumn 注释）
            if isTwoColumn {
                HStack(alignment: .top, spacing: InsightSpacing.large) {
                    todayMainColumn.frame(maxWidth: .infinity)
                    todaySideColumn(plan: plan).frame(width: 320)
                }
            } else {
                VStack(alignment: .leading, spacing: InsightSpacing.large) {
                    todayMainColumn
                    todaySideColumn(plan: plan)
                }
            }
        }
    }

    private func todayBentoBar(plan: LearningPlan) -> some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 196), spacing: InsightSpacing.default)],
            spacing: InsightSpacing.default
        ) {
            // 卡片 1: 今日目标
            HStack(spacing: InsightSpacing.default) {
                ZStack {
                    Circle().stroke(InsightColor.accentSoft, lineWidth: 3.5)
                    Circle().trim(from: 0, to: min(1, Double(plan.completedToday) / Double(max(1, dailyGoal))))
                        .stroke(
                            InsightColor.accent,
                            style: StrokeStyle(lineWidth: 3.5, lineCap: .round)
                        )
                        .rotationEffect(.degrees(-90))
                    Text("\(Int(min(1, Double(plan.completedToday) / Double(max(1, dailyGoal))) * 100))%")
                        .font(InsightFont.monoSmall)
                        .foregroundStyle(InsightColor.textPrimary)
                }
                .frame(width: 38, height: 38)
                .animation(reduceMotion ? nil : InsightMotion.value, value: plan.completedToday)

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        Text(plan.completedToday >= dailyGoal ? "今日目标已达成" : "今日学习目标")
                            .font(InsightFont.caption)
                            .foregroundStyle(InsightColor.textSecondary)
                        Menu {
                            ForEach([3, 5, 10, 15], id: \.self) { goal in
                                Button("每天 \(goal) 张") { dailyGoal = goal }
                            }
                        } label: {
                            Image(systemName: "slider.horizontal.3")
                                .font(.system(size: 9))
                                .foregroundStyle(InsightColor.textTertiary)
                        }
                        .menuStyle(.borderlessButton).fixedSize().help("调整每日目标")
                    }
                    HStack(alignment: .firstTextBaseline, spacing: 3) {
                        Text("\(plan.completedToday)")
                            .font(InsightFont.statMedium)
                            .monospacedDigit()
                            .contentTransition(.numericText())
                            .animation(reduceMotion ? nil : InsightMotion.value, value: plan.completedToday)
                        Text("/ \(dailyGoal) 张")
                            .font(InsightFont.caption)
                            .foregroundStyle(InsightColor.textTertiary)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(InsightSpacing.default)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
            .overlay(workCardBorder)

            // 卡片 2: 到期复习（整卡可点直达）
            Button {
                if plan.due.isEmpty { open(.quiz(category: nil)) }
                else { open(.plannedReview(Array(plan.due.prefix(10)))) }
            } label: {
                HStack(spacing: InsightSpacing.default) {
                    Image(systemName: plan.due.isEmpty ? "checkmark.circle" : "arrow.triangle.2.circlepath")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(plan.due.isEmpty ? InsightColor.success : InsightColor.accent)
                        .frame(width: 34, height: 34)
                        .background(InsightColor.surfaceSunken, in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous))

                    VStack(alignment: .leading, spacing: 2) {
                        Text("到期复习任务")
                            .font(InsightFont.caption)
                            .foregroundStyle(InsightColor.textSecondary)
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            Text("\(plan.due.count)")
                                .font(InsightFont.statMedium)
                                .monospacedDigit()
                                .contentTransition(.numericText())
                                .animation(reduceMotion ? nil : InsightMotion.value, value: plan.due.count)
                            Text(plan.due.isEmpty ? "张待复习 · 已清空" : "张待回忆")
                                .font(InsightFont.caption)
                                .foregroundStyle(InsightColor.textTertiary)
                        }
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(InsightColor.textTertiary)
                }
                .padding(InsightSpacing.default)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(InsightListButtonStyle())

            // 卡片 3: 知识库积累（整卡可点直达知识库）
            Button {
                show(.library)
            } label: {
                HStack(spacing: InsightSpacing.default) {
                    Image(systemName: "books.vertical")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(InsightColor.textSecondary)
                        .frame(width: 34, height: 34)
                        .background(InsightColor.surfaceSunken, in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous))

                    VStack(alignment: .leading, spacing: 2) {
                        Text("知识库沉淀")
                            .font(InsightFont.caption)
                            .foregroundStyle(InsightColor.textSecondary)
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            Text("\(store.cards.count)")
                                .font(InsightFont.statMedium)
                                .monospacedDigit()
                                .contentTransition(.numericText())
                                .animation(reduceMotion ? nil : InsightMotion.value, value: store.cards.count)
                            Text("张 · 已掌握 \(plan.mastered)")
                                .font(InsightFont.caption)
                                .foregroundStyle(InsightColor.textTertiary)
                                .lineLimit(1)
                                .minimumScaleFactor(0.85)
                        }
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(InsightColor.textTertiary)
                }
                .padding(InsightSpacing.default)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(InsightListButtonStyle())

            // 卡片 4: 记忆稳固率（整卡可点直达知识星图）
            let masteryRate = store.cards.isEmpty ? 0 : Int(Double(plan.mastered) / Double(store.cards.count) * 100)
            Button {
                open(.graph)
            } label: {
                HStack(spacing: InsightSpacing.default) {
                    Image(systemName: "chart.line.uptrend.xyaxis")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(InsightColor.textSecondary)
                        .frame(width: 34, height: 34)
                        .background(InsightColor.surfaceSunken, in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous))

                    VStack(alignment: .leading, spacing: 2) {
                        Text("记忆稳固成效")
                            .font(InsightFont.caption)
                            .foregroundStyle(InsightColor.textSecondary)
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            Text("\(masteryRate)%")
                                .font(InsightFont.statMedium)
                                .monospacedDigit()
                                .contentTransition(.numericText())
                                .animation(reduceMotion ? nil : InsightMotion.value, value: masteryRate)
                            Text("稳固达成")
                                .font(InsightFont.caption)
                                .foregroundStyle(InsightColor.textTertiary)
                        }
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(InsightColor.textTertiary)
                }
                .padding(InsightSpacing.default)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(InsightListButtonStyle())
        }
    }

    private var todayMainColumn: some View {
        VStack(alignment: .leading, spacing: InsightSpacing.large) {
            readingFeature

            // 今日待刷队列精选：消除卡片下方大面积空白
            upcomingDeckQueue
        }
    }

    private var upcomingDeckQueue: some View {
        VStack(alignment: .leading, spacing: InsightSpacing.compact) {
            HStack {
                InsightSectionLabel(text: "待刷队列", trailing: String(localized: "\(store.deck.count) 张待探索"))
                Spacer()
                Button {
                    explore()
                } label: {
                    HStack(spacing: 3) {
                        Text("进入刷卡模式 ⌘2")
                            .font(InsightFont.captionSmall)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 8, weight: .bold))
                    }
                    .foregroundStyle(InsightColor.accent)
                }
                .buttonStyle(InsightTextLinkStyle())
            }
            .padding(.horizontal, 2)

            let queueCards = Array(store.deck.dropFirst().prefix(4))
            if queueCards.isEmpty {
                HStack(spacing: InsightSpacing.default) {
                    Image(systemName: "sparkles")
                        .foregroundStyle(InsightColor.accent)
                    Text("当前队列已全部就绪，继续阅读或换一批新知识。")
                        .font(InsightFont.caption)
                        .foregroundStyle(InsightColor.textTertiary)
                    Spacer()
                    InsightButton(title: "换一批", icon: "arrow.clockwise", style: .plain) {
                        Task { await store.refreshDeck() }
                    }
                }
                .padding(InsightSpacing.default)
                .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
                .overlay(workCardBorder)
            } else {
                VStack(spacing: 0) {
                    ForEach(queueCards) { card in
                        Button {
                            open(.detail(card))
                        } label: {
                            HStack(spacing: InsightSpacing.default) {
                                Text(card.category)
                                    .font(InsightFont.captionSmall)
                                    .foregroundStyle(InsightColor.textSecondary)
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 3)
                                    .background(InsightColor.surfaceSunken, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(InsightColor.border, lineWidth: 0.5))

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(card.displayHeadline)
                                        .font(InsightFont.bodyStrong)
                                        .foregroundStyle(InsightColor.textPrimary)
                                        .lineLimit(1)
                                    if !card.displaySummary.isEmpty {
                                        Text(card.displaySummary)
                                            .font(InsightFont.captionSmall)
                                            .foregroundStyle(InsightColor.textTertiary)
                                            .lineLimit(1)
                                    }
                                }

                                Spacer(minLength: 8)

                                Text("约 \(max(1, card.details.count / 300)) 分钟")
                                    .font(InsightFont.captionSmall)
                                    .foregroundStyle(InsightColor.textMuted)

                                Image(systemName: "chevron.right")
                                    .font(.system(size: 9, weight: .medium))
                                    .foregroundStyle(InsightColor.textTertiary)
                            }
                            .padding(.horizontal, InsightSpacing.default)
                            .padding(.vertical, 10)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(InsightListButtonStyle())

                        if card.id != queueCards.last?.id {
                            Divider().padding(.leading, 16).overlay(InsightColor.divider)
                        }
                    }
                }
                .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
                .overlay(workCardBorder)
            }
        }
    }

    private func todaySideColumn(plan: LearningPlan) -> some View {
        VStack(alignment: .leading, spacing: InsightSpacing.large) {
            // 今日已学足迹
            activityTrailCard

            // 快捷通道
            quickToolbelt
        }
    }

    private var activityTrailCard: some View {
        VStack(alignment: .leading, spacing: InsightSpacing.compact) {
            InsightSectionLabel(text: "学习足迹", trailing: String(localized: "\(store.history.count) 累计"))

            let recentCards = Array(store.history.prefix(3))
            if recentCards.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("今日尚未浏览新卡片")
                        .font(InsightFont.caption)
                        .foregroundStyle(InsightColor.textMuted)
                    HStack(spacing: 5) {
                    ForEach(Array(categories.prefix(3)), id: \.self) { cat in
                        Button(cat) { category = cat; show(.library) }
                            .buttonStyle(PressableButtonStyle(scale: 0.96, playAudio: false))
                            .font(InsightFont.captionSmall)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background(InsightColor.surfaceSunken, in: Capsule())
                            .overlay(Capsule().strokeBorder(InsightColor.border, lineWidth: 1))
                    }
                    }
                }
                .padding(InsightSpacing.default)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
                .overlay(workCardBorder)
            } else {
                VStack(spacing: 0) {
                    ForEach(recentCards) { card in
                        Button { open(.detail(card)) } label: {
                            HStack(spacing: InsightSpacing.small) {
                                Circle().fill(InsightColor.accent).frame(width: 5, height: 5)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(card.displayHeadline)
                                        .font(InsightFont.caption)
                                        .foregroundStyle(InsightColor.textPrimary)
                                        .lineLimit(1)
                                    Text(card.category)
                                        .font(InsightFont.captionSmall)
                                        .foregroundStyle(InsightColor.textTertiary)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 8, weight: .semibold))
                                    .foregroundStyle(InsightColor.textMuted)
                            }
                            .padding(.horizontal, InsightSpacing.default)
                            .padding(.vertical, 8)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(InsightListButtonStyle())
                        if card.id != recentCards.last?.id {
                            Divider().padding(.leading, 18).overlay(InsightColor.divider)
                        }
                    }
                }
                .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
                .overlay(workCardBorder)
            }
        }
    }

    private var quickToolbelt: some View {
        VStack(spacing: InsightSpacing.tiny) {
            pathway(title: "知识星图", detail: "在关联网络中漫游探索", icon: "point.3.connected.trianglepath.dotted") { open(.graph) }
            pathway(title: "连续听书", detail: "磨耳朵后台语音轮播", icon: "headphones") { open(.speechConsole) }
            pathway(title: "导入笔记", detail: "Markdown 笔记导入知识库", icon: "square.and.arrow.down") { open(.importNotes) }
        }
    }

    private var readingFeature: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let card = store.topCard {
                let theme = CategoryTheme.theme(for: card)
                HStack(alignment: .center) {
                    HStack(spacing: 6) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(InsightColor.accent)
                        Text("接下来读")
                            .font(InsightFont.bodyStrong)
                    }
                    Spacer()
                    Text(card.category)
                        .font(InsightFont.caption)
                        .foregroundStyle(InsightColor.textSecondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(InsightColor.surfaceSunken, in: Capsule())
                        .overlay(Capsule().strokeBorder(InsightColor.border, lineWidth: 1))
                }
                .padding(.horizontal, InsightSpacing.large)
                .padding(.vertical, InsightSpacing.compact)

                GeometryReader { geometry in
                    if let image = theme.image {
                        Image(nsImage: image).resizable().scaledToFill()
                            .frame(width: geometry.size.width, height: 148).clipped()
                    } else { theme.accent.opacity(0.22) }
                }
                .frame(height: 148)
                .clipped()
                .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: InsightSpacing.compact) {
                    Text(card.displayHeadline)
                        .font(InsightFont.title)
                        .allowsTightening(true)
                        .minimumScaleFactor(0.85)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(card.displaySummary)
                        .font(InsightFont.body)
                        .foregroundStyle(InsightColor.textSecondary)
                        .lineSpacing(2)
                        .lineLimit(3)

                    HStack {
                        HStack(spacing: 4) {
                            Image(systemName: "clock")
                                .font(.system(size: 9.5))
                            Text("约 \(max(1, card.details.count / 300)) 分钟阅读")
                                .font(InsightFont.captionSmall)
                        }
                        .foregroundStyle(InsightColor.textTertiary)

                        Spacer()

                        Button { store.toggleFavorite(card) } label: {
                            Image(systemName: card.isFavorite ? "bookmark.fill" : "bookmark")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(card.isFavorite ? InsightColor.warning : InsightColor.textSecondary)
                                .frame(width: 28, height: 28)
                                .background(InsightColor.surfaceSunken, in: Circle())
                                .overlay(Circle().strokeBorder(InsightColor.border, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .help(card.isFavorite ? "取消收藏" : "加入收藏")

                        InsightButton(
                            title: "开始阅读",
                            icon: "arrow.up.right",
                            style: .primary,
                            action: { open(.detail(card)) }
                        )
                    }
                    .padding(.top, 2)
                }
                .padding(InsightSpacing.large)
            } else {
                InsightEmptyState(
                    icon: "checkmark.seal",
                    title: "这一轮读完了",
                    message: "复习已有知识，或导入新的笔记继续积累。",
                    actionTitle: "导入笔记",
                    action: { open(.importNotes) }
                )
                .padding(InsightSpacing.large)
            }
        }
        .background(InsightColor.surface)
        .overlay(workCardBorder)
        .clipShape(RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
        .shadow(color: Color.black.opacity(0.04), radius: 6, y: 2)
    }

    private func pathway(title: String, detail: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: InsightSpacing.default) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(InsightColor.textSecondary)
                    .frame(width: 18).padding(.top, 2)
                VStack(alignment: .leading, spacing: 2) {
                    Text(LocalizedStringKey(title)).font(InsightFont.bodyStrong).foregroundStyle(InsightColor.textPrimary)
                    Text(LocalizedStringKey(detail)).font(InsightFont.captionSmall).foregroundStyle(InsightColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 9, weight: .medium))
                    .foregroundStyle(InsightColor.textTertiary)
            }
            .padding(InsightSpacing.default)
            .contentShape(Rectangle())
        }.buttonStyle(InsightListButtonStyle())
    }

    // MARK: - 复习计划

    private func review(plan: LearningPlan) -> some View {
        VStack(alignment: .leading, spacing: InsightSpacing.large) {
            sectionHeading("复习计划", subtitle: "基于艾宾浩斯遗忘曲线：初读次日、模糊 3 天、掌握 7 天、稳固 21 天。")

            // 复习概览 Bento 条
            reviewBentoBar(plan: plan)

            // 双栏工作区（显式宽度断点，与今日页同一把尺子）
            if isTwoColumn {
                HStack(alignment: .top, spacing: InsightSpacing.large) {
                    reviewMainColumn(plan: plan).frame(maxWidth: .infinity)
                    reviewSideColumn(plan: plan).frame(width: 320)
                }
            } else {
                VStack(alignment: .leading, spacing: InsightSpacing.large) {
                    reviewMainColumn(plan: plan)
                    reviewSideColumn(plan: plan)
                }
            }
        }
    }

    private var inProgressReviewCards: [KnowledgeCard] {
        plan.cards.filter { $0.seenAt != nil && $0.masteryLevel < 2 }
    }

    private func reviewBentoBar(plan: LearningPlan) -> some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 196), spacing: InsightSpacing.default)],
            spacing: InsightSpacing.default
        ) {
            // Bento 1: 到期待回忆（整卡可点：四块仪表一种点法，内嵌按钮在四列布局下挤爆内容）
            Button {
                if plan.due.isEmpty { open(.quiz(category: nil)) }
                else { open(.plannedReview(Array(plan.due.prefix(10)))) }
            } label: {
                HStack(spacing: InsightSpacing.default) {
                    Image(systemName: plan.due.isEmpty ? "checkmark.circle.fill" : "arrow.triangle.2.circlepath")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(plan.due.isEmpty ? InsightColor.success : InsightColor.accent)
                        .frame(width: 36, height: 36)
                        .background((plan.due.isEmpty ? InsightColor.success : InsightColor.accent).opacity(0.12), in: Circle())

                    VStack(alignment: .leading, spacing: 2) {
                        Text("到期复习任务")
                            .font(InsightFont.caption)
                            .foregroundStyle(InsightColor.textSecondary)
                            .lineLimit(1)
                        HStack(alignment: .firstTextBaseline, spacing: 3) {
                            Text("\(plan.due.count)")
                                .font(InsightFont.statMedium)
                                .monospacedDigit()
                                .lineLimit(1)
                            Text("张到期")
                                .font(InsightFont.caption)
                                .foregroundStyle(InsightColor.textTertiary)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                        }
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(InsightColor.textTertiary)
                }
                .padding(InsightSpacing.default)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(InsightListButtonStyle())
            .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
            .overlay(workCardBorder)

            // Bento 2: 正在巩固中
            HStack(spacing: InsightSpacing.default) {
                Image(systemName: "hourglass.badge.plus")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(InsightColor.warning)
                    .frame(width: 36, height: 36)
                    .background(InsightColor.warning.opacity(0.12), in: Circle())

                VStack(alignment: .leading, spacing: 2) {
                    Text("记忆巩固阶段")
                        .font(InsightFont.caption)
                        .foregroundStyle(InsightColor.textSecondary)
                    HStack(alignment: .firstTextBaseline, spacing: 3) {
                        Text("\(inProgressReviewCards.count)")
                            .font(InsightFont.statMedium)
                            .monospacedDigit()
                            .foregroundStyle(InsightColor.warning)
                        Text("张巩固中")
                            .font(InsightFont.caption)
                            .foregroundStyle(InsightColor.textTertiary)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(InsightSpacing.default)
            .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
            .overlay(workCardBorder)

            // Bento 3: 已稳固掌握
            HStack(spacing: InsightSpacing.default) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(InsightColor.success)
                    .frame(width: 36, height: 36)
                    .background(InsightColor.success.opacity(0.12), in: Circle())

                VStack(alignment: .leading, spacing: 2) {
                    Text("永久掌握记忆")
                        .font(InsightFont.caption)
                        .foregroundStyle(InsightColor.textSecondary)
                    HStack(alignment: .firstTextBaseline, spacing: 3) {
                        Text("\(plan.mastered)")
                            .font(InsightFont.statMedium)
                            .monospacedDigit()
                            .foregroundStyle(InsightColor.success)
                        Text("张达成")
                            .font(InsightFont.caption)
                            .foregroundStyle(InsightColor.textTertiary)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(InsightSpacing.default)
            .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
            .overlay(workCardBorder)

            // Bento 4: 知识模拟测验（整卡可点，与 Bento 1 同语言）
            Button {
                open(.quiz(category: nil))
            } label: {
                HStack(spacing: InsightSpacing.default) {
                    Image(systemName: "graduationcap.fill")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(InsightColor.seal)
                        .frame(width: 36, height: 36)
                        .background(InsightColor.seal.opacity(0.12), in: Circle())

                    VStack(alignment: .leading, spacing: 2) {
                        Text("主动回忆自测")
                            .font(InsightFont.caption)
                            .foregroundStyle(InsightColor.textSecondary)
                            .lineLimit(1)
                        Text("3D 翻转抽答")
                            .font(InsightFont.bodyStrong)
                            .lineLimit(1)
                            .minimumScaleFactor(0.85)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(InsightColor.textTertiary)
                }
                .padding(InsightSpacing.default)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(InsightListButtonStyle())
            .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
            .overlay(workCardBorder)
        }
    }

    private func reviewMainColumn(plan: LearningPlan) -> some View {
        VStack(alignment: .leading, spacing: InsightSpacing.large) {
            if !plan.due.isEmpty {
                sectionHeading("优先回忆", subtitle: "按到期时间排序，先回忆，再揭晓答案。每轮最多 10 张。")
                LazyVStack(spacing: 0) {
                    ForEach(plan.due) { card in
                        cardRow(card, review: true)
                        if card.id != plan.due.last?.id { Divider().overlay(InsightColor.divider) }
                    }
                }
                .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card))
                .overlay(workCardBorder)
            } else {
                // 今日到期已完成提示卡
                HStack(spacing: InsightSpacing.default) {
                    InsightInkEmptyArt(size: 46)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("今日到期复习已全部完成 ✨")
                            .font(InsightFont.bodyStrong)
                            .foregroundStyle(InsightColor.textPrimary)
                        Text("科学记忆曲线在明日会自动安排新到期卡片。可随时自测或提前巩固进行中的知识。")
                            .font(InsightFont.caption)
                            .foregroundStyle(InsightColor.textTertiary)
                    }
                    Spacer()
                    InsightButton(title: "自由测验", icon: "graduationcap", style: .primary) { open(.quiz(category: nil)) }
                }
                .padding(InsightSpacing.default)
                .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
                .overlay(workCardBorder)
            }

            // 巩固期知识队列 (阶段复习池) - 彻底消灭复习页面的空旷感
            if !inProgressReviewCards.isEmpty {
                VStack(alignment: .leading, spacing: InsightSpacing.compact) {
                    InsightSectionLabel(text: "巩固期知识队列", trailing: String(localized: "\(inProgressReviewCards.count) 张正在巩固"))
                    LazyVStack(spacing: 0) {
                        ForEach(Array(inProgressReviewCards.prefix(6))) { card in
                            cardRow(card, review: false)
                            if card.id != inProgressReviewCards.prefix(6).last?.id {
                                Divider().padding(.leading, 18).overlay(InsightColor.divider)
                            }
                        }
                    }
                    .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
                    .overlay(workCardBorder)
                }
            }
        }
    }

    private func reviewSideColumn(plan: LearningPlan) -> some View {
        VStack(alignment: .leading, spacing: InsightSpacing.large) {
            let upcoming = plan.upcomingCards(limit: plan.cards.count).filter { $0.date > plan.now }
            VStack(alignment: .leading, spacing: InsightSpacing.compact) {
                InsightSectionLabel(text: "接下来的安排", trailing: String(localized: "\(upcoming.count) 项"))
                if upcoming.isEmpty {
                    Text("暂无未来 7 天到期安排")
                        .font(InsightFont.caption)
                        .foregroundStyle(InsightColor.textMuted)
                        .padding(InsightSpacing.default)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card))
                        .overlay(workCardBorder)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(upcoming.prefix(6)), id: \.0.id) { card, date in
                            Button { open(.detail(card)) } label: {
                                HStack(spacing: InsightSpacing.small) {
                                    Text(date.formatted(.dateTime.month().day()))
                                        .font(InsightFont.monoSmall)
                                        .monospacedDigit()
                                        .foregroundStyle(InsightColor.accent)
                                        .frame(width: 52, alignment: .leading)
                                    Text(card.displayHeadline)
                                        .font(InsightFont.caption)
                                        .foregroundStyle(InsightColor.textPrimary)
                                        .lineLimit(1)
                                    Spacer(minLength: 0)
                                    Text(card.category)
                                        .font(InsightFont.captionSmall)
                                        .foregroundStyle(InsightColor.textTertiary)
                                }
                                .padding(.horizontal, InsightSpacing.default)
                                .padding(.vertical, 7)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(InsightListButtonStyle())
                            if card.id != upcoming.prefix(6).last?.0.id {
                                Divider().padding(.leading, 12).overlay(InsightColor.divider)
                            }
                        }
                    }
                    .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card))
                    .overlay(workCardBorder)
                }
            }

            // 遗忘规律协议说明卡
            VStack(alignment: .leading, spacing: InsightSpacing.small) {
                Label("间隔复习机制", systemImage: "brain.head.profile")
                    .font(InsightFont.caption.weight(.bold))
                    .foregroundStyle(InsightColor.textSecondary)
                Text("科学排程可将短时记忆转化为长期语义记忆：")
                    .font(InsightFont.captionSmall)
                    .foregroundStyle(InsightColor.textTertiary)
                HStack(spacing: 6) {
                    protocolPill(day: "1天", label: "初次巩固")
                    protocolPill(day: "3天", label: "模糊回忆")
                    protocolPill(day: "7天", label: "深度掌握")
                }
            }
            .padding(InsightSpacing.default)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(InsightColor.surfaceSunken, in: RoundedRectangle(cornerRadius: InsightRadius.card))
            .overlay(
                RoundedRectangle(cornerRadius: InsightRadius.card)
                    .strokeBorder(InsightColor.doubleBezelStroke, lineWidth: 1)
            )
        }
    }

    private func protocolPill(day: String, label: String) -> some View {
        VStack(spacing: 2) {
            Text(day)
                .font(InsightFont.monoSmall)
                .foregroundStyle(InsightColor.accent)
            Text(label)
                .font(InsightFont.captionSmall)
                .foregroundStyle(InsightColor.textMuted)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(InsightColor.border, lineWidth: 1))
    }

    private func metric(_ title: String, value: Int, tone: InsightPill.Tone = .accent) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(InsightFont.caption).foregroundStyle(InsightColor.textTertiary)
            Text("\(value)")
                .font(InsightFont.statMedium)
                .monospacedDigit()
                .foregroundStyle(tone.foreground)
                .contentTransition(.numericText())
                .animation(reduceMotion ? nil : InsightMotion.value, value: value)
        }
        .padding(.horizontal, InsightSpacing.small)
        .fixedSize()
    }

    // MARK: - 知识库

    private var library: some View {
        let results = filteredCards
        return VStack(alignment: .leading, spacing: InsightSpacing.large) {
            // 页头与操作
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: InsightSpacing.large) {
                    sectionHeading("知识库", subtitle: "\(store.cards.count) 张卡片 · \(results.count) 张匹配")
                    Spacer(minLength: InsightSpacing.large)
                    libraryActions
                }
                VStack(alignment: .leading, spacing: InsightSpacing.default) {
                    sectionHeading("知识库", subtitle: "\(store.cards.count) 张卡片 · \(results.count) 张匹配")
                    libraryActions
                }
            }

            // 统一紧凑指令控制栏 (Command Bar)
            HStack(spacing: InsightSpacing.compact) {
                // 范围分段
                libraryCollections

                // 搜索输入框
                HStack(spacing: InsightSpacing.small) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(InsightColor.textTertiary)
                    TextField("搜索标题、正文或主题", text: $query)
                        .accessibilityLabel("搜索知识库")
                        .textFieldStyle(.plain)
                        .font(InsightFont.body)
                    if !query.isEmpty {
                        Button { query = "" } label: { Image(systemName: "xmark.circle.fill") }
                            .buttonStyle(PressableButtonStyle(scale: 0.85, playAudio: false))
                            .help("清除搜索")
                            .accessibilityLabel("清除搜索")
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous))
                .overlay(workControlBorder)
                .frame(minWidth: 160, maxWidth: 300)

                // 筛选菜单
                libraryFilters

                Spacer(minLength: 0)

                // 视图模式切换（网格 / 列表）
                HStack(spacing: 2) {
                    LayoutToggleIcon(icon: "square.grid.2x2", isOn: isGridLayout, help: "网格视图") {
                        isGridLayout = true
                    }
                    LayoutToggleIcon(icon: "list.bullet", isOn: !isGridLayout, help: "列表视图") {
                        isGridLayout = false
                    }
                }
                .padding(2)
                .background(InsightColor.surfaceSunken, in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(InsightColor.border, lineWidth: 1))
                .animation(reduceMotion ? nil : InsightMotion.tactile, value: isGridLayout)

                // 整理与导出菜单
                Menu {
                    Picker("排序", selection: $newestFirst) {
                        Text(collection == .history ? "最近浏览" : "最新优先").tag(true)
                        Text(collection == .history ? "最早浏览" : "最早优先").tag(false)
                    }
                    Divider()
                    Button("导出当前结果", systemImage: "square.and.arrow.up") { open(.exportCards(results)) }
                        .disabled(results.isEmpty)
                    Button("局域网同步…", systemImage: "arrow.triangle.2.circlepath") { open(.sync) }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(InsightColor.textSecondary)
                        .padding(6)
                        .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: 6))
                        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(InsightColor.border, lineWidth: 1))
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
            }

            if results.isEmpty {
                if collection == .saved && store.favorites.isEmpty {
                    InsightEmptyState(
                        icon: "heart",
                        inkArt: true,
                        title: "还没有收藏",
                        message: "刷卡时右滑，或按 → 键把感兴趣的卡片收进这里。",
                        actionTitle: "去刷卡",
                        action: { explore() }
                    )
                } else if collection == .history && store.history.isEmpty {
                    InsightEmptyState(
                        icon: "clock",
                        inkArt: true,
                        title: "还没有刷过卡片",
                        message: "浏览过的卡片会按时间出现在这里。",
                        actionTitle: "去刷卡",
                        action: { explore() }
                    )
                } else {
                    InsightEmptyState(
                        icon: "magnifyingglass",
                        title: "没有匹配的知识",
                        message: "试试其他关键词，或重置主题与学习状态筛选。",
                        actionTitle: "重置筛选",
                        action: { query = ""; category = "全部主题"; filter = .all; show(.library) }
                    )
                }
            } else if isGridLayout {
                // 自适应多列卡片网格：完全消灭宽屏下的横向大面积留白
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: InsightLayout.gridMinColumn), spacing: InsightSpacing.default)],
                    spacing: InsightSpacing.default
                ) {
                    ForEach(results) { card in
                        InsightCardTile(card: card) {
                            open(.detail(card))
                        }
                    }
                }
                .transition(.opacity)
            } else {
                // 紧凑数据列表
                LazyVStack(spacing: 0) {
                    ForEach(results) { card in
                        cardRow(card)
                        Divider().padding(.leading, 18).overlay(InsightColor.divider)
                    }
                }
                .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
                .overlay(workCardBorder)
                .transition(.opacity)
            }
        }
        .animation(reduceMotion ? nil : EditorialSpring.state, value: isGridLayout)
    }

    private var libraryActions: some View {
        Menu("添加", systemImage: "plus") {
            Button("导入笔记或卡片", systemImage: "square.and.arrow.down") { open(.importNotes) }
            Button("剪藏网页", systemImage: "link") { open(.webClip) }
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .font(InsightFont.bodyStrong)
        .foregroundStyle(InsightColor.accent)
        .accessibilityLabel("添加到知识库")
    }

    private var libraryCollections: some View {
        Picker("知识库范围", selection: Binding(
            get: { collection },
            set: { show($0.destination) }
        )) {
            ForEach(LibraryCollection.allCases, id: \.self) { item in
                Text(item.rawValue).tag(item)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .frame(width: 175)
        .accessibilityLabel("知识库范围")
    }

    private var libraryFilters: some View {
        HStack(spacing: InsightSpacing.small) {
            Menu(activeFilterCount == 0 ? "筛选" : "筛选 · \(activeFilterCount)", systemImage: "line.3.horizontal.decrease") {
                Picker("主题", selection: $category) {
                    Text("全部主题").tag("全部主题")
                    ForEach(categories, id: \.self) { Text($0).tag($0) }
                }
                Picker("状态与来源", selection: $filter) {
                    ForEach(LibraryFilter.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                if activeFilterCount > 0 {
                    Divider()
                    Button("清除筛选") { category = "全部主题"; filter = .all }
                }
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            .accessibilityLabel("筛选卡片，已选 \(activeFilterCount) 项")
            if activeFilterCount > 0 {
                Text([category == "全部主题" ? nil : category, filter == .all ? nil : filter.rawValue]
                    .compactMap { $0 }.joined(separator: " · "))
                    .font(InsightFont.captionSmall)
                    .foregroundStyle(InsightColor.textSecondary)
                    .lineLimit(1)
                Button { category = "全部主题"; filter = .all } label: {
                    Image(systemName: "xmark.circle")
                }
                .buttonStyle(PressableButtonStyle(scale: 0.85, playAudio: false))
                .help("清除筛选")
                .accessibilityLabel("清除筛选")
            }
        }
    }

    // MARK: - 卡片行

    private func cardRow(_ card: KnowledgeCard, review: Bool = false) -> some View {
        let theme = CategoryTheme.theme(for: card)
        return HStack(spacing: InsightSpacing.default) {
            Group {
                if let image = theme.image {
                    Image(nsImage: image).resizable().scaledToFill()
                } else {
                    Image(systemName: theme.iconName)
                        .resizable().scaledToFit().padding(9)
                        .foregroundStyle(theme.accent)
                }
            }
            .frame(width: 40, height: 40)
            .background(theme.accent.opacity(0.14))
            .clipShape(RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous))

            Button { open(review ? .plannedReview([card]) : .detail(card)) } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(card.displayHeadline)
                        .font(InsightFont.bodyStrong)
                        .foregroundStyle(InsightColor.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("\(card.category)  ·  \(card.source == .imported ? "导入笔记" : card.source == .ai ? "AI 生成" : "精选知识")  ·  \(card.masteryLevel >= 2 ? "已掌握" : card.lastReviewedAt != nil ? "待巩固" : card.seenAt == nil ? "未读" : "已读")")
                        .font(InsightFont.captionSmall)
                        .foregroundStyle(InsightColor.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
            }.buttonStyle(InsightTextLinkStyle())

            Button { store.toggleFavorite(card) } label: {
                Image(systemName: card.isFavorite ? "bookmark.fill" : "bookmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(card.isFavorite ? InsightColor.accent : InsightColor.textTertiary)
                    .padding(InsightSpacing.small)
                    .animation(InsightMotion.tactile, value: card.isFavorite)
            }.buttonStyle(PressableButtonStyle(scale: 0.88, playAudio: false)).help(card.isFavorite ? "取消收藏" : "收藏")
                .accessibilityLabel("\(card.isFavorite ? "取消收藏" : "收藏")：\(card.headline)")

            if !review {
                Button { open(.editCard(card)) } label: {
                    Image(systemName: "pencil")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(InsightColor.textTertiary)
                        .padding(InsightSpacing.small)
                }.buttonStyle(PressableButtonStyle(scale: 0.88, playAudio: false)).help("编辑卡片").accessibilityLabel("编辑：\(card.headline)")
            }
        }.padding(InsightSpacing.default)
            .contextMenu {
                Button("编辑卡片", systemImage: "pencil") { open(.editCard(card)) }
                Button("针对这张卡片追问", systemImage: "bubble.left.and.text.bubble.right") { open(.chat(card)) }
                Button("导出这张卡片", systemImage: "square.and.arrow.up") { open(.exportCards([card])) }
                Button("生成分享海报", systemImage: "photo") { open(.sharePoster(card)) }
            }
    }

    private func sectionHeading(_ title: String, subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: InsightSpacing.hair) {
            Text(LocalizedStringKey(title))
                .font(InsightFont.title)
                .accessibilityAddTraits(.isHeader)
                .fixedSize(horizontal: false, vertical: true)
            Text(LocalizedStringKey(subtitle))
                .font(InsightFont.callout)
                .foregroundStyle(InsightColor.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // 极简工具风发丝描边（内容卡与控件两个规格）
    private var workCardBorder: some View {
        RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous)
            .strokeBorder(InsightColor.border, lineWidth: 1)
    }
    private var workControlBorder: some View {
        RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
            .strokeBorder(InsightColor.border, lineWidth: 1)
    }
}

/// 双栏断点的宽度计量（见 LearningWorkspaceView.isTwoColumn 注释）
private struct WorkspaceWidthKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

/// 网格/列表视图切换的单个图标位：选中实心底、悬停微底、按压回缩
private struct LayoutToggleIcon: View {
    let icon: String
    let isOn: Bool
    let help: String
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(isOn ? InsightColor.textPrimary : (hovering ? InsightColor.textSecondary : InsightColor.textTertiary))
                .padding(6)
                .background(
                    isOn ? InsightColor.surfaceRaised : (hovering ? InsightColor.neutralSoft.opacity(0.6) : Color.clear),
                    in: RoundedRectangle(cornerRadius: 6)
                )
        }
        .buttonStyle(PressableButtonStyle(scale: 0.92, playAudio: false))
        .onHover { hovering = $0 }
        .animation(InsightMotion.tactile, value: hovering)
        .help(help)
        .accessibilityAddTraits(isOn ? [.isSelected] : [])
    }
}
