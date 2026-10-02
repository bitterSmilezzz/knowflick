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
    /// 学习计划缓存：原来在 body 每次求值（含搜索框每个按键）都重建 LearningPlan
    /// （O(n) 且带日历运算），现按卡库变化刷新
    @State private var plan = LearningPlan(cards: [])
    @State private var section = Section.today
    @State private var query = ""
    @State private var category = "全部主题"
    @State private var filter = LibraryFilter.all
    @State private var newestFirst = true

    private enum Section: String, CaseIterable {
        case today = "今日学习", review = "复习计划", library = "知识库"
        var icon: String {
            switch self { case .today: "square.grid.2x2"; case .review: "arrow.triangle.2.circlepath"; case .library: "books.vertical" }
        }
    }
    private enum LibraryFilter: String, CaseIterable {
        case all = "全部", unread = "未读", saved = "收藏", imported = "笔记", mastered = "已掌握"
    }
    private var categories: [String] { Array(Set(store.cards.map(\.category))).sorted() }

    /// 分类汇总（单次遍历）：今日版图 tile 原来每张做两次全库 filter（8 张 tile = 16 遍）
    private var categorySummaries: [String: (total: Int, mastered: Int)] {
        var summaries: [String: (total: Int, mastered: Int)] = [:]
        for card in store.cards {
            var summary = summaries[card.category] ?? (0, 0)
            summary.total += 1
            if card.masteryLevel >= 2 { summary.mastered += 1 }
            summaries[card.category] = summary
        }
        return summaries
    }
    private var filteredCards: [KnowledgeCard] {
        store.cards.filter { card in
            (category == "全部主题" || card.category == category) &&
            (query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
             "\(card.headline) \(card.summary) \(card.details) \(card.category)".localizedStandardContains(query.trimmingCharacters(in: .whitespacesAndNewlines))) &&
            (filter == .all || filter == .unread && card.seenAt == nil ||
             filter == .saved && card.isFavorite || filter == .imported && card.source == .imported ||
             filter == .mastered && card.masteryLevel >= 2)
        }.sorted {
            if $0.createdAt == $1.createdAt { return $0.id.uuidString < $1.id.uuidString }
            return newestFirst ? $0.createdAt > $1.createdAt : $0.createdAt < $1.createdAt
        }
    }

    var body: some View {
        // 原 60 秒 TimelineView 包裹整页仅为刷新 LearningPlan 的「今天」，纯属周期性整页重算；
        // 仅在卡库变化、跨日或重新激活时刷新日期派生数据。
        ScrollView {
            VStack(alignment: .leading, spacing: InsightSpacing.large) {
                switch section {
                case .today: today(plan: plan)
                case .review: review(plan: plan)
                case .library: library
                }
            }
            .padding(InsightLayout.contentPadding)
            .frame(maxWidth: 1200, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .id(section)
        .background(InsightColor.canvas)
        .foregroundStyle(InsightColor.textPrimary)
        .onAppear {
            refreshPlan()
            syncSectionWithDestination()
        }
        .onChange(of: destination) { _, _ in syncSectionWithDestination() }
        .onChange(of: store.cards) { _, _ in refreshPlan() }
        .onLearningDayChange(perform: refreshPlan)
    }

    private func refreshPlan() {
        plan = LearningPlan(cards: store.cards)
    }

    private func syncSectionWithDestination() {
        switch destination {
        case .today: section = .today
        case .review: section = .review
        case .library: section = .library
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
        case .library: section = .library
        default: break
        }
    }

    // MARK: - 今日学习

    private func today(plan: LearningPlan) -> some View {
        VStack(alignment: .leading, spacing: InsightSpacing.xl) {
            HStack(alignment: .firstTextBaseline) {
                Text("今日学习")
                    .font(InsightFont.largeTitle)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Text(Date.now.formatted(.dateTime.month().day().weekday(.wide)))
                    .font(InsightFont.callout)
                    .foregroundStyle(InsightColor.textSecondary)
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 40) {
                    dailyProgress(plan: plan)
                    Divider().frame(height: 40)
                    metrics(plan: plan)
                }
                VStack(alignment: .leading, spacing: InsightSpacing.large) {
                    dailyProgress(plan: plan)
                    metrics(plan: plan)
                }
            }
            .padding(.vertical, InsightSpacing.compact)

            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: InsightSpacing.xl) {
                    readingFeature.frame(minWidth: 320, maxWidth: .infinity)
                    nextSteps(plan: plan).frame(width: 248)
                }
                VStack(alignment: .leading, spacing: InsightSpacing.xl) {
                    readingFeature
                    nextSteps(plan: plan)
                }
            }
            topicDirectory
        }
    }

    private var topicDirectory: some View {
        VStack(alignment: .leading, spacing: InsightSpacing.default) {
            HStack(alignment: .firstTextBaseline) {
                Text("按主题阅读").font(InsightFont.headline)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Button("查看全部", systemImage: "arrow.right") {
                    category = "全部主题"; filter = .all; query = ""; show(.library)
                }
                .buttonStyle(.plain)
                .font(InsightFont.callout)
                .foregroundStyle(InsightColor.accent)
            }
            let summaries = categorySummaries
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: InsightSpacing.large)], spacing: InsightSpacing.tiny) {
                ForEach(Array(categories.prefix(8)), id: \.self) { name in
                    let summary = summaries[name] ?? (0, 0)
                    Button {
                        category = name; filter = .all; show(.library)
                    } label: {
                        HStack(spacing: InsightSpacing.default) {
                            Image(systemName: CategoryTheme.visualSpec(for: name).iconName)
                                .font(.system(size: 15, weight: .regular))
                                .foregroundStyle(InsightColor.textSecondary)
                                .frame(width: 24)
                            VStack(alignment: .leading, spacing: InsightSpacing.tiny) {
                                Text(name).font(InsightFont.bodyStrong)
                                    .foregroundStyle(InsightColor.textPrimary)
                                Text("\(summary.total) 张 · 已掌握 \(summary.mastered) 张")
                                    .font(InsightFont.caption)
                                    .foregroundStyle(InsightColor.textSecondary)
                            }
                            Spacer(minLength: 4)
                            Image(systemName: "chevron.right")
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(InsightColor.textTertiary)
                        }
                        .padding(InsightSpacing.default)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(InsightListButtonStyle())
                    .accessibilityLabel("\(name)，\(summary.total) 张卡片，已掌握 \(summary.mastered) 张，打开主题")
                }
            }
        }
        .padding(.top, InsightSpacing.small)
    }

    private func dailyProgress(plan: LearningPlan) -> some View {
        HStack(spacing: InsightSpacing.medium) {
            ZStack {
                Circle().stroke(InsightColor.accentSoft, lineWidth: 5)
                Circle().trim(from: 0, to: min(1, Double(plan.completedToday) / Double(max(1, dailyGoal))))
                    .stroke(InsightColor.accent, style: StrokeStyle(lineWidth: 5, lineCap: .round)).rotationEffect(.degrees(-90))
                Text("\(Int(min(1, Double(plan.completedToday) / Double(max(1, dailyGoal))) * 100))%")
                    .font(InsightFont.monoSmall)
                    .foregroundStyle(InsightColor.textSecondary)
            }
            // 环与数字同源（rule 23 已满足）还必须同步动（共识 4：进度条跳、数字滚 = 各自动各的）
            .animation(reduceMotion ? nil : InsightMotion.value, value: plan.completedToday)
            .frame(width: 48, height: 48)
            VStack(alignment: .leading, spacing: InsightSpacing.tiny) {
                Text(plan.completedToday >= dailyGoal ? "今日目标已完成" : "今日目标")
                    .font(InsightFont.callout)
                HStack(alignment: .firstTextBaseline, spacing: InsightSpacing.hair) {
                    Text("\(plan.completedToday)")
                        .font(InsightFont.statMedium)
                        .monospacedDigit()
                        .contentTransition(.numericText())
                        .animation(reduceMotion ? nil : InsightMotion.value, value: plan.completedToday)
                    Text("/ \(dailyGoal) 张")
                        .font(InsightFont.callout)
                        .foregroundStyle(InsightColor.textTertiary)
                    Menu {
                        ForEach([3, 5, 10, 15], id: \.self) { goal in
                            Button("每天 \(goal) 张") { dailyGoal = goal }
                        }
                    } label: { Image(systemName: "slider.horizontal.3").font(.system(size: 10)) }
                    .menuStyle(.borderlessButton).fixedSize().help("调整每日目标")
                }.monospacedDigit()
            }
        }.fixedSize().help("今天阅读或复习过的不同卡片；同一卡片只计一次")
    }

    private func metrics(plan: LearningPlan) -> some View {
        HStack(spacing: InsightSpacing.xl) {
            metric("等待复习", value: plan.due.count)
            metric("已掌握", value: plan.mastered)
            metric("已收藏", value: store.favorites.count)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func metric(_ title: String, value: Int) -> some View {
        VStack(alignment: .leading, spacing: InsightSpacing.tiny) {
            Text(title).font(InsightFont.caption).foregroundStyle(InsightColor.textTertiary)
            Text("\(value)")
                .font(InsightFont.statMedium)
                .monospacedDigit()
                .contentTransition(.numericText())
                .animation(reduceMotion ? nil : InsightMotion.value, value: value)
        }.fixedSize()
    }

    private var readingFeature: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let card = store.topCard {
                let theme = CategoryTheme.theme(for: card)
                HStack {
                    Text("接下来读").font(InsightFont.callout)
                    Spacer()
                    Text(card.category).font(InsightFont.caption)
                        .foregroundStyle(InsightColor.textSecondary)
                }
                .padding(.horizontal, InsightSpacing.large)
                .padding(.vertical, InsightSpacing.default)
                GeometryReader { geometry in
                    if let image = theme.image {
                        Image(nsImage: image).resizable().scaledToFill()
                            .frame(width: geometry.size.width, height: 184).clipped()
                    } else { theme.accent.opacity(0.22) }
                }
                .frame(height: 184)
                .clipped()
                .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: InsightSpacing.default) {
                    Text(card.headline)
                        .font(InsightFont.title)
                        .allowsTightening(true)
                        .minimumScaleFactor(0.78)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(card.summary)
                        .font(InsightFont.body)
                        .foregroundStyle(InsightColor.textSecondary)
                        .lineLimit(3)
                    HStack {
                        Text("约 \(max(1, card.details.count / 350)) 分钟阅读")
                            .font(InsightFont.captionSmall)
                            .foregroundStyle(InsightColor.textTertiary)
                        Spacer()
                        Button { open(.detail(card)) } label: {
                            Label("开始阅读", systemImage: "arrow.up.right")
                                .font(InsightFont.bodyStrong)
                        }
                        .buttonStyle(PressableButtonStyle(scale: 0.98))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .foregroundStyle(.white)
                        .background(InsightColor.accent, in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous))
                    }.padding(.top, InsightSpacing.tiny)
                }.padding(InsightLayout.contentPadding)
            } else {
                InsightEmptyState(
                    icon: "checkmark.seal",
                    title: "这一轮读完了",
                    message: "复习已有知识，或导入新的笔记继续积累。",
                    actionTitle: "导入笔记",
                    action: { open(.importNotes) }
                )
                .padding(InsightSpacing.medium)
            }
        }
        .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
        .overlay(workCardBorder)
        .clipShape(RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
    }

    private func nextSteps(plan: LearningPlan) -> some View {
        VStack(alignment: .leading, spacing: InsightSpacing.large) {
            VStack(alignment: .leading, spacing: InsightSpacing.default) {
                Label("复习安排", systemImage: "arrow.triangle.2.circlepath")
                    .font(InsightFont.callout)
                    .foregroundStyle(InsightColor.textSecondary)
                HStack(alignment: .firstTextBaseline, spacing: InsightSpacing.small) {
                    Text("\(plan.due.count)").font(InsightFont.statLarge).monospacedDigit()
                    Text("张到期").font(InsightFont.callout).foregroundStyle(InsightColor.textSecondary)
                }
                Text(plan.due.isEmpty ? "今天没有到期复习，可以继续阅读。" : "先回忆，再看答案。每轮最多 10 张。")
                    .font(InsightFont.body)
                    .foregroundStyle(InsightColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                InsightButton(
                    title: plan.due.isEmpty ? "查看复习计划" : "复习 \(min(10, plan.due.count)) 张",
                    icon: "arrow.right",
                    style: .secondary
                ) {
                    if plan.due.isEmpty { show(.review) }
                    else { open(.plannedReview(Array(plan.due.prefix(10)))) }
                }
            }
            .padding(InsightSpacing.large)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(InsightColor.surfaceSunken, in: RoundedRectangle(cornerRadius: InsightRadius.card))

            VStack(alignment: .leading, spacing: InsightSpacing.tiny) {
                pathway(title: "浏览未读卡片", detail: "\(store.deck.count) 张可阅读", icon: "rectangle.stack", action: explore)
                pathway(title: "导入笔记", detail: "从自己的资料开始", icon: "square.and.arrow.down") { open(.importNotes) }
            }
        }
    }

    private func pathway(title: String, detail: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: InsightSpacing.default) {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .regular))
                    .foregroundStyle(InsightColor.textSecondary)
                    .frame(width: 20).padding(.top, 2)
                VStack(alignment: .leading, spacing: InsightSpacing.tiny) {
                    Text(title).font(InsightFont.bodyStrong).foregroundStyle(InsightColor.textPrimary)
                    Text(detail).font(InsightFont.caption).foregroundStyle(InsightColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 10, weight: .medium))
                    .foregroundStyle(InsightColor.textTertiary)
            }
            .padding(InsightSpacing.default)
            .contentShape(Rectangle())
        }.buttonStyle(InsightListButtonStyle())
    }

    // MARK: - 复习计划

    private func review(plan: LearningPlan) -> some View {
        Group {
            sectionHeading("复习计划", subtitle: "首次阅读次日复习；忘记、模糊、掌握分别间隔 1、3、7 天。")
            HStack(spacing: InsightSpacing.large) {
                metric("到期复习", value: plan.due.count)
                metric("已掌握", value: plan.mastered)
                Spacer()
                Button("开始复习 · \(min(10, plan.due.count)) 张") {
                    open(.plannedReview(Array(plan.due.prefix(10))))
                }
                .buttonStyle(PressableButtonStyle(scale: 0.98))
                .font(InsightFont.bodyStrong)
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(InsightColor.accent, in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous))
                .disabled(plan.due.isEmpty)
                .opacity(plan.due.isEmpty ? 0.45 : 1)
            }
            .padding(InsightLayout.contentPadding)
            .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
            .overlay(workCardBorder)
            if plan.due.isEmpty {
                InsightEmptyState(
                    icon: "checkmark.circle",
                    title: "现在没有到期的卡片",
                    message: "先读一些新知识，明天这里会为你安排复习。也可以随时进行自由测验。",
                    actionTitle: "自由测验",
                    action: { open(.quiz(category: nil)) }
                )
            } else {
                sectionHeading("优先回忆", subtitle: "按到期时间排序，每轮最多 10 张。先回忆，再揭晓答案。")
                LazyVStack(spacing: 0) {
                    ForEach(plan.due) { card in
                        cardRow(card, review: true)
                        if card.id != plan.due.last?.id { Divider().overlay(InsightColor.divider) }
                    }
                }
                .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card))
                .overlay(workCardBorder)
            }
            let upcoming = plan.upcomingCards(limit: plan.cards.count).filter { $0.date > plan.now }
            if !upcoming.isEmpty {
                sectionHeading("接下来的安排", subtitle: "完成复习后，根据你的回忆反馈自动调整")
                ForEach(Array(upcoming.prefix(8)), id: \.0.id) { card, date in
                    HStack {
                        Text(date.formatted(.dateTime.month().day()))
                            .font(InsightFont.monoSmall)
                            .monospacedDigit()
                            .foregroundStyle(InsightColor.accent)
                            .frame(width: 70, alignment: .leading)
                        Button(card.headline) { open(.detail(card)) }
                            .buttonStyle(.plain)
                            .font(InsightFont.body)
                            .multilineTextAlignment(.leading)
                        Spacer()
                    }.padding(.vertical, InsightSpacing.tiny)
                }
            }
        }
    }

    // MARK: - 知识库

    private var library: some View {
        let results = filteredCards
        return VStack(alignment: .leading, spacing: InsightSpacing.large) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: InsightSpacing.large) {
                    sectionHeading("知识库", subtitle: "\(store.cards.count) 张卡片，按主题、来源和学习状态整理")
                    Spacer(minLength: InsightSpacing.large)
                    libraryActions
                }
                VStack(alignment: .leading, spacing: InsightSpacing.default) {
                    sectionHeading("知识库", subtitle: "\(store.cards.count) 张卡片，按主题、来源和学习状态整理")
                    libraryActions
                }
            }
            HStack(spacing: InsightSpacing.small) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(InsightColor.textTertiary)
                TextField("搜索标题、正文或主题", text: $query)
                    .accessibilityLabel("搜索知识库")
                    .textFieldStyle(.plain)
                    .font(InsightFont.body)
                if !query.isEmpty {
                    Button { query = "" } label: { Image(systemName: "xmark.circle.fill") }
                        .buttonStyle(.plain)
                        .help("清除搜索")
                        .accessibilityLabel("清除搜索")
                }
            }
            .padding(InsightSpacing.default)
            .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous))
            .overlay(workControlBorder)
            ViewThatFits(in: .horizontal) {
                HStack { libraryFilters; Spacer(); categoryPicker }
                VStack(alignment: .leading, spacing: InsightSpacing.default) { libraryFilters; categoryPicker }
            }
            HStack {
                Text("\(results.count) 个结果")
                    .font(InsightFont.caption)
                    .foregroundStyle(InsightColor.textTertiary)
                Spacer()
                Button(newestFirst ? "最新优先 ↓" : "最早优先 ↑") { newestFirst.toggle() }
                    .buttonStyle(.plain)
                    .font(InsightFont.caption)
                Button("导出筛选结果") { open(.exportCards(results)) }
                    .buttonStyle(.plain)
                    .font(InsightFont.caption)
                    .foregroundStyle(InsightColor.accent)
                    .disabled(results.isEmpty)
            }
            if results.isEmpty {
                InsightEmptyState(
                    icon: "magnifyingglass",
                    title: "没有匹配的知识",
                    message: "试试其他关键词，或重置主题与学习状态筛选。",
                    actionTitle: "重置筛选",
                    action: { query = ""; category = "全部主题"; filter = .all }
                )
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(results) { card in
                        cardRow(card)
                        Divider().padding(.leading, 18).overlay(InsightColor.divider)
                    }
                }
                .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
                .overlay(workCardBorder)
            }
        }
    }
    private var libraryActions: some View {
        HStack(spacing: InsightSpacing.compact) {
            InsightButton(title: "剪藏网页", icon: "link") { open(.webClip) }
            InsightButton(title: "导入笔记", icon: "plus", style: .primary) { open(.importNotes) }
        }.fixedSize()
    }

    private var libraryFilters: some View {
        HStack(spacing: InsightSpacing.hair) {
            ForEach(LibraryFilter.allCases, id: \.self) { item in
                Button { filter = item } label: {
                    Text(item.rawValue)
                        .font(InsightFont.callout)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .foregroundStyle(filter == item ? InsightColor.textPrimary : InsightColor.textSecondary)
                        .background(
                            filter == item ? InsightColor.surfaceRaised : InsightColor.surfaceSunken,
                            in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
                                .strokeBorder(filter == item ? InsightColor.borderStrong : InsightColor.border, lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(filter == item ? [.isSelected] : [])
            }
        }
        .padding(InsightSpacing.hair)
        .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous))
        .overlay(workControlBorder)
    }
    private var categoryPicker: some View {
        Picker("主题", selection: $category) {
            Text("全部主题").tag("全部主题")
            ForEach(categories, id: \.self) { Text($0).tag($0) }
        }
        .labelsHidden()
        .font(InsightFont.body)
        .frame(width: 150)
        .accessibilityLabel("按主题筛选")
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
                        .resizable().scaledToFit().padding(11)
                        .foregroundStyle(theme.accent)
                }
            }
            .frame(width: 48, height: 48)
            .background(theme.accent.opacity(0.14))
            .clipShape(RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous))
            Button { open(review ? .plannedReview([card]) : .detail(card)) } label: {
                VStack(alignment: .leading, spacing: InsightSpacing.tiny) {
                    Text(card.headline)
                        .font(InsightFont.bodyStrong)
                        .foregroundStyle(InsightColor.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("\(card.category)  ·  \(card.source == .imported ? "导入笔记" : card.source == .ai ? "AI 生成" : "精选知识")  ·  \(card.masteryLevel >= 2 ? "已掌握" : card.lastReviewedAt != nil ? "待巩固" : card.seenAt == nil ? "未读" : "已读")")
                        .font(InsightFont.captionSmall)
                        .foregroundStyle(InsightColor.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
            }.buttonStyle(.plain)
            Button { store.toggleFavorite(card) } label: {
                Image(systemName: card.isFavorite ? "bookmark.fill" : "bookmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(card.isFavorite ? InsightColor.accent : InsightColor.textTertiary)
                    .padding(InsightSpacing.small)
            }.buttonStyle(.plain).help(card.isFavorite ? "取消收藏" : "收藏")
                .accessibilityLabel("\(card.isFavorite ? "取消收藏" : "收藏")：\(card.headline)")
            if !review {
                Button { open(.editCard(card)) } label: {
                    Image(systemName: "pencil")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(InsightColor.textTertiary)
                        .padding(InsightSpacing.small)
                }.buttonStyle(.plain).help("编辑卡片").accessibilityLabel("编辑：\(card.headline)")
            }
        }.padding(InsightSpacing.medium)
            .contextMenu {
                Button("编辑卡片", systemImage: "pencil") { open(.editCard(card)) }
                Button("针对这张卡片追问", systemImage: "bubble.left.and.text.bubble.right") { open(.chat(card)) }
                Button("导出这张卡片", systemImage: "square.and.arrow.up") { open(.exportCards([card])) }
            }
    }

    private func sectionHeading(_ title: String, subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: InsightSpacing.hair) {
            Text(title)
                .font(InsightFont.title)
                .accessibilityAddTraits(.isHeader)
                .fixedSize(horizontal: false, vertical: true)
            Text(subtitle)
                .font(InsightFont.callout)
                .foregroundStyle(InsightColor.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // Cutline 卡片签名：1pt 描边（内容卡与控件两个规格）
    private var workCardBorder: some View {
        RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous)
            .strokeBorder(InsightColor.border, lineWidth: 1)
    }
    private var workControlBorder: some View {
        RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
            .strokeBorder(InsightColor.border, lineWidth: 1)
    }
}
