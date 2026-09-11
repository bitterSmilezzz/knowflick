import SwiftUI
import AppKit
import UniformTypeIdentifiers
import KnowFlickCore

/// 卡片批量导出中心模态弹窗 (⇧⌘E)
struct ExportCardsModalView: View {
    @Bindable var store: AppStore
    var initialScopeCards: [KnowledgeCard]? = nil
    var onClose: () -> Void

    enum ExportScope: String, CaseIterable, Identifiable {
        case all = "全部卡片"
        case favorites = "知识收藏阁"
        case category = "按分类筛选"
        case custom = "指定卡片"

        var id: String { rawValue }
    }

    @State private var selectedScope: ExportScope = .all
    @State private var selectedCategory: String = "全部"
    @State private var selectedFormat: CardExportFormat = .markdownSingle
    @State private var toastMessage: String?
    @State private var toastIsFailure: Bool = false
    @State private var isExporting: Bool = false
    @State private var previewContent = "正在准备预览…"
    @State private var previewReady = false
    @State private var operationTask: Task<Void, Never>?

    private struct PreviewRequest: Hashable {
        let cards: [KnowledgeCard]
        let format: CardExportFormat
        let count: Int
    }
    private var previewRequest: PreviewRequest {
        let cards = exportCards
        return PreviewRequest(cards: Array(cards.prefix(3)), format: selectedFormat, count: cards.count)
    }

    private var availableCategories: [String] {
        var set = Set<String>()
        for c in store.cards { set.insert(c.category) }
        return ["全部"] + Array(set).sorted()
    }

    private var exportCards: [KnowledgeCard] {
        if let custom = initialScopeCards, selectedScope == .custom {
            return custom
        }
        switch selectedScope {
        case .all:
            return store.cards
        case .favorites:
            return store.favorites
        case .category:
            if selectedCategory == "全部" {
                return store.cards
            }
            return store.cards.filter { $0.category == selectedCategory }
        case .custom:
            return initialScopeCards ?? store.cards
        }
    }

    var body: some View {
        ZStack {
            EditorialColor.dynamic(
                light: NSColor.windowBackgroundColor.withAlphaComponent(0.97),
                dark: NSColor(white: 0.12, alpha: 0.97)
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                headerBar
                Divider().overlay(EditorialColor.glassDivider)

                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        scopeSelectionCard
                            .disabled(isExporting)
                        formatSelectionCard
                            .disabled(isExporting)
                        previewCard
                    }
                    .padding(22)
                }

                Divider().overlay(EditorialColor.glassDivider)
                bottomActionBar
            }

