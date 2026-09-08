import SwiftUI
import AppKit
import UniformTypeIdentifiers
import KnowFlickCore

/// 知识收藏阁：沉淀心仪卡片，按学科分类筛选检索，并支持一键导出至 Obsidian / Notion 读书笔记
struct FavoritesView: View {
    let store: AppStore
    let onClose: () -> Void

    @State private var selectedCategory: String? = nil
    @State private var searchText: String = ""
    @State private var selectedCard: KnowledgeCard? = nil
    @State private var sharePosterCard: KnowledgeCard? = nil
    @State private var toastMessage: String? = nil
    @State private var showQuiz: Bool = false
    @State private var quizCategory: String? = nil

    // MARK: - 计算属性

    /// 所有已收藏卡片按分类统计
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

    var body: some View {
        ZStack {
            EditorialColor.canvasGradient
                .ignoresSafeArea()
            NoiseOverlay().ignoresSafeArea()

            VStack(spacing: 0) {
                topBar
                Divider().overlay(EditorialColor.glassDivider)
                filterAndSearchBar
                Divider().overlay(EditorialColor.glassDivider.opacity(0.6))

                if store.favorites.isEmpty {
                    emptyFavoritesView
                } else if filteredCards.isEmpty {
                    emptySearchResultView
                } else {
                    cardGrid
                }
            }

            // 悬浮反馈 Toast
            if let toast = toastMessage {
                toastView(toast)
                    .zIndex(200)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .overlay {
            if let card = selectedCard {
                detailOverlay(for: card)
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
        .overlay {
            if showQuiz {
                QuizView(store: store, category: quizCategory) {
                    showQuiz = false
                }
                .transition(.opacity.combined(with: .scale(scale: 0.98)))
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: toastMessage)
        .frame(minWidth: 840, minHeight: 600)
    }

    // MARK: - 顶栏

    private var topBar: some View {
        HStack(spacing: 16) {
            Button(action: {
                if selectedCard != nil {
                    withAnimation { selectedCard = nil }
                } else if sharePosterCard != nil {
                    withAnimation { sharePosterCard = nil }
                } else if showQuiz {
                    withAnimation { showQuiz = false }
                } else {
                    onClose()
                }
            }) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(EditorialColor.textPrimary)
                    .frame(width: 32, height: 32)
                    .background(EditorialColor.glassSurface, in: Circle())
                    .overlay(Circle().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
            }
            .buttonStyle(PressableButtonStyle())
            .keyboardShortcut(.escape, modifiers: [])
            .help("返回 (Esc)")

            HStack(spacing: 9) {
                Image(systemName: "bookmark.fill")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(EditorialColor.aiAmber)

                Text("知识收藏阁")
                    .font(EditorialFont.modalTitle)
                    .foregroundStyle(EditorialColor.textPrimary)

                Text("\(store.favorites.count)")
                    .font(EditorialFont.captionSmall.weight(.bold))
                    .foregroundStyle(EditorialColor.aiAmber)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(EditorialColor.aiAmberBg, in: Capsule())
                    .overlay(Capsule().strokeBorder(EditorialColor.aiAmberBorder, lineWidth: 1))
            }

            Spacer()

            // 开启记忆测验
            Button {
                quizCategory = selectedCategory
                showQuiz = true
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "graduationcap.fill")
                        .font(.system(size: 11.5, weight: .bold))
                    Text(selectedCategory != nil ? "\(selectedCategory!)测验" : "开启测验")
                        .font(EditorialFont.labelSmall)
                }
                .foregroundStyle(Color.white)
                .padding(.horizontal, 13)
                .padding(.vertical, 7)
                .background(EditorialColor.aiAmber, in: Capsule())
                .shadow(color: EditorialColor.aiAmber.opacity(0.32), radius: 6, y: 2)
            }
            .buttonStyle(PressableButtonStyle())
            .help(selectedCategory != nil ? "针对 \(selectedCategory!) 分类开启记忆测验" : "针对已收藏知识开启记忆测验")

            // 导出 Markdown 笔记菜单
            Menu {
                Button {
                    copyMarkdown(filteredOnly: false)
                } label: {
                    Label("复制全部收藏 Markdown (\(store.favorites.count) 篇)", systemImage: "doc.on.doc")
                }
                .keyboardShortcut("c", modifiers: [.command, .shift])

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
                .keyboardShortcut("s", modifiers: [.command, .shift])

                if selectedCategory != nil || !searchText.isEmpty {
                    Button {
                        saveMarkdownToFile(filteredOnly: true)
                    } label: {
                        Label("导出当前筛选为 .md 文件...", systemImage: "arrow.down.doc.fill")
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 12, weight: .bold))
                    Text("导出笔记")
                        .font(EditorialFont.labelSmall)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 9, weight: .semibold))
                        .opacity(0.7)
                }
                .foregroundStyle(EditorialColor.textPrimary)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(EditorialColor.glassSurface, in: Capsule())
                .overlay(Capsule().strokeBorder(EditorialColor.glassBorderHover, lineWidth: 1))
            }
            .menuStyle(.borderlessButton)
            .help("导出至 Obsidian / Notion 等笔记工具 (⌘⇧C / ⌘⇧S)")
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 16)
    }

