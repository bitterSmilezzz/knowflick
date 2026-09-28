import SwiftUI
import AppKit
import UniformTypeIdentifiers
import KnowFlickCore

// MARK: - 侧栏各视图的内容区（Cutline 式）
//
// 每个视图统一形态：顶栏（标题 + 描述 + 右侧操作）+ 主体（卡片网格 / 列表 / 统计块）。
// 收藏与统计已自旧面板（FavoritesView / StatsView，归档于 Views/_archived/）完成功能平移；
// 历史目的地仍是轻量框架，完整筛选版 HistoryView 只从统计页分类下钻局部打开。

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

/// 收藏阁（Cutline 形态）：分类筛选 + 全文搜索 + 每卡操作（详情 / 海报 / 编辑 / 追问 / 移出收藏）
/// + 笔记导出（导出中心 / 剪贴板 / .md 文件）+ 分类测验。
/// 功能自旧 FavoritesView 平移；数据写入全部走 AppStore 意图化方法（toggleFavorite / exportFavoritesMarkdown）。
struct InsightFavoritesPlaceholder: View {
    @Bindable var store: AppStore
    var onOpenSheet: (ActiveSheet) -> Void

    @State private var selectedCategory: String? = nil
    @State private var searchText: String = ""
    @State private var sharePosterCard: KnowledgeCard? = nil
    @State private var toast = ToastCenter()

    // MARK: 派生数据（与旧 FavoritesView 同口径）

    /// 所有已收藏卡片按分类统计（按数量降序）
    private var categoryCounts: [(category: String, count: Int)] {
        var counts: [String: Int] = [:]
        for card in store.favorites {
            counts[card.category, default: 0] += 1
        }
        return counts
            .map { ($0.key, $0.value) }
            .sorted { $0.count > $1.count }
    }

    /// 经过分类与搜索过滤后的收藏列表
    private var filteredCards: [KnowledgeCard] {
        store.favorites.filter { card in
            let matchesCategory = selectedCategory == nil || card.category == selectedCategory
            let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let matchesSearch = query.isEmpty ||
                card.headline.lowercased().contains(query) ||
                card.summary.lowercased().contains(query) ||
                card.details.lowercased().contains(query) ||
                card.category.lowercased().contains(query)
            return matchesCategory && matchesSearch
        }
    }

    /// 导出范围：有筛选时导出筛选结果，否则导出全部收藏
    private var exportScope: [KnowledgeCard] {
        (selectedCategory != nil || !searchText.isEmpty) ? filteredCards : store.favorites
    }

