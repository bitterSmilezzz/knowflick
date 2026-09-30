import SwiftUI
import AppKit
import UniformTypeIdentifiers
import KnowFlickCore

// 收藏阁（自 InsightPlaceholderViews.swift 拆出）：分类筛选 + 全文搜索 + 卡片操作
// + 笔记导出 + 分类测验。数据写入全部走 AppStore 意图化方法。

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
            InsightToast(center: toast, edge: .top)
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
                .background(InsightColor.accent, in: Capsule())
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