            if let toast = toastMessage {
                let accent = toastIsFailure ? EditorialColor.dislikeRed : EditorialColor.likeGreen
                VStack {
                    Spacer()
                    HStack(spacing: 8) {
                        Image(systemName: toastIsFailure ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                            .foregroundStyle(accent)
                        Text(toast)
                            .font(EditorialFont.labelSmall)
                            .foregroundStyle(.white)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Color.black.opacity(0.85), in: Capsule())
                    .overlay(Capsule().strokeBorder(accent.opacity(0.6), lineWidth: 1))
                    .shadow(color: Color.black.opacity(0.2), radius: 10, y: 4)
                    .padding(.bottom, 68)
                    .transition(.opacity.combined(with: .scale(scale: 0.95)))
                }
            }
        }
        .frame(minWidth: 720, idealWidth: 760, minHeight: 560, idealHeight: 640)
        .onAppear {
            if initialScopeCards != nil {
                selectedScope = .custom
            }
        }
        .task(id: previewRequest) {
            let request = previewRequest
            previewReady = false
            previewContent = "正在准备预览…"
            do {
                let content = try await CardTransferService.preview(cards: request.cards, format: request.format, totalCount: request.count)
                guard !Task.isCancelled else { return }
                previewContent = content
                previewReady = true
            } catch {
                guard !Task.isCancelled else { return }
                previewContent = "预览失败：\(error.localizedDescription)"
            }
        }
        .interactiveDismissDisabled(isExporting)
        .onDisappear { operationTask?.cancel() }
    }

    // MARK: - Header

    private var headerBar: some View {
        HStack(spacing: 12) {
            Image(systemName: "square.and.arrow.up.fill")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(EditorialColor.aiAmber)

            VStack(alignment: .leading, spacing: 2) {
                Text("卡片批量导出中心")
                    .font(EditorialFont.modalTitle)
                    .foregroundStyle(EditorialColor.textPrimary)
                Text("支持 Markdown、Obsidian 双链、Anki 记忆牌组及 JSON 全量备份")
                    .font(EditorialFont.captionSmall)
                    .foregroundStyle(EditorialColor.textTertiary)
            }

            Spacer()

            Button {
                onClose()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(EditorialColor.textSecondary)
                    .frame(width: 28, height: 28)
                    .background(EditorialColor.glassSurface, in: Circle())
                    .overlay(Circle().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
            }
            .buttonStyle(PressableButtonStyle())
            .keyboardShortcut(.escape, modifiers: [])
            .help("关闭 (Esc)")
            .disabled(isExporting)
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 16)
    }

    // MARK: - Scope Selection

    private var scopeSelectionCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                HStack(spacing: 6) {
                    Image(systemName: "target")
                        .foregroundStyle(EditorialColor.aiAmber)
                    Text("1. 选择导出范围")
                        .font(EditorialFont.sectionTitle)
                        .foregroundStyle(EditorialColor.textPrimary)
                }

                Spacer()

                Text("准备导出 \(exportCards.count) 张卡片")
                    .font(EditorialFont.captionSmall.weight(.semibold))
                    .foregroundStyle(EditorialColor.aiAmber)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 3)
                    .background(EditorialColor.aiAmberBg, in: Capsule())
                    .overlay(Capsule().strokeBorder(EditorialColor.aiAmberBorder, lineWidth: 1))
            }

            HStack(spacing: 10) {
                let scopes: [ExportScope] = initialScopeCards != nil
                    ? [.custom, .all, .favorites, .category]
                    : [.all, .favorites, .category]

                ForEach(scopes) { scope in
                    let isSelected = selectedScope == scope
                    Button {
                        withAnimation(.spring(response: 0.25, dampingFraction: 0.8)) {
                            selectedScope = scope
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Circle()
                                .fill(isSelected ? EditorialColor.aiAmber : Color.clear)
                                .frame(width: 6, height: 6)
                            Text(scopeTitle(scope))
                                .font(EditorialFont.label)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(
                            isSelected ? EditorialColor.aiAmberBg : EditorialColor.glassSurface,
                            in: RoundedRectangle(cornerRadius: EditorialRadius.control, style: .continuous)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: EditorialRadius.control, style: .continuous)
                                .strokeBorder(
                                    isSelected ? EditorialColor.aiAmberBorder : EditorialColor.glassBorder,
                                    lineWidth: isSelected ? 1.5 : 1
                                )
                        )
                        .foregroundStyle(isSelected ? EditorialColor.aiAmber : EditorialColor.textSecondary)
                    }
                    .buttonStyle(.plain)
                }
            }

            if selectedScope == .category {
                HStack(spacing: 8) {
                    Text("选择分类：")
                        .font(EditorialFont.labelSmall)
                        .foregroundStyle(EditorialColor.textSecondary)

                    Picker("", selection: $selectedCategory) {
                        ForEach(availableCategories, id: \.self) { cat in
                            Text(cat).tag(cat)
                        }
                    }
                    .pickerStyle(.menu)
                    .frame(width: 140)
                }
                .padding(.top, 4)
            }
        }
        .padding(16)
        .editorialGlassCard()
    }

    private func scopeTitle(_ scope: ExportScope) -> String {
        switch scope {
        case .all: return "全部卡片 (\(store.cards.count))"
        case .favorites: return "知识收藏阁 (\(store.favorites.count))"
        case .category: return "按分类筛选"
        case .custom: return "当前选定 (\(initialScopeCards?.count ?? 0))"
        }
    }

    // MARK: - Format Selection

    private var formatSelectionCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                Image(systemName: "doc.badge.gearshape")
                    .foregroundStyle(EditorialColor.aiAmber)
                Text("2. 选择导出格式")
                    .font(EditorialFont.sectionTitle)
                    .foregroundStyle(EditorialColor.textPrimary)
            }

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                formatCard(
                    format: .markdownSingle,
                    icon: "doc.text.fill",
                    title: "Markdown 单文件",
                    desc: "整合为单篇精美长文笔记，带 YAML Frontmatter 与卡片锚点索引"
                )

                formatCard(
                    format: .obsidianVault,
                    icon: "link.circle.fill",
                    title: "Obsidian 独立双链集合",
                    desc: "每张卡片生成独立 .md，包含 [[分类]] 内部双链与标签体系"
                )

                formatCard(
                    format: .ankiTSV,
                    icon: "graduationcap.fill",
                    title: "Anki 记忆牌组 (TSV)",
                    desc: "正面核心观点、背面深度阐释与引用链接，一键导入 Anki 闪卡"
                )

                formatCard(
                    format: .jsonArchive,
                    icon: "curlybraces",
                    title: "JSON 完整归档",
                    desc: "保留卡片完整元数据与熟练度统计，适用于跨设备备份与还原"
                )
            }
        }
        .padding(16)
        .editorialGlassCard()
    }

    private func formatCard(format: CardExportFormat, icon: String, title: String, desc: String) -> some View {
        let isSelected = selectedFormat == format
        return Button {
            withAnimation(.spring(response: 0.25, dampingFraction: 0.8)) {
                selectedFormat = format
            }
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Image(systemName: icon)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(isSelected ? EditorialColor.aiAmber : EditorialColor.textSecondary)

                    Text(title)
                        .font(EditorialFont.label.weight(.semibold))
                        .foregroundStyle(EditorialColor.textPrimary)

                    Spacer()

                    if isSelected {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 13))
                            .foregroundStyle(EditorialColor.aiAmber)
                    }
                }

                Text(desc)
                    .font(EditorialFont.captionSmall)
                    .foregroundStyle(EditorialColor.textTertiary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            .padding(12)
            .background(
                isSelected ? EditorialColor.aiAmberBg : EditorialColor.glassSurface,
                in: RoundedRectangle(cornerRadius: EditorialRadius.control, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: EditorialRadius.control, style: .continuous)
                    .strokeBorder(
                        isSelected ? EditorialColor.aiAmberBorder : EditorialColor.glassBorder,
                        lineWidth: isSelected ? 1.5 : 1
                    )
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Preview Card

    private var previewCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                HStack(spacing: 6) {
                    Image(systemName: "eye.fill")
                        .foregroundStyle(EditorialColor.aiAmber)
                    Text("3. 导出内容预览")
                        .font(EditorialFont.sectionTitle)
                        .foregroundStyle(EditorialColor.textPrimary)
                }

                Spacer()

                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(previewContent, forType: .string)
                    triggerToast("已复制当前预览样本")
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "doc.on.doc")
                            .font(.system(size: 11))
                        Text("复制预览内容")
                            .font(EditorialFont.captionSmall)
                    }
                    .foregroundStyle(EditorialColor.aiAmber)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4)
                    .background(EditorialColor.aiAmberBg, in: Capsule())
                    .overlay(Capsule().strokeBorder(EditorialColor.aiAmberBorder, lineWidth: 1))
                }
                .buttonStyle(PressableButtonStyle())
                .disabled(!previewReady || isExporting)
            }

            ScrollView([.horizontal, .vertical]) {
                Text(previewContent)
                    .font(.system(size: 12, weight: .regular, design: .monospaced))
                    .foregroundStyle(EditorialColor.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
            }
            .frame(height: 150)
            .background(
                EditorialColor.dynamic(
                    light: NSColor.black.withAlphaComponent(0.04),
                    dark: NSColor.black.withAlphaComponent(0.3)
                ),
                in: RoundedRectangle(cornerRadius: 8, style: .continuous)
            )
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
        }
        .padding(16)
        .editorialGlassCard()
    }

    // MARK: - Bottom Action Bar

    private var bottomActionBar: some View {
        HStack(spacing: 12) {
            Button {
                copyToClipboard()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "doc.on.doc")
                        .font(.system(size: 12, weight: .semibold))
                    Text("拷贝至剪贴板")
                        .font(EditorialFont.label)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                .foregroundStyle(EditorialColor.textPrimary)
            }
            .buttonStyle(PressableButtonStyle())
            .disabled(exportCards.isEmpty || isExporting)

            Spacer()

            Button("取消") {
                onClose()
            }
            .disabled(isExporting)
            .font(EditorialFont.label)
            .foregroundStyle(EditorialColor.textSecondary)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .buttonStyle(PressableButtonStyle())

            Button {
                saveExportToDisk()
            } label: {
                HStack(spacing: 6) {
                    if isExporting {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: selectedFormat == .obsidianVault ? "folder.badge.plus" : "arrow.down.doc.fill")
                            .font(.system(size: 12, weight: .semibold))
                    }
                    Text(isExporting ? "正在处理…" : selectedFormat == .obsidianVault ? "导出至文件夹..." : "导出并保存文件...")
                        .font(EditorialFont.label.weight(.semibold))
                }
                .foregroundStyle(Color.white)
                .padding(.horizontal, 20)
                .padding(.vertical, 8)
                .background(exportCards.isEmpty ? Color.gray.opacity(0.4) : EditorialColor.aiAmber, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .shadow(color: exportCards.isEmpty ? Color.clear : EditorialColor.aiAmber.opacity(0.3), radius: 6, y: 2)
            }
            .buttonStyle(PressableButtonStyle())
            .keyboardShortcut(.return, modifiers: .command)
            .disabled(exportCards.isEmpty || isExporting)
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 14)
    }

    // MARK: - Actions

    private func copyToClipboard() {
        guard !exportCards.isEmpty, !isExporting else { return }
        let cards = exportCards
        let format = selectedFormat
        isExporting = true
        operationTask = Task { @MainActor in
            defer { isExporting = false }
            do {
                let text = try await CardTransferService.content(cards: cards, format: format)
                guard !Task.isCancelled else { return }
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(text, forType: .string)
                triggerToast("已复制 \(cards.count) 张卡片的完整内容")
            } catch {
                guard !Task.isCancelled else { return }
                triggerToast("复制失败：\(error.localizedDescription)", isFailure: true)
            }
        }
    }

    private func saveExportToDisk() {
        guard !exportCards.isEmpty, !isExporting else { return }
        let cards = exportCards
        let format = selectedFormat
        isExporting = true

        let dateStr = Date().formatted(.iso8601.year().month().day().dateSeparator(.dash))

        if selectedFormat == .obsidianVault {
            // Obsidian 集合：选择目标目录并逐文件写入
            let openPanel = NSOpenPanel()
            openPanel.canChooseFiles = false
            openPanel.canChooseDirectories = true
            openPanel.canCreateDirectories = true
            openPanel.prompt = "导出至此文件夹"
            openPanel.title = "选择导出 Obsidian 独立笔记集合的目录"

            let targetWindow = NSApp.keyWindow ?? NSApp.mainWindow
            openPanel.beginSheetModal(for: targetWindow ?? NSWindow()) { response in
                guard response == .OK, let dirURL = openPanel.url else { isExporting = false; return }
                writeExport(cards: cards, format: format, to: dirURL)
            }
            return
        }

        let savePanel = NSSavePanel()
        savePanel.canCreateDirectories = true
        savePanel.isExtensionHidden = false

        switch selectedFormat {
        case .markdownSingle:
            savePanel.allowedContentTypes = [UTType(filenameExtension: "md") ?? .plainText]
            savePanel.nameFieldStringValue = "KnowFlick_Cards_\(dateStr).md"
            savePanel.title = "导出 Markdown 知识笔记"
        case .ankiTSV:
            savePanel.allowedContentTypes = [UTType(filenameExtension: "tsv") ?? .tabSeparatedText, .plainText]
            savePanel.nameFieldStringValue = "KnowFlick_Anki_Deck_\(dateStr).tsv"
            savePanel.title = "导出 Anki 记忆牌组"
        case .jsonArchive:
            savePanel.allowedContentTypes = [.json]
            savePanel.nameFieldStringValue = "KnowFlick_Backup_\(dateStr).json"
            savePanel.title = "导出 JSON 完整数据备份"
        case .obsidianVault:
            break
        }

        savePanel.prompt = "保存"
        let targetWindow = NSApp.keyWindow ?? NSApp.mainWindow

        savePanel.beginSheetModal(for: targetWindow ?? NSWindow()) { response in
            guard response == .OK, let url = savePanel.url else { isExporting = false; return }
            writeExport(cards: cards, format: format, to: url)
        }
    }

    private func writeExport(cards: [KnowledgeCard], format: CardExportFormat, to url: URL) {
        operationTask = Task { @MainActor in
            defer { isExporting = false }
            do {
                let destination = try await CardTransferService.save(cards: cards, format: format, to: url)
                guard !Task.isCancelled else { return }
                triggerToast("已导出 \(cards.count) 张卡片至 \(destination.lastPathComponent)")
            } catch {
                guard !Task.isCancelled else { return }
                triggerToast("保存失败：\(error.localizedDescription)", isFailure: true)
            }
        }
    }

    private func triggerToast(_ message: String, isFailure: Bool = false) {
        toastMessage = message
        toastIsFailure = isFailure
        guard !isFailure else { return }
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            if toastMessage == message {
                toastMessage = nil
                toastIsFailure = false
            }
        }
    }
}
