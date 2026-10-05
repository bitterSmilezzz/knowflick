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
    @State private var toast = ToastCenter()
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
            InsightColor.canvas
                .ignoresSafeArea()

            VStack(spacing: 0) {
                headerBar
                Divider().overlay(InsightColor.divider)

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

                Divider().overlay(InsightColor.divider)
                bottomActionBar
            }

            VStack {
                Spacer()
                InsightToast(center: toast, edge: .bottom)
                    .padding(.bottom, 68)
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
            ZStack {
                Circle()
                    .fill(InsightColor.accentSoft)
                    .frame(width: 38, height: 38)
                Image(systemName: "square.and.arrow.down.fill")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(InsightColor.accent)
            }
            .overlay(Circle().strokeBorder(InsightColor.accent.opacity(0.3), lineWidth: 1))

            VStack(alignment: .leading, spacing: 2) {
                Text("笔记导入与智能提炼")
                    .font(InsightFont.title)
                    .foregroundStyle(InsightColor.textPrimary)
                Text("支持 Markdown 规则提取、JSON 备份还原及 AI 长文笔记深度解构")
                    .font(InsightFont.captionSmall)
                    .foregroundStyle(InsightColor.textTertiary)
            }

            Spacer()

            GlassIconButton(icon: "xmark", help: "关闭 (Esc)") {
                onClose()
            }
            .keyboardShortcut(.escape, modifiers: [])
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
                        .foregroundStyle(InsightColor.accent)
                    Text("1. 笔记输入与解析方式")
                        .font(InsightFont.headline)
                        .foregroundStyle(InsightColor.textPrimary)
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
                            .font(InsightFont.captionSmall)
                    }
                    .foregroundStyle(InsightColor.accent)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4)
                    .background(InsightColor.accentSoft, in: Capsule())
                    .overlay(Capsule().strokeBorder(InsightColor.accent, lineWidth: 1))
                }
                .buttonStyle(PressableButtonStyle())
            }

            // 输入方式 + 解析引擎：两列均分（固定宽 260/300 在 minWidth 740 的 sheet 里
            // 会把右侧 Picker 顶出卡片边界）
            HStack(spacing: 12) {
                Picker("输入方式", selection: $inputMode) {
                    ForEach(InputMode.allCases) { mode in
                        Text(mode.rawValue).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .accessibilityLabel("输入方式")
                .frame(maxWidth: .infinity)

                Picker("解析引擎", selection: $extractionMethod) {
                    ForEach(ExtractionMethod.allCases) { method in
                        Text(method.rawValue).tag(method)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .accessibilityLabel("解析引擎")
                .frame(maxWidth: .infinity)
            }

            if inputMode == .file {
                HStack(spacing: 12) {
                    Button {
                        pickFileFromDisk()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "doc.badge.plus")
                            Text("选取本地笔记文件 (.md / .txt / .json)...")
                                .font(InsightFont.bodyStrong)
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(InsightColor.border, lineWidth: 1))
                        .foregroundStyle(InsightColor.textPrimary)
                    }
                    .buttonStyle(PressableButtonStyle())

                    if let name = selectedFileName {
                        HStack(spacing: 6) {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(InsightColor.success)
                            Text(name)
                                .font(InsightFont.captionSmall)
                                .foregroundStyle(InsightColor.textSecondary)
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
                        InsightColor.dynamic(
                            light: NSColor.black.withAlphaComponent(0.03),
                            dark: NSColor.black.withAlphaComponent(0.25)
                        ),
                        in: RoundedRectangle(cornerRadius: 8, style: .continuous)
                    )
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(InsightColor.border, lineWidth: 1))

                HStack {
                    Text(extractionMethod == .rules
                        ? "提示：支持识别以 --- 分隔的卡片、# 标题、YAML 元数据或标准 JSON 数组。"
                        : "提示：AI 引擎将自动理解随笔或长文重点，解构提纯为 1~5 张标准核心闪卡。")
                        .font(InsightFont.captionSmall)
                        .foregroundStyle(InsightColor.textTertiary)

                    Spacer()

                    Text("\(noteText.count) 字符")
                        .font(InsightFont.captionSmall)
                        .foregroundStyle(InsightColor.textMuted)
                }
            }

            if let err = errorMessage {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(InsightColor.warning)
                    Text(err)
                        .font(InsightFont.captionSmall)
                        .foregroundStyle(InsightColor.warning)
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
                .font(InsightFont.bodyStrong)
                .foregroundStyle(InsightColor.textSecondary)
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
                        .foregroundStyle(InsightColor.accent)
                    Text("2. 提炼预览与勾选 (\(selectedCardIds.count)/\(parsedCards.count) 张)")
                        .font(InsightFont.headline)
                        .foregroundStyle(InsightColor.textPrimary)
                }

                Spacer()

                Button(selectedCardIds.count == parsedCards.count ? "取消全选" : "全选全部") {
                    if selectedCardIds.count == parsedCards.count {
                        selectedCardIds.removeAll()
                    } else {
                        selectedCardIds = Set(parsedCards.map(\.id))
                    }
                }
                .font(InsightFont.captionSmall)
                .foregroundStyle(InsightColor.accent)
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
                            .font(InsightFont.callout.weight(.semibold))
                            .foregroundStyle(InsightColor.textPrimary)
                        Text("未读卡片按来源与分类筛选后优先排列；备份中的浏览和复习记录保持原样")
                            .font(InsightFont.captionSmall)
                            .foregroundStyle(InsightColor.textTertiary)
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
            .font(InsightFont.bodyStrong)
            .foregroundStyle(InsightColor.textSecondary)
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
                            Image(systemName: extractionMethod == .ai ? "cpu" : "gearshape")
                                .font(.system(size: 12, weight: .semibold))
                        }
                        Text(extractionMethod == .ai ? "AI 深度提炼卡片" : "开始解析笔记")
                            .font(InsightFont.bodyStrong.weight(.semibold))
                    }
                    .foregroundStyle(Color.white)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 8)
                    // AI 档保留琥珀（AI 提炼语义）；规则档归位选中蓝，与其余主 CTA 一致
                    .background(
                        noteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isProcessing
                            ? Color.gray.opacity(0.4)
                            : (extractionMethod == .ai ? InsightColor.warning : InsightColor.accent),
                        in: RoundedRectangle(cornerRadius: 8, style: .continuous)
                    )
                    .shadow(
                        color: noteText.isEmpty ? Color.clear
                            : (extractionMethod == .ai ? InsightColor.warning : InsightColor.accent).opacity(0.3),
                        radius: 6, y: 2
                    )
                }
                .buttonStyle(PressableButtonStyle())
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(noteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isProcessing)
            } else {
                Button {
                    parseContent()
                } label: {
                    Text("重新解析")
                        .font(InsightFont.bodyStrong)
                        .foregroundStyle(InsightColor.textSecondary)
                }
                .buttonStyle(PressableButtonStyle())
                // 解析中禁止重复触发：否则会反复 cancel/restart 解析任务
                .disabled(isProcessing)

                Button {
                    commitImport()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark")
                            .font(.system(size: 12, weight: .bold))
                        Text("确认导入 (\(selectedCardIds.count) 张)")
                            .font(InsightFont.bodyStrong.weight(.semibold))
                    }
                    .foregroundStyle(Color.white)
                    .padding(.horizontal, 22)
                    .padding(.vertical, 8)
                    .background(selectedCardIds.isEmpty ? Color.gray.opacity(0.4) : InsightColor.accent, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .shadow(color: selectedCardIds.isEmpty ? Color.clear : Color.black.opacity(0.12), radius: 4, y: 2)
                }
                .buttonStyle(PressableButtonStyle())
                .keyboardShortcut(.return, modifiers: .command)
                // 解析中禁用：此时 parsedCards 仍是上一轮结果，允许点击会导入过期数据
                .disabled(selectedCardIds.isEmpty || isProcessing)
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
        PanelPresenter.present(openPanel, in: targetWindow) { response in
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
        toast.show("已成功导入 \(result.parsedCards.count) 张卡片\(result.duplicateCount > 0 ? "（去重跳过 \(result.duplicateCount) 张）" : "")")

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
                    .foregroundStyle(isChecked ? InsightColor.accent : InsightColor.textTertiary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isChecked ? "取消选择此卡片" : "选择此卡片")
            .accessibilityAddTraits(isChecked ? [.isSelected] : [])
            .padding(.top, 2)

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text(card.category)
                        .font(InsightFont.captionSmall.weight(.bold))
                        .foregroundStyle(InsightColor.accent)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(InsightColor.accentSoft, in: Capsule())
                        .overlay(Capsule().strokeBorder(InsightColor.accent, lineWidth: 1))

                    Text(card.displayHeadline)
                        .font(InsightFont.bodyStrong.weight(.semibold))
                        .foregroundStyle(InsightColor.textPrimary)

                    if isDuplicate {
                        Text("已在库中")
                            .font(InsightFont.captionSmall)
                            .foregroundStyle(InsightColor.warning)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(InsightColor.warningSoft, in: Capsule())
                    }

                    Spacer()
                }

                Text(card.displaySummary)
                    .font(InsightFont.caption)
                    .foregroundStyle(InsightColor.textSecondary)
                    .lineLimit(2)

                if !card.details.isEmpty {
                    Text(card.details)
                        .font(InsightFont.captionSmall)
                        .foregroundStyle(InsightColor.textTertiary)
                        .lineLimit(2)
                }
            }
        }
        .padding(12)
        .background(
            isChecked ? InsightColor.surface : InsightColor.surface.opacity(0.4),
            in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
                .strokeBorder(isChecked ? InsightColor.border : Color.clear, lineWidth: 1)
        )
    }
}
