import SwiftUI
import AppKit
import KnowFlickCore

/// AI 知识伴学与卡片深度追问面板。
///
/// 本文件只做编排：会话状态、滚动锚定（含流式节流）、输入栏与顶栏动作；
/// 叶子视图（消息气泡 / 欢迎页 / 追问建议 / 横幅）在 `CardFollowUpChatView+Subviews.swift`。
struct CardFollowUpChatView: View {
    let card: KnowledgeCard
    @Bindable var store: AppStore
    var initialPrompt: String? = nil
    let onClose: () -> Void

    @State private var inputText: String = ""
    @State private var showClearAlert: Bool = false
    @State private var toastMessage: String? = nil
    /// 流式回填的滚动节流时间戳：delta 每秒可达数十次，逐帧 scrollTo 会把
    /// 主线程压在布局+滚动上。节流到 ~120ms 一次，视觉上仍是连续跟随。
    @State private var lastStreamScrollAt: Date = .distantPast
    @FocusState private var isInputFocused: Bool

    private var theme: CategoryTheme {
        CategoryTheme.theme(for: card, cache: .shared)
    }

    var body: some View {
        ZStack {
            InsightColor.canvas.ignoresSafeArea()
            NoiseOverlay().ignoresSafeArea()

            VStack(spacing: 0) {
                headerBar
                Divider().overlay(InsightColor.divider)

                ZStack {
                    if let session = store.currentChatSession, !session.messages.isEmpty {
                        chatScrollView(messages: session.messages)
                    } else {
                        ChatWelcomeStarters(headline: card.displayHeadline) { prompt in
                            AudioEffectManager.shared.playClick()
                            store.sendChatMessage(prompt: prompt)
                        }
                    }
                }

                if let toast = toastMessage {
                    ChatToastBanner(message: toast)
                }

                if let error = store.chatErrorMessage {
                    ChatErrorBanner(message: error)
                }

                Divider().overlay(InsightColor.divider)
                inputBar
            }
        }
        .frame(minWidth: 580, idealWidth: 600, minHeight: 620, idealHeight: 640)
        .onDisappear { store.closeChat() }
        .onAppear {
            store.openChat(for: card)
            if let prompt = initialPrompt, !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                    store.sendChatMessage(prompt: prompt)
                }
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    isInputFocused = true
                }
            }
        }
    }

    // MARK: - 顶栏

    private var headerBar: some View {
        HStack(spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "cpu")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(InsightColor.warning)

                Text("AI 伴学追问")
                    .font(InsightFont.title)
                    .foregroundStyle(InsightColor.textPrimary)

                Text(card.category)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(theme.accent)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(theme.accent.opacity(0.12), in: Capsule())
                    .overlay(Capsule().strokeBorder(theme.accent.opacity(0.3), lineWidth: 1))
            }

            Spacer()

            if let session = store.currentChatSession, !session.messages.isEmpty {
                Button(action: exportChat) {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(InsightColor.textTertiary)
                        .padding(7)
                        .background(InsightColor.surface, in: Circle())
                        .overlay(Circle().strokeBorder(InsightColor.border, lineWidth: 1))
                }
                .buttonStyle(PressableButtonStyle())
                .help("导出对话记录 (Markdown)")

                Button(action: { showClearAlert = true }) {
                    Image(systemName: "trash")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(InsightColor.textTertiary)
                        .padding(7)
                        .background(InsightColor.surface, in: Circle())
                        .overlay(Circle().strokeBorder(InsightColor.border, lineWidth: 1))
                }
                .buttonStyle(PressableButtonStyle())
                .help("清空当前对话")
                .confirmationDialog("确定清空对这张卡片的追问历史吗？", isPresented: $showClearAlert) {
                    Button("清空对话", role: .destructive) {
                        store.clearCurrentChatSession()
                    }
                    Button("取消", role: .cancel) {}
                }
            }

            Button(action: onClose) {
                Text("完成")
                    .font(InsightFont.bodyStrong)
                    .foregroundStyle(InsightColor.textSecondary)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(InsightColor.surface, in: Capsule())
                    .overlay(Capsule().strokeBorder(InsightColor.border, lineWidth: 1))
            }
            .buttonStyle(PressableButtonStyle())
            .keyboardShortcut(.escape, modifiers: [])
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }

    // MARK: - 消息滚动列表

    private func chatScrollView(messages: [CardChatMessage]) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 16) {
                    ForEach(messages) { msg in
                        messageRow(msg)
                            .id(msg.id)
                    }

                    if let last = messages.last, last.sender == .assistant, !last.isStreaming, !last.content.isEmpty {
                        ChatFollowUpSuggestions(lastContent: last.content, parentCard: card) { suggestion in
                            store.sendChatMessage(prompt: suggestion)
                        }
                    }
                }
                .padding(20)
            }
            .onChange(of: messages.count) { _, _ in
                if let last = messages.last {
                    withAnimation(EditorialSpring.exit) { // 消息追加的滚动锚定：快出曲线，归入 exit 档
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
            // 流式回填：节流锚定（每 ~120ms 至多一次），delta 高频到达时不再逐帧 scrollTo
            .onChange(of: messages.last?.content) { _, _ in
                guard let last = messages.last, last.isStreaming else { return }
                let now = Date()
                guard now.timeIntervalSince(lastStreamScrollAt) >= 0.12 else { return }
                lastStreamScrollAt = now
                proxy.scrollTo(last.id, anchor: .bottom)
            }
            // 流结束补一次收尾锚定：节流可能吞掉最后一帧，保证停在回答末尾
            .onChange(of: messages.last?.isStreaming) { _, isStreaming in
                guard isStreaming == false, let last = messages.last else { return }
                withAnimation(EditorialSpring.exit) {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
        }
    }

    private func messageRow(_ msg: CardChatMessage) -> some View {
        ChatMessageRow(
            msg: msg,
            isSaved: store.savedChatCardMessageIds.contains(msg.id),
            onSaveAsCard: { saveAsCard(msg) },
            onSpeak: { store.speechService.speakResponse(msg.content, for: card) },
            onCopy: { copyAnswer(msg) }
        )
    }

    // MARK: - 消息级动作

    private func saveAsCard(_ msg: CardChatMessage) {
        guard !store.savedChatCardMessageIds.contains(msg.id) else { return }
        let newCard = store.deriveAndSaveCardFromChat(message: msg, parentCard: card)
        showToast("已沉淀为新卡片《\(newCard.headline)》并加入卡堆！", duration: 3.0) { current in
            current.contains(newCard.headline)
        }
    }

    private func copyAnswer(_ msg: CardChatMessage) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(msg.content, forType: .string)
        showToast("已复制回答内容 ✓", duration: 2.0) { $0 == "已复制回答内容 ✓" }
    }

    private func exportChat() {
        guard let md = store.exportCurrentChatMarkdown() else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(md, forType: .string)
        showToast("已导出对话 Markdown 至剪贴板 ✓", duration: 2.5) { $0 == "已导出对话 Markdown 至剪贴板 ✓" }
    }

    /// 横幅提示：到点自动清除；`shouldClear` 防止旧任务的延迟误清新提示
    private func showToast(_ message: String, duration: TimeInterval, shouldClear: @escaping (String) -> Bool) {
        toastMessage = message
        DispatchQueue.main.asyncAfter(deadline: .now() + duration) {
            if let current = toastMessage, shouldClear(current) {
                toastMessage = nil
            }
        }
    }

    // MARK: - 底部输入栏

    private var inputBar: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("追问此知识点... (按 ⏎ 发送)", text: $inputText, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...4)
                .font(InsightFont.body)
                .focused($isInputFocused)
                .onSubmit {
                    handleSubmit()
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background {
                    ZStack {
                        InsightColor.surface
                        LinearGradient(
                            stops: [
                                .init(color: Color.white.opacity(0.04), location: 0),
                                .init(color: Color.clear, location: 0.5)
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(isInputFocused ? AnyShapeStyle(InsightColor.accent) : AnyShapeStyle(InsightColor.border), lineWidth: 1)
                )
                .shadow(color: Color.black.opacity(isInputFocused ? 0.12 : 0.06), radius: 6, y: 2)

            if store.isChatStreaming {
                Button(action: {
                    store.cancelChatStreaming()
                }) {
                    ZStack {
                        Circle()
                            .fill(InsightColor.danger.opacity(0.85))
                            .frame(width: 36, height: 36)
                        Image(systemName: "stop.fill")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(.white)
                    }
                }
                .buttonStyle(PressableButtonStyle(scale: 0.94))
                .help("停止生成")
            } else {
                let canSend = !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                Button(action: handleSubmit) {
                    ZStack {
                        Circle()
                            .fill(canSend ? InsightColor.warning : Color.gray.opacity(0.25))
                            .frame(width: 36, height: 36)
                        if canSend {
                            Circle()
                                .strokeBorder(Color.white.opacity(0.35), lineWidth: 1)
                                .frame(width: 36, height: 36)
                        }
                        Image(systemName: "arrow.up")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white)
                    }
                    .shadow(color: canSend ? Color.black.opacity(0.18) : .clear, radius: 6, y: 2)
                }
                .buttonStyle(PressableButtonStyle(scale: 0.94))
                .disabled(!canSend)
                .keyboardShortcut(.return, modifiers: .command)
                .help("发送追问 (⏎ 或 ⌘⏎)")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(InsightColor.canvas.opacity(0.4))
    }

    private func handleSubmit() {
        let trimmed = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !store.isChatStreaming else { return }
        inputText = ""
        store.sendChatMessage(prompt: trimmed)
    }
}
