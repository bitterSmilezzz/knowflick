import SwiftUI
import AppKit
import KnowFlickCore

/// 全局智能搜索与全文检索浮层 (⌘F Command Palette)
struct GlobalSearchModalView: View {
    @Bindable var store: AppStore
    var onSelect: (KnowledgeCard) -> Void
    var onPromote: (KnowledgeCard) -> Void
    var onChat: (KnowledgeCard) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var query: String = ""
    @State private var selectedCategory: String = "全部"
    @State private var selectedSource: SearchSourceFilter = .all
    @State private var selectedIndex: Int = 0
    @FocusState private var isSearchFocused: Bool

    private let searchEngine = KnowledgeSearchEngine()

    private var allCategories: [String] {
        var set = Set<String>()
        for c in store.cards { set.insert(c.category) }
        return ["全部"] + Array(set).sorted()
    }

    private var results: [SearchResultItem] {
        let favs = Set(store.favorites.map(\.id))
        let cat = selectedCategory == "全部" ? nil : selectedCategory
        return searchEngine.search(
            query: query,
            category: cat,
            source: selectedSource,
            in: store.cards,
            favorites: favs
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            searchHeader
            filterBar
            Divider().overlay(EditorialColor.glassDivider)
            resultsArea
            Divider().overlay(EditorialColor.glassDivider)
            footerBar
        }
        .frame(minWidth: 700, idealWidth: 720, minHeight: 520, idealHeight: 550)
        .background(
            ZStack {
                EditorialColor.dynamic(
                    light: NSColor.windowBackgroundColor.withAlphaComponent(0.96),
                    dark: NSColor(white: 0.11, alpha: 0.96)
                )
                // 柔和微光渐变
                RadialGradient(
                    colors: [
                        EditorialColor.aiAmber.opacity(0.08),
                        Color.clear
                    ],
                    center: .top,
                    startRadius: 20,
                    endRadius: 400
                )
            }
        )
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(EditorialColor.glassBorder, lineWidth: 1.2)
        )
        .shadow(color: Color.black.opacity(0.35), radius: 28, y: 12)
        .onAppear {
            isSearchFocused = true
        }
        .onKeyPress(.downArrow) {
            if selectedIndex < results.count - 1 {
                selectedIndex += 1
            }
            return .handled
        }
        .onKeyPress(.upArrow) {
            if selectedIndex > 0 {
                selectedIndex -= 1
            }
            return .handled
        }
        .onKeyPress(.return, phases: .down) { press in
            if !results.isEmpty && selectedIndex < results.count {
                let card = results[selectedIndex].card
                dismiss()
                if press.modifiers.contains(.command) {
                    onPromote(card)
                } else {
                    onSelect(card)
                }
                return .handled
            }
            return .ignored
        }
        .onKeyPress(KeyEquivalent("j"), phases: .down) { press in
            if press.modifiers.contains(.command) && !results.isEmpty && selectedIndex < results.count {
                let card = results[selectedIndex].card
                dismiss()
                onChat(card)
                return .handled
            }
            return .ignored
        }
    }

    // MARK: - 搜索输入框

    private var searchHeader: some View {
        HStack(spacing: 12) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(EditorialColor.aiAmber)

            TextField("搜索知识库… (支持关键词、学科分类、拼音首字母或全文检索)", text: $query)
                .font(.system(size: 16, weight: .medium, design: .serif))
                .textFieldStyle(.plain)
                .focused($isSearchFocused)
                .onChange(of: query) { _, _ in
                    selectedIndex = 0
                }

            if !query.isEmpty {
                Button {
                    query = ""
                    selectedIndex = 0
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(EditorialColor.textTertiary)
                }
                .buttonStyle(.plain)
            }

            // 关闭按钮
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(EditorialColor.textSecondary)
                    .padding(6)
                    .background(EditorialColor.glassSurface, in: Circle())
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.escape, modifiers: [])
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
    }

    // MARK: - 多维过滤筛选条

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                // 来源范围分段切换
                ForEach(SearchSourceFilter.allCases) { filter in
                    let isSelected = selectedSource == filter
                    Button {
                        withAnimation(.easeInOut(duration: 0.18)) {
                            selectedSource = filter
                            selectedIndex = 0
                        }
                    } label: {
                        HStack(spacing: 4) {
                            if filter == .favorites {
                                Image(systemName: "heart.fill")
                                    .font(.system(size: 10))
                            }
                            Text(filter.rawValue)
                                .font(EditorialFont.labelSmall)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(
                            isSelected ? EditorialColor.aiAmber.opacity(0.22) : EditorialColor.glassSurface,
                            in: Capsule()
                        )
                        .overlay(
                            Capsule().strokeBorder(
                                isSelected ? EditorialColor.aiAmber.opacity(0.8) : EditorialColor.glassBorder,
                                lineWidth: 1
                            )
                        )
                        .foregroundStyle(isSelected ? EditorialColor.textPrimary : EditorialColor.textSecondary)
                    }
                    .buttonStyle(.plain)
                }

                Rectangle()
                    .fill(EditorialColor.glassDivider)
                    .frame(width: 1, height: 16)
                    .padding(.horizontal, 4)

                // 学科分类筛选
                ForEach(allCategories, id: \.self) { cat in
                    let isSelected = selectedCategory == cat
                    Button {
                        withAnimation(.easeInOut(duration: 0.18)) {
                            selectedCategory = cat
                            selectedIndex = 0
                        }
                    } label: {
                        Text(cat)
                            .font(EditorialFont.labelSmall)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(
                                isSelected ? EditorialColor.textPrimary.opacity(0.18) : EditorialColor.glassSurface,
                                in: Capsule()
                            )
                            .overlay(
                                Capsule().strokeBorder(
                                    isSelected ? EditorialColor.textPrimary.opacity(0.6) : EditorialColor.glassBorder,
                                    lineWidth: 1
                                )
                            )
                            .foregroundStyle(isSelected ? EditorialColor.textPrimary : EditorialColor.textTertiary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 12)
        }
    }

    // MARK: - 结果展示列表

    private var resultsArea: some View {
        ScrollViewReader { proxy in
            ScrollView {
                if results.isEmpty {
                    emptySearchResultsView
                } else {
                    LazyVStack(spacing: 6) {
                        ForEach(Array(results.enumerated()), id: \.element.card.id) { index, item in
                            searchResultRow(item: item, index: index)
                                .id(index)
                                .onTapGesture {
                                    dismiss()
                                    onSelect(item.card)
                                }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                }
            }
            .onChange(of: selectedIndex) { _, newIndex in
                withAnimation(.easeInOut(duration: 0.15)) {
                    proxy.scrollTo(newIndex, anchor: .center)
                }
            }
        }
    }

    private func searchResultRow(item: SearchResultItem, index: Int) -> some View {
        let isSelected = index == selectedIndex
        let theme = CategoryTheme.theme(for: item.card, cache: .shared)

        return HStack(alignment: .top, spacing: 12) {
            // 学科分类与匹配指示器
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    Circle()
                        .fill(theme.accent)
                        .frame(width: 7, height: 7)
                    Text(item.card.category)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(EditorialColor.textSecondary)
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 2.5)
                .background(theme.accent.opacity(0.16), in: RoundedRectangle(cornerRadius: 5))

                if item.matchedField != .browse {
                    Text("命中\(item.matchedField.rawValue)")
                        .font(.system(size: 9.5, weight: .medium))
                        .foregroundStyle(EditorialColor.textMuted)
                        .padding(.leading, 2)
                }
            }
            .frame(width: 80, alignment: .leading)

            // 标题与摘要片段
            VStack(alignment: .leading, spacing: 4) {
                HighlightedText(
                    text: item.card.headline,
                    query: query,
                    font: .system(size: 14, weight: .semibold, design: .serif),
                    textColor: EditorialColor.textPrimary,
                    highlightColor: EditorialColor.aiAmber
                )
                .fixedSize(horizontal: false, vertical: true)

                HighlightedText(
                    text: item.matchedExcerpt,
                    query: query,
                    font: EditorialFont.caption,
                    textColor: EditorialColor.textSecondary,
                    highlightColor: EditorialColor.aiAmber
                )
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 8)

            // 状态徽标与快捷动作
            HStack(spacing: 8) {
                if item.isFavorite {
                    Image(systemName: "heart.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(EditorialColor.likeGreen)
                        .help("已收藏")
                }

                if item.card.source == .ai {
                    Image(systemName: "sparkles")
                        .font(.system(size: 10))
                        .foregroundStyle(EditorialColor.aiAmber)
                }

                // 快捷操作按钮组
                HStack(spacing: 4) {
                    Button {
                        dismiss()
                        onPromote(item.card)
                    } label: {
                        Text("置顶刷卡")
                            .font(.system(size: 11, weight: .medium))
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3.5)
                            .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 4))
                    }
                    .buttonStyle(.plain)
                    .help("置于卡堆顶部 ⌘⏎")

                    Button {
                        dismiss()
                        onChat(item.card)
                    } label: {
                        Image(systemName: "bubble.left.and.text.bubble.right")
                            .font(.system(size: 11))
                            .padding(4.5)
                            .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 4))
                    }
                    .buttonStyle(.plain)
                    .help("向卡片追问 ⌘J")
                }
                .opacity(isSelected ? 1 : 0.65)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(isSelected ? EditorialColor.aiAmber.opacity(0.14) : Color.clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(isSelected ? EditorialColor.aiAmber.opacity(0.55) : Color.clear, lineWidth: 1)
        )
        .contentShape(Rectangle())
    }

    // MARK: - 空结果推荐与引导

    private var emptySearchResultsView: some View {
        VStack(spacing: 16) {
            Spacer(minLength: 24)
            Image(systemName: query.isEmpty ? "sparkles.magnifyingglass" : "magnifyingglass")
                .font(.system(size: 38))
                .foregroundStyle(EditorialColor.textTertiary)

            if query.isEmpty {
                Text("输入任意关键词探索知识库")
                    .font(EditorialFont.sectionTitle)
                    .foregroundStyle(EditorialColor.textPrimary)
                Text("支持中文拼音首字母（如 xzl 搜租赁）、学科领域、作者文献或正文细节")
                    .font(EditorialFont.caption)
                    .foregroundStyle(EditorialColor.textTertiary)

                // 启发式搜索建议气泡
                HStack(spacing: 8) {
                    ForEach(["新租赁准则", "量子纠缠", "LRU缓存", "黑天鹅", "相对论"], id: \.self) { tip in
                        Button {
                            query = tip
                        } label: {
                            Text(tip)
                                .font(EditorialFont.labelSmall)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(EditorialColor.glassSurface, in: Capsule())
                                .overlay(Capsule().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                                .foregroundStyle(EditorialColor.textSecondary)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.top, 4)
            } else {
                Text("未找到与「\(query)」相关的卡片")
                    .font(EditorialFont.sectionTitle)
                    .foregroundStyle(EditorialColor.textPrimary)
                Text("尝试精简搜索词，或切换来源与分类范围")
                    .font(EditorialFont.caption)
                    .foregroundStyle(EditorialColor.textTertiary)

                if store.settings.isAIConfigured {
                    Button {
                        dismiss()
                        Task {
                            await store.generateNewCards(count: 3)
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "sparkles")
                            Text("让 AI 围绕「\(query)」生成新卡片")
                        }
                        .font(EditorialFont.label)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 9)
                        .background(EditorialColor.aiAmber.opacity(0.24), in: Capsule())
                        .overlay(Capsule().strokeBorder(EditorialColor.aiAmber.opacity(0.7), lineWidth: 1))
                        .foregroundStyle(EditorialColor.textPrimary)
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 6)
                }
            }
            Spacer(minLength: 24)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }

    // MARK: - 底部快捷键状态栏

    private var footerBar: some View {
        HStack {
            Text("共找到 \(results.count) 张卡片")
                .font(EditorialFont.caption)
                .foregroundStyle(EditorialColor.textTertiary)

            Spacer()

            HStack(spacing: 12) {
                footerShortcutTip(key: "↑↓", desc: "切换")
                footerShortcutTip(key: "⏎", desc: "打开详情")
                footerShortcutTip(key: "⌘⏎", desc: "置顶刷卡")
                footerShortcutTip(key: "⌘J", desc: "伴学追问")
                footerShortcutTip(key: "Esc", desc: "关闭")
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 11)
        .background(EditorialColor.glassSurface.opacity(0.5))
    }

    private func footerShortcutTip(key: String, desc: String) -> some View {
        HStack(spacing: 3) {
            Text(key)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .padding(.horizontal, 4)
                .padding(.vertical, 1.5)
                .background(EditorialColor.glassBorder.opacity(0.6), in: RoundedRectangle(cornerRadius: 3))
                .foregroundStyle(EditorialColor.textPrimary)
            Text(desc)
                .font(.system(size: 11))
                .foregroundStyle(EditorialColor.textTertiary)
        }
    }
}

// MARK: - 关键词高亮文本组件

struct HighlightedText: View {
    let text: String
    let query: String
    var font: Font = EditorialFont.label
    var textColor: Color = EditorialColor.textPrimary
    var highlightColor: Color = EditorialColor.aiAmber

    var body: some View {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            Text(text)
                .font(font)
                .foregroundStyle(textColor)
        } else {
            buildHighlightedText(text: text, query: trimmed.lowercased())
                .font(font)
        }
    }

    private func buildHighlightedText(text: String, query: String) -> Text {
        guard let range = text.lowercased().range(of: query) else {
            return Text(text).foregroundColor(textColor)
        }
        let before = String(text[..<range.lowerBound])
        let match = String(text[range])
        let after = String(text[range.upperBound...])

        return Text(before).foregroundColor(textColor)
            + Text(match).bold().foregroundColor(highlightColor)
            + buildHighlightedText(text: after, query: query)
    }
}
