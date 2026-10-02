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
            InsightColor.surfaceRaised
                .ignoresSafeArea()

            VStack(spacing: 0) {
                header
                Divider().overlay(InsightColor.divider)

                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                    urlCard

                    if isBusy {
                        HStack(spacing: 12) {
                            ProgressView().controlSize(.regular)
                            Text(isFetching ? "正在匿名读取网页…" : "AI 正在提炼知识卡片…")
                                .font(InsightFont.bodyStrong)
                                .foregroundStyle(InsightColor.textSecondary)
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
                            .font(InsightFont.captionSmall)
                            .foregroundStyle(InsightColor.warning)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if let importMessage {
                        Label(importMessage, systemImage: "checkmark.circle.fill")
                            .font(InsightFont.captionSmall)
                            .foregroundStyle(InsightColor.success)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(22)
            }

                Divider().overlay(InsightColor.divider)
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
                .foregroundStyle(InsightColor.accent)

            VStack(alignment: .leading, spacing: 2) {
                Text("网页剪藏")
                    .font(InsightFont.title)
                    .foregroundStyle(InsightColor.textPrimary)
                Text("先预览抽取的正文，再决定是否发送给 AI 提炼。")
                    .font(InsightFont.captionSmall)
                    .foregroundStyle(InsightColor.textTertiary)
            }

            Spacer()

            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(InsightColor.textSecondary)
                    .frame(width: 28, height: 28)
                    .background(InsightColor.surface, in: Circle())
                    .overlay(Circle().strokeBorder(InsightColor.border, lineWidth: 1))
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
                .font(InsightFont.headline)
                .foregroundStyle(InsightColor.textPrimary)

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
                .font(InsightFont.captionSmall)
                .foregroundStyle(InsightColor.textTertiary)
                .fixedSize(horizontal: false, vertical: true)

            if !store.settings.isAIConfigured {
                Text("预览无需配置 AI；提炼前请先在偏好设置中配置 AI 服务。")
                    .font(InsightFont.captionSmall)
                    .foregroundStyle(InsightColor.warning)
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
                    .foregroundStyle(InsightColor.accent)
                VStack(alignment: .leading, spacing: 4) {
                    Text(digest.title.isEmpty ? digest.siteName : digest.title)
                        .font(InsightFont.headline)
                        .foregroundStyle(InsightColor.textPrimary)
                        .textSelection(.enabled)
                    Text(digest.pageURL)
                        .font(InsightFont.captionSmall)
                        .foregroundStyle(InsightColor.textTertiary)
                        .textSelection(.enabled)
                }
            }

            if !digest.description.isEmpty {
                Text(digest.description)
                    .font(InsightFont.callout)
                    .foregroundStyle(InsightColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Divider().overlay(InsightColor.divider)

            Text(digest.text)
                .font(.system(size: 13))
                .foregroundStyle(InsightColor.textPrimary)
                .lineSpacing(4)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)

            if digest.truncated {
                Label("页面超过 4 MB 抓取上限，以上正文可能不完整。", systemImage: "info.circle")
                    .font(InsightFont.captionSmall)
                    .foregroundStyle(InsightColor.warning)
            }
        }
        .padding(16)
        .editorialGlassCard()
    }

    private var cardPreview: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("AI 提炼预览（\(selectedCardIDs.count)/\(cards.count)）", systemImage: "cpu")
                    .font(InsightFont.headline)
                    .foregroundStyle(InsightColor.textPrimary)
                Spacer()
                Button(selectedCardIDs.count == cards.count ? "取消全选" : "全选") {
                    selectedCardIDs = selectedCardIDs.count == cards.count ? [] : Set(cards.map(\.id))
                }
                .buttonStyle(.plain)
                .foregroundStyle(InsightColor.accent)
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
                            .foregroundStyle(InsightColor.accent)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(selectedCardIDs.contains(card.id) ? "取消选择 \(card.headline)" : "选择 \(card.headline)")

                    VStack(alignment: .leading, spacing: 5) {
                        Text(card.headline)
                            .font(InsightFont.bodyStrong.weight(.semibold))
                            .foregroundStyle(InsightColor.textPrimary)
                        Text(card.summary)
                            .font(InsightFont.captionSmall)
                            .foregroundStyle(InsightColor.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                }
                .padding(12)
                .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.control))
                .editorialElevationShadow()
            }

            Toggle(isOn: $insertAtTop) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("置顶到待刷卡堆")
                        .font(InsightFont.callout.weight(.semibold))
                    Text("新卡会优先出现在卡堆前方。")
                        .font(InsightFont.captionSmall)
                        .foregroundStyle(InsightColor.textTertiary)
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
                    .tint(InsightColor.accent)
                    .keyboardShortcut(.defaultAction)
            } else if !cards.isEmpty {
                Button("重新提炼") { transformPage() }
                    .buttonStyle(.bordered)
                    .disabled(isBusy || !store.settings.isAIConfigured)

                Button("确认导入（\(selectedCardIDs.count) 张）") { importSelectedCards() }
                    .buttonStyle(.borderedProminent)
                    .tint(InsightColor.accent)
                    .disabled(selectedCardIDs.isEmpty || isBusy)
                    .keyboardShortcut(.defaultAction)
            } else if digest != nil {
                Button("AI 提炼成卡片") { transformPage() }
                    .buttonStyle(.borderedProminent)
                    .tint(InsightColor.warning)
                    .disabled(isBusy || !store.settings.isAIConfigured)
                    .keyboardShortcut(.defaultAction)
            } else {
                Button(isFetching ? "正在抓取…" : "抓取并预览正文") { fetchPage() }
                    .buttonStyle(.borderedProminent)
                    .tint(InsightColor.accent)
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
