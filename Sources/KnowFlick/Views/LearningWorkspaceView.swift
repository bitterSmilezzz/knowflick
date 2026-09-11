import SwiftUI
import KnowFlickCore

/// Native learning home. The library and plan stay in the window; reading stays focused.
struct LearningWorkspaceView: View {
    @Bindable var store: AppStore
    let open: (ActiveSheet) -> Void
    let explore: () -> Void
    @AppStorage("learning.dailyGoal") private var dailyGoal = 5
    @AppStorage("learning.sidebarExpanded") private var sidebarExpanded = true
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
        TimelineView(.periodic(from: .now, by: 60)) { context in
            let plan = LearningPlan(cards: store.cards, now: context.date)
            GeometryReader { geometry in
                HStack(spacing: 0) {
                    sidebar(expanded: sidebarExpanded && geometry.size.width >= 900, plan: plan)
                    VStack(spacing: 0) {
                        header
                        Divider().overlay(EditorialColor.glassDivider)
                        ScrollView {
                            VStack(alignment: .leading, spacing: 26) {
                                switch section {
                                case .today: today(plan: plan, wide: geometry.size.width >= 960)
                                case .review: review(plan: plan)
                                case .library: library
                                }
                            }
                            .padding(28)
                            .frame(maxWidth: 1200, alignment: .leading)
                            .frame(maxWidth: .infinity)
                        }
                        .id(section)
                    }
                }
            }
        }
        .background(EditorialColor.canvasDark)
        .foregroundStyle(EditorialColor.textPrimary)
    }

    private func sidebar(expanded: Bool, plan: LearningPlan) -> some View {
        VStack(alignment: expanded ? .leading : .center, spacing: 24) {
            HStack(spacing: 10) {
                Text("K").font(.system(size: 26, weight: .bold, design: .serif))
                    .foregroundStyle(EditorialColor.aiAmber)
                    .frame(width: 38, height: 40)
                    .background(EditorialColor.aiAmberBg, in: RoundedRectangle(cornerRadius: 12))
                if expanded {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("KnowFlick").font(.system(size: 17, weight: .semibold, design: .serif))
                        Text("个人学习工作台").font(.system(size: 10)).foregroundStyle(EditorialColor.textTertiary)
                    }
                }
            }
            VStack(spacing: 6) {
                ForEach(Section.allCases, id: \.self) { item in
                    Button { section = item } label: {
                        HStack(spacing: 12) {
                            Image(systemName: item.icon).font(.system(size: 17)).frame(width: 24)
                            if expanded {
                                Text(item.rawValue).font(.system(size: 13, weight: .medium))
                                Spacer(minLength: 0)
                                if item == .review && !plan.due.isEmpty {
                                    Text("\(plan.due.count)").font(.system(size: 10, weight: .semibold, design: .monospaced))
                                }
                            }
                        }
                        .foregroundStyle(section == item ? EditorialColor.aiAmber : EditorialColor.textSecondary)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: expanded ? .leading : .center)
                        .background(section == item ? EditorialColor.aiAmberBg : .clear, in: RoundedRectangle(cornerRadius: 10))
                    }.buttonStyle(PressableButtonStyle()).help(item.rawValue)
                        .accessibilityLabel(item.rawValue)
                        .accessibilityValue(section == item ? "当前页面" : "")
                }
            }
            Divider()
            sideAction("沉浸刷卡", icon: "rectangle.stack", expanded: expanded, action: explore)
            sideAction("导入笔记", icon: "square.and.arrow.down", expanded: expanded) { open(.importNotes) }
            sideAction("知识星图", icon: "point.3.connected.trianglepath.dotted", expanded: expanded) { open(.graph) }
            Spacer(minLength: 16)
            if expanded {
                VStack(alignment: .leading, spacing: 8) {
                    Text("积累，是看得见的。") .font(.system(size: 12, weight: .medium, design: .serif))
                    Text("\(store.cards.count) 张知识卡片 · \(categories.count) 个主题")
                        .font(.system(size: 10)).foregroundStyle(EditorialColor.textTertiary)
                }.padding(.horizontal, 10)
            }
            sideAction("知识收藏阁", icon: "bookmark", expanded: expanded) { open(.favorites) }
            sideAction("偏好设置", icon: "slider.horizontal.3", expanded: expanded) { open(.settings) }
            if expanded {
                // 窄窗口会自动折叠导航，此时该按钮改变不了状态，故只在展开时可用。
                Button { sidebarExpanded.toggle() } label: {
                    Image(systemName: "sidebar.left").frame(maxWidth: .infinity, alignment: .leading)
                }.buttonStyle(.plain).padding(.horizontal, 14).help("折叠导航")
            }
        }
        .padding(.horizontal, 14).padding(.top, 34).padding(.bottom, 22)
        .frame(width: expanded ? 200 : 72)
        .background(EditorialColor.glassSurface.opacity(0.6))
        .overlay(alignment: .trailing) { Rectangle().fill(EditorialColor.glassDivider).frame(width: 1) }
    }

    private func sideAction(_ title: String, icon: String, expanded: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.system(size: 16)).frame(width: 24)
                if expanded { Text(title).font(.system(size: 12)); Spacer(minLength: 0) }
            }.foregroundStyle(EditorialColor.textSecondary).padding(.horizontal, 12)
        }.buttonStyle(PressableButtonStyle()).help(title).accessibilityLabel(title)
    }

    private var header: some View {
        HStack {
            Text(section.rawValue).font(.system(size: 13, weight: .semibold))
            Text("/  学习空间").font(.system(size: 12)).foregroundStyle(EditorialColor.textTertiary)
            Spacer()
            Button { open(.search) } label: { Label("搜索知识  ⌘F", systemImage: "magnifyingglass") }
                .buttonStyle(.plain).font(.system(size: 12)).foregroundStyle(EditorialColor.textSecondary)
            Menu {
                Button("学习统计") { open(.stats) }
                Button("历史记录") { open(.history) }
                Button("导出知识库") { open(.exportCards(nil)) }
                Button("快捷键帮助") { open(.help) }
            } label: { Image(systemName: "ellipsis").padding(8) }
            .menuStyle(.borderlessButton).fixedSize().help("更多功能")
        }.padding(.horizontal, 28).padding(.vertical, 23)
    }

    private func today(plan: LearningPlan, wide: Bool) -> some View {
        Group {
            VStack(alignment: .leading, spacing: 8) {
                Text(Date.now.formatted(.dateTime.month(.wide).day().weekday(.wide)))
                    .font(.system(size: 11, weight: .medium)).foregroundStyle(EditorialColor.textTertiary)
                Text("把好奇，变成自己的知识。")
                    .font(.system(size: 29, weight: .semibold, design: .serif)).tracking(-0.7)
                    .fixedSize(horizontal: false, vertical: true)
                Text("读一点新知，回忆一次旧知。今天从这里继续。")
                    .font(.system(size: 13)).foregroundStyle(EditorialColor.textSecondary)
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 24) { dailyProgress(plan: plan); Divider().frame(height: 44); metrics(plan: plan) }
                VStack(alignment: .leading, spacing: 20) { dailyProgress(plan: plan); metrics(plan: plan) }
            }.padding(22).background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 18))
            if wide {
                HStack(alignment: .top, spacing: 22) {
                    readingFeature.frame(maxWidth: .infinity)
                    nextSteps(plan: plan).frame(width: 245)
                }
            } else {
                readingFeature
                nextSteps(plan: plan)
            }
            HStack {
                sectionHeading("你的知识版图", subtitle: "按主题进入，看看哪些已经掌握")
                Spacer()
                Button("查看全部 →") { section = .library }.buttonStyle(.plain).font(.system(size: 12)).foregroundStyle(EditorialColor.aiAmber)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 170), spacing: 14)], spacing: 14) {
                ForEach(Array(categories.prefix(8)), id: \.self) { name in
                    let cards = store.cards.filter { $0.category == name }
                    Button {
                        category = name; filter = .all; section = .library
                    } label: {
                        VStack(alignment: .leading, spacing: 14) {
                            HStack {
                                Image(systemName: CategoryTheme.theme(for: name).iconName).foregroundStyle(EditorialColor.aiAmber)
                                Spacer()
                                Text("\(cards.count)").monospacedDigit().foregroundStyle(EditorialColor.textTertiary)
                            }
                            Text(name).font(.system(size: 15, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
                            ProgressView(value: Double(cards.filter { $0.masteryLevel >= 2 }.count), total: Double(max(1, cards.count)))
                                .tint(EditorialColor.aiAmber)
                            Text("已掌握 \(cards.filter { $0.masteryLevel >= 2 }.count) 张").font(.system(size: 10)).foregroundStyle(EditorialColor.textTertiary)
                        }.padding(18).frame(maxWidth: .infinity, alignment: .leading)
                            .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 14))
                    }.buttonStyle(PressableButtonStyle())
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(name)，\(cards.count) 张卡片，打开主题")
                }
            }
        }
    }

    private func dailyProgress(plan: LearningPlan) -> some View {
        HStack(spacing: 16) {
            ZStack {
                Circle().stroke(EditorialColor.aiAmberBg, lineWidth: 5)
                Circle().trim(from: 0, to: min(1, Double(plan.completedToday) / Double(max(1, dailyGoal))))
                    .stroke(EditorialColor.aiAmber, style: StrokeStyle(lineWidth: 5, lineCap: .round)).rotationEffect(.degrees(-90))
                Image(systemName: plan.completedToday >= dailyGoal ? "checkmark" : "sun.max").foregroundStyle(EditorialColor.aiAmber)
            }.frame(width: 48, height: 48)
            VStack(alignment: .leading, spacing: 5) {
                Text(plan.completedToday >= dailyGoal ? "今日目标已完成" : "今日目标").font(.system(size: 12, weight: .semibold))
                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text("\(plan.completedToday)").font(.system(size: 25, weight: .medium, design: .rounded))
                    Text("/ \(dailyGoal) 张").font(.system(size: 12)).foregroundStyle(EditorialColor.textTertiary)
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
        HStack(spacing: 28) {
            metric("等待复习", value: plan.due.count)
            metric("已掌握", value: plan.mastered)
            metric("已收藏", value: store.favorites.count)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func metric(_ title: String, value: Int) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title).font(.system(size: 11)).foregroundStyle(EditorialColor.textTertiary)
            Text("\(value)").font(.system(size: 24, weight: .medium, design: .rounded)).monospacedDigit()
        }.fixedSize()
    }

    private var readingFeature: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let card = store.topCard {
                let theme = CategoryTheme.theme(for: card)
                ZStack(alignment: .bottomLeading) {
                    GeometryReader { geometry in
                        if let image = theme.image {
                            Image(nsImage: image).resizable().scaledToFill().frame(width: geometry.size.width, height: 148).clipped()
                        } else { EditorialColor.aiAmberBg }
                    }
                    LinearGradient(colors: [.clear, .black.opacity(0.65)], startPoint: .top, endPoint: .bottom)
                    HStack {
                        Label("接下来读", systemImage: "book.pages").font(.system(size: 11, weight: .semibold))
                        Spacer()
                        Text(card.category).font(.system(size: 11))
                    }.foregroundStyle(.white).padding(20)
                }.frame(height: 148).clipped()
                VStack(alignment: .leading, spacing: 12) {
                    Text(card.headline).font(.system(size: 22, weight: .semibold, design: .serif))
                        .fixedSize(horizontal: false, vertical: true)
                    Text(card.summary).font(.system(size: 12)).foregroundStyle(EditorialColor.textSecondary)
                        .lineLimit(3)
                    HStack {
                        Text("约 \(max(1, card.details.count / 350)) 分钟阅读").font(.system(size: 10)).foregroundStyle(EditorialColor.textTertiary)
                        Spacer()
                        Button { open(.detail(card)) } label: { Label("开始阅读", systemImage: "arrow.up.right") }
                            .buttonStyle(.borderedProminent).tint(EditorialColor.aiAmber)
                    }.padding(.top, 4)
                }.padding(22)
            } else {
                ContentUnavailableView("这一轮读完了", systemImage: "checkmark.seal", description: Text("复习已有知识，或导入新的笔记继续积累。"))
                    .padding(20)
                Button("导入笔记") { open(.importNotes) }.padding(20)
            }
        }.background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 18))
            .clipShape(RoundedRectangle(cornerRadius: 18))
    }

    private func nextSteps(plan: LearningPlan) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            sectionHeading("学习路径", subtitle: "从输入，到真正记住")
            pathway("01", title: "探索新知识", detail: "\(store.deck.count) 张未读卡片", icon: "arrow.right", action: explore)
            Divider()
            pathway("02", title: "回忆与巩固", detail: plan.due.isEmpty ? "目前没有到期复习" : "\(plan.due.count) 张已到复习时间", icon: "arrow.right") {
                section = .review
            }
            Divider()
            pathway("03", title: "整理自己的知识", detail: "把笔记转成可阅读、可复习的卡片", icon: "plus") { open(.importNotes) }
        }.padding(22).background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 18))
    }
    private func pathway(_ number: String, title: String, detail: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                Text(number).font(.system(size: 11, design: .monospaced)).foregroundStyle(EditorialColor.aiAmber).padding(.top, 2)
                VStack(alignment: .leading, spacing: 6) {
                    Text(title).font(.system(size: 13, weight: .semibold))
                    Text(detail).font(.system(size: 11)).foregroundStyle(EditorialColor.textTertiary).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Image(systemName: icon).font(.system(size: 11)).foregroundStyle(EditorialColor.textTertiary)
            }
        }.buttonStyle(PressableButtonStyle())
    }

    private func review(plan: LearningPlan) -> some View {
        Group {
            sectionHeading("让知识留下来。", subtitle: "首次阅读次日复习；忘记、模糊、掌握分别间隔 1、3、7 天。")
            HStack(spacing: 24) {
                metric("到期复习", value: plan.due.count)
                metric("已掌握", value: plan.mastered)
                Spacer()
                Button("开始复习 · \(min(10, plan.due.count)) 张") {
                    open(.plannedReview(Array(plan.due.prefix(10))))
                }.buttonStyle(.borderedProminent).tint(EditorialColor.aiAmber).disabled(plan.due.isEmpty)
            }.padding(24).background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 18))
            if plan.due.isEmpty {
                ContentUnavailableView("现在没有到期的卡片", systemImage: "checkmark.circle", description: Text("先读一些新知识，明天这里会为你安排复习。也可以随时进行自由测验。"))
                Button("自由测验") { open(.quiz(category: nil)) }.buttonStyle(.bordered)
            } else {
                sectionHeading("优先回忆", subtitle: "按到期时间排序，每轮最多 10 张。先回忆，再揭晓答案。")
                ForEach(plan.due) { card in cardRow(card, review: true) }
            }
            let upcoming = store.cards.compactMap { card -> (KnowledgeCard, Date)? in
                guard let date = LearningPlan.reviewDate(for: card), date > Date.now else { return nil }
                return (card, date)
            }.sorted { $0.1 < $1.1 }
            if !upcoming.isEmpty {
                sectionHeading("接下来的安排", subtitle: "完成复习后，根据你的回忆反馈自动调整")
                ForEach(Array(upcoming.prefix(8)), id: \.0.id) { card, date in
                    HStack {
                        Text(date.formatted(.dateTime.month().day())).font(.system(size: 12, design: .monospaced)).foregroundStyle(EditorialColor.aiAmber).frame(width: 70, alignment: .leading)
                        Button(card.headline) { open(.detail(card)) }.buttonStyle(.plain).multilineTextAlignment(.leading)
                        Spacer()
                    }.padding(.vertical, 8)
                }
            }
        }
    }

    private var library: some View {
        let results = filteredCards
        return VStack(alignment: .leading, spacing: 22) {
            HStack {
                sectionHeading("知识，是自己的。", subtitle: "\(store.cards.count) 张卡片，按主题、来源和学习状态整理")
                Spacer()
                Button { open(.importNotes) } label: { Label("导入笔记", systemImage: "plus") }
                    .buttonStyle(.borderedProminent).tint(EditorialColor.aiAmber)
            }
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(EditorialColor.textTertiary)
                TextField("搜索标题、正文或主题", text: $query).textFieldStyle(.plain)
                if !query.isEmpty { Button { query = "" } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.plain).help("清除搜索") }
            }.padding(14).background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 10))
            ViewThatFits(in: .horizontal) {
                HStack { libraryFilters; Spacer(); categoryPicker }
                VStack(alignment: .leading, spacing: 12) { libraryFilters; categoryPicker }
            }
            HStack {
                Text("\(results.count) 个结果").font(.system(size: 11)).foregroundStyle(EditorialColor.textTertiary)
                Spacer()
                Button(newestFirst ? "最新优先 ↓" : "最早优先 ↑") { newestFirst.toggle() }.buttonStyle(.plain).font(.system(size: 11))
                Button("导出筛选结果") { open(.exportCards(results)) }.buttonStyle(.plain).font(.system(size: 11)).foregroundStyle(EditorialColor.aiAmber).disabled(results.isEmpty)
            }
            if results.isEmpty {
                ContentUnavailableView("没有匹配的知识", systemImage: "magnifyingglass", description: Text("试试其他关键词，或重置主题与学习状态筛选。"))
                Button("重置筛选") { query = ""; category = "全部主题"; filter = .all }
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(results) { card in
                        cardRow(card)
                        Divider().padding(.leading, 18)
                    }
                }.background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 14))
            }
        }
    }
    private var libraryFilters: some View {
        HStack(spacing: 4) {
            ForEach(LibraryFilter.allCases, id: \.self) { item in
                Button { filter = item } label: {
                    Text(item.rawValue).font(.system(size: 12, weight: .medium)).padding(.horizontal, 12).padding(.vertical, 7)
                        .foregroundStyle(filter == item ? EditorialColor.aiAmber : EditorialColor.textSecondary)
                        .background(filter == item ? EditorialColor.aiAmberBg : .clear, in: RoundedRectangle(cornerRadius: 7))
                }.buttonStyle(.plain)
            }
        }.fixedSize()
    }
    private var categoryPicker: some View {
        Picker("主题", selection: $category) {
            Text("全部主题").tag("全部主题")
            ForEach(categories, id: \.self) { Text($0).tag($0) }
        }.labelsHidden().frame(width: 150).accessibilityLabel("按主题筛选")
    }
    private func cardRow(_ card: KnowledgeCard, review: Bool = false) -> some View {
        HStack(spacing: 16) {
            Image(systemName: CategoryTheme.theme(for: card).iconName)
                .font(.system(size: 19)).foregroundStyle(EditorialColor.aiAmber)
                .frame(width: 42, height: 48).background(EditorialColor.aiAmberBg, in: RoundedRectangle(cornerRadius: 8))
            Button { open(review ? .plannedReview([card]) : .detail(card)) } label: {
                VStack(alignment: .leading, spacing: 6) {
                    Text(card.headline).font(.system(size: 14, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
                    Text("\(card.category)  ·  \(card.source == .imported ? "导入笔记" : card.source == .ai ? "AI 生成" : "精选知识")  ·  \(card.masteryLevel >= 2 ? "已掌握" : card.lastReviewedAt != nil ? "待巩固" : card.seenAt == nil ? "未读" : "已读")")
                        .font(.system(size: 10)).foregroundStyle(EditorialColor.textTertiary).fixedSize(horizontal: false, vertical: true)
                }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
            }.buttonStyle(.plain)
            Button { store.toggleFavorite(card) } label: {
                Image(systemName: card.isFavorite ? "bookmark.fill" : "bookmark").foregroundStyle(EditorialColor.aiAmber).padding(7)
            }.buttonStyle(.plain).help(card.isFavorite ? "取消收藏" : "收藏")
            if !review {
                Button { open(.editCard(card)) } label: {
                    Image(systemName: "pencil").foregroundStyle(EditorialColor.textTertiary).padding(7)
                }.buttonStyle(.plain).help("编辑卡片").accessibilityLabel("编辑：\(card.headline)")
            }
        }.padding(18)
            .contextMenu {
                Button("编辑卡片", systemImage: "pencil") { open(.editCard(card)) }
                Button("针对这张卡片追问", systemImage: "bubble.left.and.text.bubble.right") { open(.chat(card)) }
                Button("导出这张卡片", systemImage: "square.and.arrow.up") { open(.exportCards([card])) }
            }
    }
    private func sectionHeading(_ title: String, subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title).font(.system(size: 20, weight: .semibold, design: .serif)).fixedSize(horizontal: false, vertical: true)
            Text(subtitle).font(.system(size: 12)).foregroundStyle(EditorialColor.textTertiary).fixedSize(horizontal: false, vertical: true)
        }
    }
}