    // MARK: - 筛选与搜索工具条

    private var filterAndSearchBar: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                // 搜索框
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(EditorialColor.textMuted)

                    TextField("搜索知识标题、观点或内容...", text: $searchText)
                        .textFieldStyle(.plain)
                        .font(EditorialFont.label)
                        .foregroundStyle(EditorialColor.textPrimary)

                    if !searchText.isEmpty {
                        Button {
                            searchText = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 12))
                                .foregroundStyle(EditorialColor.textMuted)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .strokeBorder(EditorialColor.glassBorder, lineWidth: 1)
                )

                Spacer()

                if !filteredCards.isEmpty {
                    Text("共 \(filteredCards.count) 条笔记")
                        .font(EditorialFont.captionSmall)
                        .foregroundStyle(EditorialColor.textTertiary)
                }
            }

            // 分类胶囊栏（横向滚动）
            if !categoryCounts.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        categoryFilterPill(title: "全部", count: store.favorites.count, isSelected: selectedCategory == nil) {
                            withAnimation(.spring(response: 0.25, dampingFraction: 0.8)) {
                                selectedCategory = nil
                            }
                        }

                        ForEach(categoryCounts, id: \.category) { item in
                            let isSelected = selectedCategory == item.category
                            let theme = CategoryTheme.theme(for: item.category, cache: .shared)

                            Button {
                                withAnimation(.spring(response: 0.25, dampingFraction: 0.8)) {
                                    if selectedCategory == item.category {
                                        selectedCategory = nil
                                    } else {
                                        selectedCategory = item.category
                                    }
                                }
                            } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: theme.iconName)
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundStyle(isSelected ? Color.black.opacity(0.88) : theme.accent)

                                    Text(item.category)
                                        .font(EditorialFont.caption.weight(isSelected ? .bold : .medium))
                                        .foregroundStyle(isSelected ? Color.black.opacity(0.88) : EditorialColor.textPrimary)

                                    Text("\(item.count)")
                                        .font(EditorialFont.captionSmall.weight(.semibold))
                                        .foregroundStyle(isSelected ? Color.black.opacity(0.65) : EditorialColor.textMuted)
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(
                                    isSelected ? theme.accent : EditorialColor.glassSurface,
                                    in: Capsule()
                                )
                                .overlay(
                                    Capsule()
                                        .strokeBorder(
                                            isSelected ? Color.white.opacity(0.3) : theme.accent.opacity(0.35),
                                            lineWidth: 1
                                        )
                                )
                            }
                            .buttonStyle(PressableButtonStyle(scale: 0.96))
                        }
                    }
                    .padding(.horizontal, 2)
                    .padding(.vertical, 2)
                }
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 12)
    }

    private func categoryFilterPill(title: String, count: Int, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Text(title)
                    .font(EditorialFont.caption.weight(isSelected ? .bold : .medium))
                    .foregroundStyle(isSelected ? Color.black.opacity(0.88) : EditorialColor.textPrimary)

                Text("\(count)")
                    .font(EditorialFont.captionSmall.weight(.semibold))
                    .foregroundStyle(isSelected ? Color.black.opacity(0.65) : EditorialColor.textMuted)
            }
            .padding(.horizontal, 11)
            .padding(.vertical, 5)
            .background(
                isSelected ? EditorialColor.textPrimary : EditorialColor.glassSurface,
                in: Capsule()
            )
            .overlay(
                Capsule()
                    .strokeBorder(
                        isSelected ? Color.clear : EditorialColor.glassBorder,
                        lineWidth: 1
                    )
            )
        }
        .buttonStyle(PressableButtonStyle(scale: 0.96))
    }

    // MARK: - 卡片网格展示

    private var cardGrid: some View {
        ScrollView {
            LazyVGrid(
                columns: [
                    GridItem(.flexible(minimum: 360), spacing: 14),
                    GridItem(.flexible(minimum: 360), spacing: 14)
                ],
                spacing: 14
            ) {
                ForEach(filteredCards) { card in
                    favoriteCardItem(card)
                }
            }
            .padding(24)
        }
    }

    private func favoriteCardItem(_ card: KnowledgeCard) -> some View {
        let theme = CategoryTheme.theme(for: card, cache: .shared)

        return VStack(alignment: .leading, spacing: 12) {
            // 卡片头部行：分类标签 + 来源 + 收藏时间 + 取消收藏心形
            HStack(spacing: 8) {
                HStack(spacing: 4) {
                    Image(systemName: theme.iconName)
                        .font(.system(size: 9.5, weight: .bold))
                    Text(card.category)
                        .font(EditorialFont.captionSmall.weight(.bold))
                    Text("·")
                        .font(.system(size: 8, weight: .heavy))
                    Text(theme.domainCode)
                        .font(.system(size: 8.5, weight: .bold, design: .monospaced))
                }
                .foregroundStyle(theme.accent)
                .padding(.horizontal, 8)
                .padding(.vertical, 3.5)
                .background(theme.accent.opacity(0.12), in: Capsule())
                .overlay(Capsule().strokeBorder(theme.accent.opacity(0.32), lineWidth: 0.8))

                if card.source == .ai {
                    Text("AI")
                        .font(.system(size: 9, weight: .heavy))
                        .foregroundStyle(EditorialColor.aiAmber)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2.5)
                        .background(EditorialColor.aiAmberBg, in: Capsule())
                        .overlay(Capsule().strokeBorder(EditorialColor.aiAmberBorder, lineWidth: 0.8))
                }

                Spacer()

                if let seen = card.seenAt {
                    Text(seen.formatted(date: .abbreviated, time: .omitted))
                        .font(EditorialFont.captionSmall)
                        .foregroundStyle(EditorialColor.textMuted)
                }

                // 取消收藏快捷心形
                Button {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) {
                        store.toggleFavorite(card)
                        triggerToast("已将《\(card.headline)》移出收藏阁")
                    }
                } label: {
                    Image(systemName: "heart.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(EditorialColor.likeGreen)
                        .frame(width: 24, height: 24)
                }
                .buttonStyle(PressableButtonStyle(scale: 0.9))
                .help("取消收藏")
            }

            // 标题
            Text(card.headline)
                .font(EditorialFont.sectionTitle)
                .foregroundStyle(EditorialColor.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)

            // 核心摘要（引用样式）
            HStack(alignment: .top, spacing: 10) {
                Rectangle()
                    .fill(theme.accent.opacity(0.75))
                    .frame(width: 3)
                    .cornerRadius(1.5)

                Text(card.summary)
                    .font(EditorialFont.caption)
                    .foregroundStyle(EditorialColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.vertical, 2)

            Spacer(minLength: 4)

            // 卡片底部操作栏
            HStack(spacing: 8) {
                Button {
                    selectedCard = card
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "book.pages")
                            .font(.system(size: 11, weight: .semibold))
                        Text("卡片详情")
                            .font(EditorialFont.labelSmall)
                    }
                    .foregroundStyle(EditorialColor.textPrimary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(EditorialColor.glassSurface, in: Capsule())
                    .overlay(Capsule().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                }
                .buttonStyle(PressableButtonStyle(scale: 0.96))

                Button {
                    sharePosterCard = card
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "photo.on.rectangle.angled")
                            .font(.system(size: 11, weight: .semibold))
                        Text("分享海报")
                            .font(EditorialFont.labelSmall)
                    }
                    .foregroundStyle(theme.accent)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(theme.accent.opacity(0.12), in: Capsule())
                    .overlay(Capsule().strokeBorder(theme.accent.opacity(0.35), lineWidth: 1))
                }
                .buttonStyle(PressableButtonStyle(scale: 0.96))

                Spacer()
            }
        }
        .padding(18)
        .editorialGlassCard(cornerRadius: EditorialRadius.card)
        .overlay(
            RoundedRectangle(cornerRadius: EditorialRadius.card, style: .continuous)
                .strokeBorder(theme.accent.opacity(0.22), lineWidth: 1)
        )
    }

    // MARK: - 空状态视图

    private var emptyFavoritesView: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "bookmark")
                .font(.system(size: 48, weight: .light))
                .foregroundStyle(EditorialColor.aiAmber.opacity(0.7))

            Text("收藏阁还是空的")
                .font(EditorialFont.modalTitle)
                .foregroundStyle(EditorialColor.textPrimary)

            Text("在主界面刷卡时向右轻划、或在卡片详情中点击「收藏」心形，\n将令你心动的知识精粹沉淀于此。")
                .font(EditorialFont.bodySerif)
                .foregroundStyle(EditorialColor.textTertiary)
                .multilineTextAlignment(.center)
                .lineSpacing(5)

            Spacer()
        }
        .padding(40)
    }

    private var emptySearchResultView: some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 42, weight: .light))
                .foregroundStyle(EditorialColor.textMuted)

            Text("未找到相关知识笔记")
                .font(EditorialFont.bodySerif)
                .foregroundStyle(EditorialColor.textSecondary)

            Button("清空搜索筛选") {
                withAnimation {
                    searchText = ""
                    selectedCategory = nil
                }
            }
            .buttonStyle(PressableButtonStyle())
            .font(EditorialFont.labelSmall)
            .foregroundStyle(EditorialColor.aiAmber)
            .padding(.top, 6)

            Spacer()
        }
    }

    // MARK: - 详情浮层

    private func detailOverlay(for card: KnowledgeCard) -> some View {
        ZStack {
            Color.black.opacity(0.6)
                .ignoresSafeArea()
                .onTapGesture { selectedCard = nil }

            DetailView(
                card: card,
                store: store,
                showAIMark: store.settings.showAIMark,
                hasPrevious: false,
                hasNext: false,
                onSwipe: { _ in
                    store.toggleFavorite(card)
                },
                onToggleFavorite: {
                    store.toggleFavorite(card)
                },
                onNext: {},
                onPrevious: {},
                onClose: { selectedCard = nil },
                relatedCards: store.getRelatedCards(for: card),
                onSelectCard: { target in
                    selectedCard = target
                }
            )
            .frame(maxWidth: 620, maxHeight: 720)
            .clipShape(RoundedRectangle(cornerRadius: EditorialRadius.modal, style: .continuous))
            .shadow(color: Color.black.opacity(0.4), radius: 30, y: 12)
        }
        .transition(.opacity.combined(with: .scale(scale: 0.98)))
    }

    // MARK: - 笔记导出动作

    private func copyMarkdown(filteredOnly: Bool) {
        let exportList = filteredOnly ? filteredCards : store.favorites
        guard !exportList.isEmpty else { return }
        let md = store.exportFavoritesMarkdown(filtered: exportList)

        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(md, forType: .string)

        triggerToast("已复制 \(exportList.count) 篇知识笔记 (Markdown) 至剪贴板")
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

        savePanel.beginSheetModal(for: targetWindow ?? NSWindow()) { response in
            if response == .OK, let url = savePanel.url {
                do {
                    try md.write(to: url, atomically: true, encoding: .utf8)
                    triggerToast("已成功导出笔记至 \(url.lastPathComponent)")
                } catch {
                    triggerToast("导出失败：\(error.localizedDescription)")
                }
            }
        }
    }

    private func triggerToast(_ message: String) {
        toastMessage = message
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            if toastMessage == message {
                toastMessage = nil
            }
        }
    }

    private func toastView(_ text: String) -> some View {
        VStack {
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(EditorialColor.likeGreen)
                    .font(.system(size: 13, weight: .bold))

                Text(text)
                    .font(EditorialFont.labelSmall)
                    .foregroundStyle(EditorialColor.textPrimary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 9)
            .background(Color.black.opacity(0.78), in: Capsule())
            .overlay(Capsule().strokeBorder(EditorialColor.glassBorderHover, lineWidth: 1))
            .shadow(color: Color.black.opacity(0.35), radius: 12, y: 5)
            .padding(.top, 24)

            Spacer()
        }
    }
}
