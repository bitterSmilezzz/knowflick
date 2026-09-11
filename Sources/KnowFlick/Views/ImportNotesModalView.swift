import SwiftUI
import AppKit
import UniformTypeIdentifiers
import KnowFlickCore

/// 笔记导入与智能提炼中心模态弹窗 (⇧⌘I)
struct ImportNotesModalView: View {
    @Bindable var store: AppStore
    var onClose: () -> Void

    enum InputMode: String, CaseIterable, Identifiable {
        case paste = "直接粘贴笔记"
        case file = "选择本地文件"

        var id: String { rawValue }
    }

    enum ExtractionMethod: String, CaseIterable, Identifiable {
        case rules = "规则解析 (Markdown/JSON)"
        case ai = "AI 智能提炼 (长文随笔)"

        var id: String { rawValue }
    }

    @State private var inputMode: InputMode = .paste
    @State private var extractionMethod: ExtractionMethod = .rules
    @State private var noteText: String = ""
    @State private var selectedFileName: String?
    @State private var isProcessing: Bool = false
    @State private var errorMessage: String?

    // 解析结果状态
    @State private var parsedCards: [KnowledgeCard] = []
    @State private var selectedCardIds: Set<UUID> = []
    @State private var insertAtTop: Bool = true
    @State private var importResultDescription: String?
    @State private var toastMessage: String?
    @State private var parsingTask: Task<Void, Never>?
    @State private var readingTask: Task<Void, Never>?
    @State private var closeTask: Task<Void, Never>?