    var body: some View {
        InsightContentScaffold(
            title: "收藏",
            subtitle: subtitle,
            actions: { toolbar }
        ) {
            Group {
                if store.favorites.isEmpty {
                    InsightEmptyState(
                        icon: "heart",
                        title: "还没有收藏",
                        message: "刷卡时右滑，或按 → 键把感兴趣的卡片收进这里。"
                    )
                } else if filteredCards.isEmpty {
                    InsightEmptyState(
                        icon: "magnifyingglass",
                        title: "未找到相关知识笔记",
                        message: "试试其他关键词，或重置分类与搜索筛选。",
                        actionTitle: "清空搜索筛选",
                        action: {
                            withAnimation(InsightMotion.card) {
                                searchText = ""
                                selectedCategory = nil
                            }
                        }
                    )
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: InsightSpacing.default) {
                            filterBar
                            LazyVGrid(
                                columns: [GridItem(.adaptive(minimum: InsightLayout.gridMinColumn), spacing: InsightSpacing.compact)],
                                spacing: InsightSpacing.compact
                            ) {
                                ForEach(filteredCards) { card in
                                    favoriteCardItem(card)
                                }
                            }
                        }
                        .padding(.horizontal, InsightLayout.contentPadding)
                        .padding(.bottom, InsightSpacing.large)
                    }
                }
            }
        }
        .overlay {
            if let pc = sharePosterCard {
                CardPosterExportSheet(card: pc) {
                    sharePosterCard = nil
                }
                .transition(.opacity.combined(with: .scale(scale: 0.98)))
            }
        }
        .overlay(alignment: .top) {
            EditorialToast(center: toast, edge: .top)
                .padding(.top, 14)
        }
    }

    private var subtitle: String {
        store.favorites.isEmpty
            ? "刷卡时右滑，心仪知识沉淀于此"
            : "\(store.favorites.count) 张已收藏 · 支持分类筛选与笔记导出"
    }

    // MARK: 顶栏右侧操作（分类测验 + 笔记导出）

    private var toolbar: some View {
        HStack(spacing: InsightSpacing.compact) {
            // 开启测验：generateQuizCards 本就收藏优先，传入分类则在该分类内抽题
            Button {
                onOpenSheet(.quiz(category: selectedCategory))
            } label: {
                HStack(spacing: InsightSpacing.small) {
                    Image(systemName: "graduationcap.fill")
                        .font(.system(size: 11.5, weight: .bold))
                    Text(selectedCategory != nil ? "\(selectedCategory!)测验" : "开启测验")
                        .font(InsightFont.callout)
                }
                .foregroundStyle(Color.white)
                .padding(.horizontal, 13)
                .padding(.vertical, 7)
                .background(InsightColor.warning, in: Capsule())
            }
            .buttonStyle(PressableButtonStyle())
            .disabled(store.favorites.isEmpty)
            .help(selectedCategory != nil ? "针对 \(selectedCategory!) 分类抽题（收藏优先）" : "优先从收藏阁抽题，不足时并入历史与全库")

            // 导出 Markdown 笔记菜单
            Menu {
                Button {
                    onOpenSheet(.exportCards(exportScope))
                } label: {
                    Label("卡片批量导出中心 (Markdown/Obsidian/Anki/JSON)…", systemImage: "square.and.arrow.up.fill")
                }

                Divider()

                Button {
                    copyMarkdown(filteredOnly: false)
                } label: {
                    Label("快速复制全部收藏 Markdown (\(store.favorites.count) 篇)", systemImage: "doc.on.doc")
                }

                if selectedCategory != nil || !searchText.isEmpty {
                    Button {
                        copyMarkdown(filteredOnly: true)
                    } label: {
                        Label("复制当前筛选 Markdown (\(filteredCards.count) 篇)", systemImage: "doc.text.magnifyingglass")
                    }
                }

                Divider()

                Button {
                    saveMarkdownToFile(filteredOnly: false)
                } label: {
                    Label("导出全部笔记为 .md 文件...", systemImage: "arrow.down.doc")
                }

                if selectedCategory != nil || !searchText.isEmpty {
                    Button {
                        saveMarkdownToFile(filteredOnly: true)
                    } label: {
                        Label("导出当前筛选为 .md 文件...", systemImage: "arrow.down.doc.fill")
                    }
                }
            } label: {
                HStack(spacing: InsightSpacing.small) {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 12, weight: .bold))
                    Text("导出笔记")
                        .font(InsightFont.callout)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 9, weight: .semibold))
                        .opacity(0.7)
                }
                .foregroundStyle(InsightColor.textPrimary)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(InsightColor.surface, in: Capsule())
                .overlay(Capsule().strokeBorder(InsightColor.borderStrong, lineWidth: 1))
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            // 收藏阁为空时菜单内动作全部无产出：直接禁用入口，避免空点击
            .disabled(store.favorites.isEmpty)
            .help(store.favorites.isEmpty ? "收藏阁暂无内容，无可导出的笔记" : "导出至 Obsidian / Notion 等笔记工具")
        }
    }

    // MARK: 筛选与搜索工具条

    private var filterBar: some View {
        VStack(alignment: .leading, spacing: InsightSpacing.compact) {
            HStack(spacing: InsightSpacing.small) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(InsightColor.textMuted)

                TextField("搜索知识标题、观点或内容...", text: $searchText)
                    .textFieldStyle(.plain)
                    .font(InsightFont.body)
                    .foregroundStyle(InsightColor.textPrimary)

                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 12))
                            .foregroundStyle(InsightColor.textMuted)
                    }
                    .buttonStyle(.plain)
                    .help("清除搜索")
                    .accessibilityLabel("清除搜索")
                }

                Spacer(minLength: 0)

                Text("共 \(filteredCards.count) 条笔记")
                    .font(InsightFont.captionSmall)
                    .foregroundStyle(InsightColor.textTertiary)
            }
            .padding(.horizontal, InsightSpacing.default)
            .padding(.vertical, InsightSpacing.small)
            .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
                    .strokeBorder(InsightColor.border, lineWidth: 1)
            )

            // 分类胶囊栏（横向滚动，按数量降序，可再点取消）
            if !categoryCounts.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: InsightSpacing.small) {
                        categoryPill(
                            title: "全部",
                            count: store.favorites.count,
                            iconName: nil,
                            accent: InsightColor.textPrimary,
                            isSelected: selectedCategory == nil
                        ) {
                            withAnimation(InsightMotion.card) { selectedCategory = nil }
                        }

                        ForEach(categoryCounts, id: \.category) { item in
                            let spec = CategoryTheme.visualSpec(for: item.category)
                            categoryPill(
                                title: item.category,
                                count: item.count,
                                iconName: spec.iconName,
                                accent: spec.accent,
                                isSelected: selectedCategory == item.category
                            ) {
                                withAnimation(InsightMotion.card) {
                                    selectedCategory = selectedCategory == item.category ? nil : item.category
                                }
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }

    private func categoryPill(
        title: String,
        count: Int,
        iconName: String?,
        accent: Color,
        isSelected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: InsightSpacing.small) {
                if let iconName {
                    Image(systemName: iconName)
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(isSelected ? Color.black.opacity(0.88) : accent)
                }
                Text(title)
                    .font(InsightFont.caption.weight(isSelected ? .bold : .medium))
                    .foregroundStyle(isSelected ? Color.black.opacity(0.88) : InsightColor.textPrimary)
                Text("\(count)")
                    .font(InsightFont.captionSmall.weight(.semibold))
                    .foregroundStyle(isSelected ? Color.black.opacity(0.65) : InsightColor.textMuted)
            }
            .padding(.horizontal, 11)
            .padding(.vertical, 5)
            .background(isSelected ? accent : InsightColor.surface, in: Capsule())
            .overlay(
                Capsule().strokeBorder(
                    isSelected ? Color.white.opacity(0.3) : (iconName != nil ? accent.opacity(0.35) : InsightColor.border),
                    lineWidth: 1
                )
            )
        }
        .buttonStyle(PressableButtonStyle(scale: 0.96))
    }

    // MARK: 收藏卡（每卡操作：详情 / 海报 / 编辑 / 追问 / 移出收藏）

    private func favoriteCardItem(_ card: KnowledgeCard) -> some View {
        let spec = CategoryTheme.visualSpec(for: card)
        let theme = CategoryTheme.theme(for: card, cache: .shared)
        return InsightCard(padding: InsightSpacing.default) {
            VStack(alignment: .leading, spacing: InsightSpacing.small) {
                // 缩略图：与刷卡 / 知识库同源的分类摄影底图
                GeometryReader { geo in
                    Group {
                        if let image = theme.image {
                            Image(nsImage: image)
                                .resizable()
                                .scaledToFill()
                                .frame(width: geo.size.width, height: geo.size.height)
                                .clipped()
                        } else {
                            spec.accent.opacity(0.22)
                        }
                    }
                }
                .frame(height: 84)
                .clipShape(RoundedRectangle(cornerRadius: InsightRadius.inset, style: .continuous))

                // 头部行：分类 + AI 标记 + 收藏时间 + 取消收藏心形
                HStack(spacing: InsightSpacing.small) {
                    HStack(spacing: InsightSpacing.tiny) {
                        Image(systemName: spec.iconName)
                            .font(.system(size: 9.5, weight: .bold))
                        Text(card.category)
                            .font(InsightFont.captionSmall.weight(.bold))
                    }
                    .foregroundStyle(spec.accent)

                    if card.source == .ai && store.settings.showAIMark {
                        InsightPill(text: "AI", tone: .warning)
                    }

                    Spacer(minLength: 0)

                    // 收藏时间（不是浏览时间）：口径与列表排序的 favoritedAt 同源
                    if let favoritedAt = card.favoritedAt ?? card.seenAt {
                        Text(favoritedAt.formatted(date: .abbreviated, time: .omitted))
                            .font(InsightFont.captionSmall)
                            .foregroundStyle(InsightColor.textMuted)
                            .help("收藏时间")
                    }

                    // 取消收藏快捷心形
                    Button {
                        removeFromFavorites(card)
                    } label: {
                        Image(systemName: "heart.fill")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(InsightColor.success)
                            .frame(width: 24, height: 24)
                    }
                    .buttonStyle(PressableButtonStyle(scale: 0.9))
                    .help("取消收藏")
                }

                Text(card.headline)
                    .font(InsightFont.headline)
                    .foregroundStyle(InsightColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)

                Text(card.summary)
                    .font(InsightFont.caption)
                    .foregroundStyle(InsightColor.textSecondary)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: InsightSpacing.small) {
                    tileAction(icon: "book.pages", title: "详情") {
                        onOpenSheet(.detail(card))
                    }
                    tileAction(icon: "photo.on.rectangle.angled", title: "海报") {
                        sharePosterCard = card
                    }
                    Spacer(minLength: 0)
                }
                .padding(.top, InsightSpacing.tiny)
            }
        }
        .contextMenu {
            Button {
                onOpenSheet(.detail(card))
            } label: {
                Label("查看详情", systemImage: "arrow.up.left.and.arrow.down.right")
            }
            Button {
                sharePosterCard = card
            } label: {
                Label("生成分享海报...", systemImage: "square.and.arrow.up")
            }
            Button {
                onOpenSheet(.editCard(card))
            } label: {
                Label("编辑卡片", systemImage: "pencil")
            }
            Button {
                onOpenSheet(.chat(card))
            } label: {
                Label("向卡片追问 (AI 伴学)", systemImage: "sparkles")
            }
            Divider()
            Button {
                removeFromFavorites(card)
            } label: {
                Label("移出收藏阁", systemImage: "heart.slash")
            }
        }
    }

    private func tileAction(icon: String, title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: InsightSpacing.tiny) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .semibold))
                Text(title)
                    .font(InsightFont.callout)
            }
            .foregroundStyle(InsightColor.textSecondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(InsightColor.surfaceSunken, in: Capsule())
            .overlay(Capsule().strokeBorder(InsightColor.border, lineWidth: 1))
        }
        .buttonStyle(PressableButtonStyle(scale: 0.96))
    }

    /// 取消收藏：只翻转 isFavorite，不改写 swiped（收藏与喜好解耦，见 CONTEXT.md）
    private func removeFromFavorites(_ card: KnowledgeCard) {
        withAnimation(InsightMotion.pill) {
            store.toggleFavorite(card)
            toast.show("已将《\(card.headline)》移出收藏阁")
        }
    }

    // MARK: 笔记导出动作（与旧 FavoritesView 同源：store.exportFavoritesMarkdown）

    private func copyMarkdown(filteredOnly: Bool) {
        let exportList = filteredOnly ? filteredCards : store.favorites
        guard !exportList.isEmpty else { return }
        let md = store.exportFavoritesMarkdown(filtered: exportList)

        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(md, forType: .string)

        toast.show("已复制 \(exportList.count) 篇知识笔记 (Markdown) 至剪贴板")
    }

    private func saveMarkdownToFile(filteredOnly: Bool) {
        let exportList = filteredOnly ? filteredCards : store.favorites
        guard !exportList.isEmpty else { return }
        let md = store.exportFavoritesMarkdown(filtered: exportList)

        let savePanel = NSSavePanel()
        let mdType = UTType(filenameExtension: "md") ?? .plainText
        savePanel.allowedContentTypes = [mdType]
        savePanel.canCreateDirectories = true
        savePanel.isExtensionHidden = false

        let dateStr = Date().formatted(.iso8601.year().month().day().dateSeparator(.dash))
        let filterSuffix = filteredOnly && selectedCategory != nil ? "_\(selectedCategory!)" : ""
        savePanel.nameFieldStringValue = "KnowFlick_Favorites\(filterSuffix)_\(dateStr).md"
        savePanel.title = "导出知识笔记"
        savePanel.prompt = "导出"

        let targetWindow = NSApp.keyWindow ?? NSApp.mainWindow

        PanelPresenter.present(savePanel, in: targetWindow) { response in
            if response == .OK, let url = savePanel.url {
                do {
                    try md.write(to: url, atomically: true, encoding: .utf8)
                    toast.show("已成功导出笔记至 \(url.lastPathComponent)")
                } catch {
                    toast.show("导出失败：\(error.localizedDescription)", style: .failure)
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

    /// 相对时间格式化器（静态单例）：原实现每行都新建一个 RelativeDateTimeFormatter，
    /// 80 行列表就是 80 次格式化器构造
    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter
    }()

    private func relativeTime(_ date: Date) -> String {
        Self.relativeFormatter.localizedString(for: date, relativeTo: Date())
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

/// 统计页（Cutline 形态）：总览行 + 掌握度分布 + 艾宾浩斯概览 + 未来 7 天到期预测
/// + 35 天热力图 + 近 7 天趋势 + 分类分布（点击分类行局部 sheet 下钻 HistoryView）。
/// 功能自旧 StatsView 平移；数据全部走 StatsCalculator / LearningPlan 纯派生，视图只做格式化。
struct InsightStatsPlaceholder: View {
    @Bindable var store: AppStore

    /// 分类下钻载荷：点分类行 → 带筛选局部 sheet 打开 HistoryView（不经 ActiveSheet）
    @State private var historyCategory: CategoryNav?

    var body: some View {
        // 单次计算后以值下发：原实现中 stats/plan 是计算属性、heatmap/trend 各自
        // 调 dailyCounts，一次渲染里 LearningPlan 与 StatsCalculator 被重建 5+ 次
        let stats = StatsCalculator.compute(from: store.cards)
        let plan = LearningPlan(cards: store.cards)
        let daily35 = StatsCalculator.dailyCounts(cards: store.cards, days: 35)
        let daily7 = StatsCalculator.dailyCounts(cards: store.cards, days: 7)
        InsightContentScaffold(
            title: "统计",
            subtitle: "从刷卡记录派生的学习快照与记忆排程"
        ) {
            Group {
                if stats.seenCount == 0 {
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
                                statTile(value: "\(plan.mastered)", label: "熟练掌握", tone: .success, index: 4)
                            }
                            StatsSections(plan: plan, stats: stats, daily35: daily35, daily7: daily7, onDrillDown: { category in
                                historyCategory = CategoryNav(category: category)
                            })
                        }
                        .padding(.horizontal, InsightLayout.contentPadding)
                        .padding(.bottom, InsightSpacing.large)
                    }
                }
            }
        }
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
        .modifier(InsightStaggerReveal(index: index))
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
                    Text("艾宾浩斯间隔复习").font(InsightFont.headline).foregroundStyle(InsightColor.textPrimary)
                    Spacer()
                    Text("基于 SM-2 记忆曲线排程")
                        .font(InsightFont.captionSmall).foregroundStyle(InsightColor.textMuted)
                }
                HStack(spacing: InsightSpacing.compact) {
                    metricTile(
                        title: "今日到期",
                        value: "\(plan.due.count)", unit: "张",
                        tone: plan.due.isEmpty ? .success : .warning
                    )
                    metricTile(title: "今日已复习", value: "\(plan.completedToday)", unit: "张", tone: .success)
                    metricTile(title: "记忆留存率", value: "\(dist.retentionRate)", unit: "%", tone: .accent)
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
        if Calendar.current.isDateInToday(day) { return "今天" }
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
                    ForEach(daily7, id: \.day) { item in
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
