import SwiftUI
import AppKit
import KnowFlickCore

/// Fetches and previews a page before the user sends its text to their configured AI service.
struct WebClipModalView: View {
    @Bindable var store: AppStore
    let onClose: () -> Void

    @State private var urlText = ""
    @State private var digest: WebClipDigest?
    @State private var cards: [KnowledgeCard] = []
    @State private var selectedCardIDs: Set<UUID> = []
    @State private var insertAtTop = true
    @State private var isFetching = false
    @State private var isTransforming = false
    @State private var errorMessage: String?
    @State private var importMessage: String?
    @State private var fetchTask: Task<Void, Never>?
    @State private var transformTask: Task<Void, Never>?

    private var isBusy: Bool { isFetching || isTransforming }
    private var canFetch: Bool { !urlText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        ZStack {
            EditorialColor.dynamic(
                light: NSColor.windowBackgroundColor.withAlphaComponent(0.97),
                dark: NSColor(white: 0.12, alpha: 0.97)
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                header
                Divider().overlay(EditorialColor.glassDivider)

                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                    urlCard

                    if isBusy {
                        HStack(spacing: 12) {
                            ProgressView().controlSize(.regular)
                            Text(isFetching ? "正在匿名读取网页…" : "AI 正在提炼知识卡片…")
                                .font(EditorialFont.label)
                                .foregroundStyle(EditorialColor.textSecondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(18)
                        .editorialGlassCard()
                    }

                    if let digest {
                        pagePreview(digest)
                    }

                    if !cards.isEmpty {
                        cardPreview
                    }

                    if let errorMessage {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .font(EditorialFont.captionSmall)
                            .foregroundStyle(EditorialColor.aiAmber)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if let importMessage {
                        Label(importMessage, systemImage: "checkmark.circle.fill")
                            .font(EditorialFont.captionSmall)
                            .foregroundStyle(EditorialColor.likeGreen)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(22)
            }

                Divider().overlay(EditorialColor.glassDivider)
                footer
            }
        }
        .frame(minWidth: 700, idealWidth: 780, minHeight: 560, idealHeight: 680)
        .onChange(of: urlText) { _, _ in resetForURLChange() }
        .onDisappear {
            fetchTask?.cancel()
            transformTask?.cancel()
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "link")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(EditorialColor.aiAmber)

            VStack(alignment: .leading, spacing: 2) {
                Text("网页剪藏")
                    .font(EditorialFont.modalTitle)
                    .foregroundStyle(EditorialColor.textPrimary)
                Text("先预览抽取的正文，再决定是否发送给 AI 提炼。")
                    .font(EditorialFont.captionSmall)
                    .foregroundStyle(EditorialColor.textTertiary)
            }

            Spacer()

            Button(action: onClose) {
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

    private var urlCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("输入文章链接", systemImage: "safari")
                .font(EditorialFont.sectionTitle)
                .foregroundStyle(EditorialColor.textPrimary)

            HStack(spacing: 10) {
                TextField("https://example.com/article", text: $urlText)
                    .textFieldStyle(.roundedBorder)
                    .disabled(isBusy || importMessage != nil)
                    .accessibilityLabel("网页链接")

                if digest != nil || importMessage != nil {
                    Button("更换链接") { resetForURLChange(); urlText = "" }
                        .buttonStyle(.bordered)
                        .disabled(isBusy)
                }
            }

            Text("请求不携带 Cookie。正文和原文链接不会自动入库；只有点击 AI 提炼后才会发送到已配置的 AI 服务。")
                .font(EditorialFont.captionSmall)
                .foregroundStyle(EditorialColor.textTertiary)
                .fixedSize(horizontal: false, vertical: true)

            if !store.settings.isAIConfigured {
                Text("预览无需配置 AI；提炼前请先在偏好设置中配置 AI 服务。")
                    .font(EditorialFont.captionSmall)
                    .foregroundStyle(EditorialColor.aiAmber)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .editorialGlassCard()
    }

    private func pagePreview(_ digest: WebClipDigest) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "doc.text.magnifyingglass")
                    .foregroundStyle(EditorialColor.aiAmber)
                VStack(alignment: .leading, spacing: 4) {
                    Text(digest.title.isEmpty ? digest.siteName : digest.title)
                        .font(EditorialFont.sectionTitle)
                        .foregroundStyle(EditorialColor.textPrimary)
                        .textSelection(.enabled)
                    Text(digest.pageURL)
                        .font(EditorialFont.captionSmall)
                        .foregroundStyle(EditorialColor.textTertiary)
                        .textSelection(.enabled)
                }
            }

            if !digest.description.isEmpty {
                Text(digest.description)
                    .font(EditorialFont.labelSmall)
                    .foregroundStyle(EditorialColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Divider().overlay(EditorialColor.glassDivider)

            Text(digest.text)
                .font(.system(size: 13))
                .foregroundStyle(EditorialColor.textPrimary)
                .lineSpacing(4)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)

            if digest.truncated {
                Label("页面超过 4 MB 抓取上限，以上正文可能不完整。", systemImage: "info.circle")
                    .font(EditorialFont.captionSmall)
                    .foregroundStyle(EditorialColor.aiAmber)
            }
        }
        .padding(16)
        .editorialGlassCard()
    }

    private var cardPreview: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("AI 提炼预览（\(selectedCardIDs.count)/\(cards.count)）", systemImage: "sparkles")
                    .font(EditorialFont.sectionTitle)
                    .foregroundStyle(EditorialColor.textPrimary)
                Spacer()
                Button(selectedCardIDs.count == cards.count ? "取消全选" : "全选") {
                    selectedCardIDs = selectedCardIDs.count == cards.count ? [] : Set(cards.map(\.id))
                }
                .buttonStyle(.plain)
                .foregroundStyle(EditorialColor.aiAmber)
            }

            ForEach(cards) { card in
                HStack(alignment: .top, spacing: 10) {
                    Button {
                        if selectedCardIDs.contains(card.id) {
                            selectedCardIDs.remove(card.id)
                        } else {
                            selectedCardIDs.insert(card.id)
                        }
                    } label: {
                        Image(systemName: selectedCardIDs.contains(card.id) ? "checkmark.square.fill" : "square")
                            .foregroundStyle(EditorialColor.aiAmber)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(selectedCardIDs.contains(card.id) ? "取消选择 \(card.headline)" : "选择 \(card.headline)")

                    VStack(alignment: .leading, spacing: 5) {
                        Text(card.headline)
                            .font(EditorialFont.label.weight(.semibold))
                            .foregroundStyle(EditorialColor.textPrimary)
                        Text(card.summary)
                            .font(EditorialFont.captionSmall)
                            .foregroundStyle(EditorialColor.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                }
                .padding(12)
                .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 9))
            }

            Toggle(isOn: $insertAtTop) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("置顶到待刷卡堆")
                        .font(EditorialFont.labelSmall.weight(.semibold))
                    Text("新卡会优先出现在卡堆前方。")
                        .font(EditorialFont.captionSmall)
                        .foregroundStyle(EditorialColor.textTertiary)
                }
            }
            .toggleStyle(.checkbox)
        }
        .padding(16)
        .editorialGlassCard()
    }

    private var footer: some View {
        HStack(spacing: 12) {
            Button("取消", action: onClose)
                .buttonStyle(PressableButtonStyle())
                .keyboardShortcut(.cancelAction)

            Spacer()

            if importMessage != nil {
                Button("完成", action: onClose)
                    .buttonStyle(.borderedProminent)
                    .tint(EditorialColor.aiAmber)
                    .keyboardShortcut(.defaultAction)
            } else if !cards.isEmpty {
                Button("重新提炼") { transformPage() }
                    .buttonStyle(.bordered)
                    .disabled(isBusy || !store.settings.isAIConfigured)

                Button("确认导入（\(selectedCardIDs.count) 张）") { importSelectedCards() }
                    .buttonStyle(.borderedProminent)
                    .tint(EditorialColor.aiAmber)
                    .disabled(selectedCardIDs.isEmpty || isBusy)
                    .keyboardShortcut(.defaultAction)
            } else if digest != nil {
                Button("AI 提炼成卡片") { transformPage() }
                    .buttonStyle(.borderedProminent)
                    .tint(EditorialColor.aiAmber)
                    .disabled(isBusy || !store.settings.isAIConfigured)
                    .keyboardShortcut(.defaultAction)
            } else {
                Button(isFetching ? "正在抓取…" : "抓取并预览正文") { fetchPage() }
                    .buttonStyle(.borderedProminent)
                    .tint(EditorialColor.aiAmber)
                    .disabled(!canFetch || isBusy)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 14)
    }

    private func fetchPage() {
        let submittedText = urlText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !submittedText.isEmpty, !isBusy else { return }
        fetchTask?.cancel()
        transformTask?.cancel()
        errorMessage = nil
        importMessage = nil
        digest = nil
        cards = []
        selectedCardIDs = []
        isFetching = true

        fetchTask = Task { @MainActor in
            do {
                let result = try await WebClipFetcher.clip(text: submittedText)
                guard !Task.isCancelled, urlText.trimmingCharacters(in: .whitespacesAndNewlines) == submittedText else { return }
                digest = result
                isFetching = false
            } catch {
                guard !Task.isCancelled else { return }
                isFetching = false
                errorMessage = "网页读取失败：\(error.localizedDescription)"
            }
        }
    }

    private func transformPage() {
        guard let digest, store.settings.isAIConfigured, !isBusy else { return }
        let note = digest.aiNote
        isFetching = false
        isTransforming = true
        errorMessage = nil
        importMessage = nil
        cards = []
        selectedCardIDs = []

        transformTask = Task { @MainActor in
            do {
                let transformed = try await store.transformNoteToCards(noteContent: note)
                guard !Task.isCancelled, self.digest?.pageURL == digest.pageURL else { return }
                let attributed = digest.attributing(transformed)
                cards = attributed
                selectedCardIDs = Set(attributed.map(\.id))
                isTransforming = false
                if attributed.isEmpty {
                    errorMessage = "AI 没有返回可导入的卡片，请重新提炼或检查网页正文。"
                }
            } catch {
                guard !Task.isCancelled else { return }
                isTransforming = false
                errorMessage = "AI 提炼失败：\(error.localizedDescription)"
            }
        }
    }

    private func importSelectedCards() {
        let selected = cards.filter { selectedCardIDs.contains($0.id) }
        guard !selected.isEmpty else { return }
        let result = store.importCards(selected, insertAtTop: insertAtTop)
        importMessage = "导入完成：新增 \(result.parsedCards.count) 张，跳过重复卡 \(result.duplicateCount) 张。"
    }

    private func resetForURLChange() {
        fetchTask?.cancel()
        transformTask?.cancel()
        digest = nil
        cards = []
        selectedCardIDs = []
        isFetching = false
        isTransforming = false
        errorMessage = nil
        importMessage = nil
    }
}