    private var sampleNote: String {
        """
        ---
        category: 物理
        headline: 量子退相干效应
        tags: 量子力学, 测量问题
        ---

        量子系统与周围环境发生相互作用，导致其叠加态量子特性迅速衰减并表现出宏观经典行为的过程。

        退相干解释了为什么宏观世界看不到薛定谔的猫同时处于死和活的叠加态，它是量子计算机保持相干时间的关键挑战。

        ---

        ### 认知科学：双重加工理论
        人类认知由两套系统协作：系统1（快思考，直觉自动化）与系统2（慢思考，深思熟虑与逻辑推演）。

        在学习复杂概念时，初学者需依赖系统2刻意练习；随着熟练度攀升，技能逐渐下沉固化至系统1，从而释放宝贵的工作记忆容量。
        """
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
                        inputConfigCard
                        if isProcessing {
                            processingPlaceholder
                        } else if !parsedCards.isEmpty {
                            previewListCard
                        }
                    }
                    .padding(22)
                }

                Divider().overlay(EditorialColor.glassDivider)
                bottomActionBar
            }

            if let toast = toastMessage {
                VStack {
                    Spacer()
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(EditorialColor.likeGreen)
                        Text(toast)
                            .font(EditorialFont.labelSmall)
                            .foregroundStyle(EditorialColor.textPrimary)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Color.black.opacity(0.85), in: Capsule())
                    .overlay(Capsule().strokeBorder(EditorialColor.likeGreen.opacity(0.6), lineWidth: 1))
                    .shadow(color: Color.black.opacity(0.2), radius: 10, y: 4)
                    .padding(.bottom, 68)
                    .transition(.opacity.combined(with: .scale(scale: 0.95)))
                }
            }
        }
        .frame(minWidth: 740, idealWidth: 780, minHeight: 580, idealHeight: 660)
        .onChange(of: noteText) { _, _ in invalidatePreview() }
        .onChange(of: extractionMethod) { _, _ in invalidatePreview() }
        .onChange(of: inputMode) { _, mode in
            invalidatePreview()
            if mode == .paste { selectedFileName = nil }
        }
        .onDisappear {
            parsingTask?.cancel()
            readingTask?.cancel()
            closeTask?.cancel()
        }
    }

    // MARK: - Header

    private var headerBar: some View {
        HStack(spacing: 12) {
            Image(systemName: "square.and.arrow.down.fill")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(EditorialColor.aiAmber)

            VStack(alignment: .leading, spacing: 2) {
                Text("笔记导入与智能提炼")
                    .font(EditorialFont.modalTitle)
                    .foregroundStyle(EditorialColor.textPrimary)
                Text("支持 Markdown 规则提取、JSON 备份还原及 AI 长文笔记深度解构")
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
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 16)
    }

    // MARK: - Input & Configuration Card

    private var inputConfigCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                HStack(spacing: 6) {
                    Image(systemName: "pencil.and.list.clipboard")
                        .foregroundStyle(EditorialColor.aiAmber)
                    Text("1. 笔记输入与解析方式")
                        .font(EditorialFont.sectionTitle)
                        .foregroundStyle(EditorialColor.textPrimary)
                }

                Spacer()

                Button {
                    noteText = sampleNote
                    selectedFileName = nil
                    inputMode = .paste
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "lightbulb.fill")
                            .font(.system(size: 11))
                        Text("填入示例笔记")
                            .font(EditorialFont.captionSmall)
                    }
                    .foregroundStyle(EditorialColor.aiAmber)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4)
                    .background(EditorialColor.aiAmberBg, in: Capsule())
                    .overlay(Capsule().strokeBorder(EditorialColor.aiAmberBorder, lineWidth: 1))
                }
                .buttonStyle(PressableButtonStyle())
            }

            // 输入方式切换
            HStack(spacing: 12) {
                Picker("输入方式", selection: $inputMode) {
                    ForEach(InputMode.allCases) { mode in
                        Text(mode.rawValue).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 260)

                Spacer()

                // 解析引擎切换
                Picker("解析引擎", selection: $extractionMethod) {
                    ForEach(ExtractionMethod.allCases) { method in
                        Text(method.rawValue).tag(method)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 300)
            }

            if inputMode == .file {
                HStack(spacing: 12) {
                    Button {
                        pickFileFromDisk()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "doc.badge.plus")
                            Text("选取本地笔记文件 (.md / .txt / .json)...")
                                .font(EditorialFont.label)
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                        .foregroundStyle(EditorialColor.textPrimary)
                    }
                    .buttonStyle(PressableButtonStyle())

                    if let name = selectedFileName {
                        HStack(spacing: 6) {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(EditorialColor.likeGreen)
                            Text(name)
                                .font(EditorialFont.captionSmall)
                                .foregroundStyle(EditorialColor.textSecondary)
                        }
                    }

                    Spacer()
                }
            }

            // 文本编辑区域
            VStack(alignment: .leading, spacing: 6) {
                TextEditor(text: $noteText)
                    .font(.system(size: 13, weight: .regular, design: .default))
                    .frame(height: 120)
                    .padding(8)
                    .background(
                        EditorialColor.dynamic(
                            light: NSColor.black.withAlphaComponent(0.03),
                            dark: NSColor.black.withAlphaComponent(0.25)
                        ),
                        in: RoundedRectangle(cornerRadius: 8, style: .continuous)
                    )
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(EditorialColor.glassBorder, lineWidth: 1))

                HStack {
                    Text(extractionMethod == .rules
                        ? "提示：支持识别以 --- 分隔的卡片、# 标题、YAML 元数据或标准 JSON 数组。"
                        : "提示：AI 引擎将自动理解随笔或长文重点，解构提纯为 1~5 张标准核心闪卡。")
                        .font(EditorialFont.captionSmall)
                        .foregroundStyle(EditorialColor.textTertiary)

                    Spacer()

                    Text("\(noteText.count) 字符")
                        .font(EditorialFont.captionSmall)
                        .foregroundStyle(EditorialColor.textMuted)
                }
            }

            if let err = errorMessage {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(EditorialColor.aiAmber)
                    Text(err)
                        .font(EditorialFont.captionSmall)
                        .foregroundStyle(EditorialColor.aiAmber)
                }
                .padding(.top, 2)
            }
        }
        .padding(16)
        .editorialGlassCard()
    }

    // MARK: - Processing Placeholder

    private var processingPlaceholder: some View {
        HStack(spacing: 12) {
            ProgressView()
                .controlSize(.regular)
            Text(extractionMethod == .ai ? "AI 正在解构长文并提纯知识闪卡，请稍候..." : "正在解析笔记内容...")
                .font(EditorialFont.label)
                .foregroundStyle(EditorialColor.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(30)
        .editorialGlassCard()
    }

    // MARK: - Extracted Cards Preview Card

    private var previewListCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                HStack(spacing: 6) {
                    Image(systemName: "checklist")
                        .foregroundStyle(EditorialColor.aiAmber)
                    Text("2. 提炼预览与勾选 (\(selectedCardIds.count)/\(parsedCards.count) 张)")
                        .font(EditorialFont.sectionTitle)
                        .foregroundStyle(EditorialColor.textPrimary)
                }

                Spacer()

                Button(selectedCardIds.count == parsedCards.count ? "取消全选" : "全选全部") {
                    if selectedCardIds.count == parsedCards.count {
                        selectedCardIds.removeAll()
                    } else {
                        selectedCardIds = Set(parsedCards.map(\.id))
                    }
                }
                .font(EditorialFont.captionSmall)
                .foregroundStyle(EditorialColor.aiAmber)
                .buttonStyle(.plain)
            }

            VStack(spacing: 10) {
                ForEach(parsedCards) { card in
                    let isChecked = selectedCardIds.contains(card.id)
                    let isDuplicate = isCardDuplicate(card)
                    ParsedCardRowView(
                        card: card,
                        isChecked: isChecked,
                        isDuplicate: isDuplicate,
                        onToggle: {
                            if isChecked {
                                selectedCardIds.remove(card.id)
                            } else {
                                selectedCardIds.insert(card.id)
                            }
                        }
                    )
                }
            }

            HStack(spacing: 8) {
                Toggle(isOn: $insertAtTop) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("插队置顶到待刷卡堆最前方")
                            .font(EditorialFont.labelSmall.weight(.semibold))
                            .foregroundStyle(EditorialColor.textPrimary)
                        Text("未读卡片按来源与分类筛选后优先排列；备份中的浏览和复习记录保持原样")
                            .font(EditorialFont.captionSmall)
                            .foregroundStyle(EditorialColor.textTertiary)
                    }
                }
                .toggleStyle(.checkbox)
            }
            .padding(.top, 4)
        }
        .padding(16)
        .editorialGlassCard()
    }

    // MARK: - Bottom Action Bar

    private var bottomActionBar: some View {
        HStack(spacing: 12) {
            Button("取消") {
                onClose()
            }
            .font(EditorialFont.label)
            .foregroundStyle(EditorialColor.textSecondary)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .buttonStyle(PressableButtonStyle())

            Spacer()

            if parsedCards.isEmpty {
                Button {
                    parseContent()
                } label: {
                    HStack(spacing: 6) {
                        if isProcessing {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: extractionMethod == .ai ? "sparkles" : "wand.and.stars")
                                .font(.system(size: 12, weight: .semibold))
                        }
                        Text(extractionMethod == .ai ? "AI 深度提炼卡片" : "开始解析笔记")
                            .font(EditorialFont.label.weight(.semibold))
                    }
                    .foregroundStyle(Color.white)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 8)
                    .background(noteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isProcessing ? Color.gray.opacity(0.4) : EditorialColor.aiAmber, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .shadow(color: noteText.isEmpty ? Color.clear : EditorialColor.aiAmber.opacity(0.3), radius: 6, y: 2)
                }
                .buttonStyle(PressableButtonStyle())
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(noteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isProcessing)
            } else {
                Button {
                    parseContent()
                } label: {
                    Text("重新解析")
                        .font(EditorialFont.label)
                        .foregroundStyle(EditorialColor.textSecondary)
                }
                .buttonStyle(PressableButtonStyle())

                Button {
                    commitImport()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark")
                            .font(.system(size: 12, weight: .bold))
                        Text("确认导入 (\(selectedCardIds.count) 张)")
                            .font(EditorialFont.label.weight(.semibold))
                    }
                    .foregroundStyle(Color.white)
                    .padding(.horizontal, 22)
                    .padding(.vertical, 8)
                    .background(selectedCardIds.isEmpty ? Color.gray.opacity(0.4) : EditorialColor.aiAmber, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .shadow(color: selectedCardIds.isEmpty ? Color.clear : EditorialColor.aiAmber.opacity(0.3), radius: 6, y: 2)
                }
                .buttonStyle(PressableButtonStyle())
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(selectedCardIds.isEmpty)
            }
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 14)
    }

    // MARK: - Logic

    private func pickFileFromDisk() {
        let openPanel = NSOpenPanel()
        openPanel.canChooseFiles = true
        openPanel.canChooseDirectories = false
        openPanel.allowsMultipleSelection = false
        openPanel.allowedContentTypes = [
            UTType(filenameExtension: "md") ?? .plainText,
            .plainText,
            .json
        ]
        openPanel.prompt = "选取笔记"
        openPanel.title = "选择导入的笔记文件"

        let targetWindow = NSApp.keyWindow ?? NSApp.mainWindow
        openPanel.beginSheetModal(for: targetWindow ?? NSWindow()) { response in
            guard response == .OK, let url = openPanel.url else { return }
            invalidatePreview()
            isProcessing = true
            readingTask = Task { @MainActor in
                do {
                    let content = try await CardTransferService.readNote(at: url)
                    guard !Task.isCancelled else { return }
                    noteText = content
                    selectedFileName = url.lastPathComponent
                    isProcessing = false
                } catch {
                    guard !Task.isCancelled else { return }
                    isProcessing = false
                    errorMessage = "读取文件失败：\(error.localizedDescription)"
                }
            }
        }
    }

    private func parseContent() {
        parsingTask?.cancel()
        let content = noteText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else {
            errorMessage = "笔记内容不能为空"
            return
        }

        errorMessage = nil
        isProcessing = true

        if extractionMethod == .rules {
            let fileName = selectedFileName
            parsingTask = Task { @MainActor in
                do {
                    let cards = try await CardTransferService.parse(content, fileName: fileName)
                    guard !Task.isCancelled else { return }
                    finishParsing(cards: cards)
                } catch {
                    guard !Task.isCancelled else { return }
                    isProcessing = false
                    errorMessage = "笔记解析失败：\(error.localizedDescription)"
                }
            }
        } else {
            // AI 智能解构
            parsingTask = Task { @MainActor in
                do {
                    let aiCards = try await store.transformNoteToCards(noteContent: content)
                    guard !Task.isCancelled else { return }
                    finishParsing(cards: aiCards)
                } catch {
                    guard !Task.isCancelled else { return }
                    isProcessing = false
                    errorMessage = "AI 提炼失败：\(error.localizedDescription)"
                }
            }
        }
    }

    private func finishParsing(cards: [KnowledgeCard]) {
        isProcessing = false
        if cards.isEmpty {
            errorMessage = "未能在笔记中识别到有效知识卡片，请检查格式或尝试使用 AI 提炼"
            parsedCards = []
            selectedCardIds = []
        } else {
            parsedCards = cards
            selectedCardIds = Set(cards.map(\.id))
        }
    }

    private func invalidatePreview() {
        parsingTask?.cancel()
        readingTask?.cancel()
        isProcessing = false
        parsedCards = []
        selectedCardIds = []
        errorMessage = nil
    }

    private func commitImport() {
        let cardsToImport = parsedCards.filter { selectedCardIds.contains($0.id) }
        guard !cardsToImport.isEmpty else { return }

        let result = store.importCards(cardsToImport, insertAtTop: insertAtTop)
        triggerToast("已成功导入 \(result.parsedCards.count) 张卡片\(result.duplicateCount > 0 ? "（去重跳过 \(result.duplicateCount) 张）" : "")")

        closeTask = Task {
            do { try await Task.sleep(for: .seconds(1.2)) } catch { return }
            onClose()
        }
    }

    private func isCardDuplicate(_ card: KnowledgeCard) -> Bool {
        let norm = CardImportEngine.normalizeHeadline(card.headline)
        return store.cards.contains {
            $0.id == card.id || CardImportEngine.normalizeHeadline($0.headline) == norm
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
}

/// 解析卡片预览单项视图
private struct ParsedCardRowView: View {
    let card: KnowledgeCard
    let isChecked: Bool
    let isDuplicate: Bool
    let onToggle: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button(action: onToggle) {
                Image(systemName: isChecked ? "checkmark.square.fill" : "square")
                    .font(.system(size: 16))
                    .foregroundStyle(isChecked ? EditorialColor.aiAmber : EditorialColor.textTertiary)
            }
            .buttonStyle(.plain)
            .padding(.top, 2)

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text(card.category)
                        .font(EditorialFont.captionSmall.weight(.bold))
                        .foregroundStyle(EditorialColor.aiAmber)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(EditorialColor.aiAmberBg, in: Capsule())
                        .overlay(Capsule().strokeBorder(EditorialColor.aiAmberBorder, lineWidth: 1))

                    Text(card.headline)
                        .font(EditorialFont.label.weight(.semibold))
                        .foregroundStyle(EditorialColor.textPrimary)

                    if isDuplicate {
                        Text("已在库中")
                            .font(EditorialFont.captionSmall)
                            .foregroundStyle(EditorialColor.aiAmber)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(EditorialColor.aiAmberBg, in: Capsule())
                    }

                    Spacer()
                }

                Text(card.summary)
                    .font(EditorialFont.caption)
                    .foregroundStyle(EditorialColor.textSecondary)
                    .lineLimit(2)

                if !card.details.isEmpty {
                    Text(card.details)
                        .font(EditorialFont.captionSmall)
                        .foregroundStyle(EditorialColor.textTertiary)
                        .lineLimit(2)
                }
            }
        }
        .padding(12)
        .background(
            isChecked ? EditorialColor.glassSurface : EditorialColor.glassSurface.opacity(0.4),
            in: RoundedRectangle(cornerRadius: EditorialRadius.control, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: EditorialRadius.control, style: .continuous)
                .strokeBorder(isChecked ? EditorialColor.glassBorder : Color.clear, lineWidth: 1)
        )
    }
}
