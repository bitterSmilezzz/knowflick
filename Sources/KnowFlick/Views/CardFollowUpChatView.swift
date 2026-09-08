import SwiftUI
import AppKit
import KnowFlickCore

/// AI 知识伴学与卡片深度追问面板
struct CardFollowUpChatView: View {
    let card: KnowledgeCard
    @Bindable var store: AppStore
    let onClose: () -> Void

    @State private var inputText: String = ""
    @State private var showClearAlert: Bool = false
    @FocusState private var isInputFocused: Bool

    private var theme: CategoryTheme {
        CategoryTheme.theme(for: card, cache: .shared)
    }

    private let starters: [(icon: String, text: String)] = [
        ("💡", "用小学生都能听懂的生活比喻，解释它的底层运转机理"),
        ("🔍", "在工业界、现实生活或前沿科技中有哪些典型应用或反转案例？"),
        ("⚡", "这个概念与哪些其他学科存在意料之外的交叉与碰撞？"),
        ("❓", "学术界最初是如何发现它的？背后有什么争议或思维迭代？")
    ]

    var body: some View {
        ZStack {
            EditorialColor.canvasGradient.ignoresSafeArea()
            NoiseOverlay().ignoresSafeArea()

            VStack(spacing: 0) {
                headerBar
                Divider().overlay(EditorialColor.glassDivider)

                ZStack {
                    if let session = store.currentChatSession, !session.messages.isEmpty {
                        chatScrollView(messages: session.messages)
                    } else {
                        welcomeAndStartersView
                    }
                }

                if let error = store.chatErrorMessage {
                    errorBanner(message: error)
                }

                Divider().overlay(EditorialColor.glassDivider)
                inputBar
            }
        }
        .frame(width: 580, height: 620)
        .onDisappear { store.closeChat() }
        .onAppear {
            store.openChat(for: card)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                isInputFocused = true
            }
        }
    }

    // MARK: - 顶栏

    private var headerBar: some View {
        HStack(spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(EditorialColor.aiAmber)

                Text("AI 伴学追问")
                    .font(EditorialFont.modalTitle)
                    .foregroundStyle(EditorialColor.textPrimary)

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
                Button(action: { showClearAlert = true }) {
                    Image(systemName: "trash")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(EditorialColor.textTertiary)
                        .padding(7)
                        .background(EditorialColor.glassSurface, in: Circle())
                        .overlay(Circle().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
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
                    .font(EditorialFont.label)
                    .foregroundStyle(EditorialColor.textSecondary)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(EditorialColor.glassSurface, in: Capsule())
                    .overlay(Capsule().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
            }
            .buttonStyle(PressableButtonStyle())
            .keyboardShortcut(.escape, modifiers: [])
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }

    // MARK: - 空状态与启发式提问

    private var welcomeAndStartersView: some View {
        ScrollView {
            VStack(spacing: 24) {
                VStack(spacing: 12) {
                    ZStack {
                        Circle()
                            .fill(RadialGradient(
                                colors: [EditorialColor.aiAmber.opacity(0.25), .clear],
                                center: .center,
                                startRadius: 0,
                                endRadius: 36
                            ))
                            .frame(width: 72, height: 72)

                        Image(systemName: "lightbulb.min.badge.magnifyingglass")
                            .font(.system(size: 28, weight: .medium))
                            .foregroundStyle(EditorialColor.aiAmber)
                    }

                    Text("探讨《\(card.headline)》")
                        .font(.system(size: 16, weight: .bold, design: .serif))
                        .foregroundStyle(EditorialColor.textPrimary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)

                    Text("知识卡片篇幅有限，而好奇心无限。\n选择下方启发性切入点，或直接在底部输入你的独特思考。")
                        .font(EditorialFont.caption)
                        .foregroundStyle(EditorialColor.textSecondary)
                        .multilineTextAlignment(.center)
                        .lineSpacing(4)
                        .padding(.horizontal, 28)
                }
                .padding(.top, 28)

                VStack(alignment: .leading, spacing: 10) {
                    Text("启发式追问 (Click to Ask)")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(EditorialColor.textTertiary)
                        .padding(.horizontal, 4)

                    VStack(spacing: 9) {
                        ForEach(starters, id: \.text) { starter in
                            Button(action: {
                                store.sendChatMessage(prompt: starter.text)
                            }) {
                                HStack(alignment: .top, spacing: 12) {
                                    Text(starter.icon)
                                        .font(.system(size: 16))

                                    Text(starter.text)
                                        .font(EditorialFont.bodySerif)
                                        .foregroundStyle(EditorialColor.textPrimary)
                                        .multilineTextAlignment(.leading)
                                        .lineSpacing(3)

                                    Spacer()

                                    Image(systemName: "arrow.up.circle.fill")
                                        .font(.system(size: 14))
                                        .foregroundStyle(EditorialColor.aiAmber.opacity(0.8))
                                }
                                .padding(.horizontal, 14)
                                .padding(.vertical, 12)
                                .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                                        .strokeBorder(EditorialColor.glassBorder, lineWidth: 1)
                                )
                            }
                            .buttonStyle(PressableButtonStyle())
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 20)
            }
        }
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
                }
                .padding(20)
            }
            .onChange(of: messages.count) { _, _ in
                if let last = messages.last {
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
            .onChange(of: messages.last?.content) { _, _ in
                if let last = messages.last, last.isStreaming {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
        }
    }

    // MARK: - 单条消息气泡

    private func messageRow(_ msg: CardChatMessage) -> some View {
        HStack(alignment: .top, spacing: 10) {
            if msg.sender == .assistant {
                ZStack {
                    Circle()
                        .fill(EditorialColor.aiAmber.opacity(0.16))
                        .frame(width: 28, height: 28)
                    Image(systemName: "sparkles")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(EditorialColor.aiAmber)
                }
                .padding(.top, 2)
            } else {
                Spacer(minLength: 40)
            }

            VStack(alignment: msg.sender == .user ? .trailing : .leading, spacing: 6) {
                HStack {
                    if msg.sender == .user {
                        Spacer()
                    }
                    Text(msg.sender == .user ? "你" : "KnowFlick 伴学导师")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(EditorialColor.textTertiary)
                }

                VStack(alignment: .leading, spacing: 8) {
                    if msg.content.isEmpty && msg.isStreaming {
                        HStack(spacing: 4) {
                            Text("正在推演构思...")
                                .font(EditorialFont.caption)
                                .foregroundStyle(EditorialColor.textSecondary)
                            ProgressView()
                                .controlSize(.mini)
                        }
                        .padding(.vertical, 4)
                    } else {
                        Text(LocalizedStringKey(msg.content))
                            .font(EditorialFont.bodySerif)
                            .foregroundStyle(EditorialColor.textPrimary)
                            .lineSpacing(5)
                            .textSelection(.enabled)
                    }

                    if msg.isStreaming {
                        Text("▋")
                            .font(.system(size: 13, weight: .black))
                            .foregroundStyle(EditorialColor.aiAmber)
                            .opacity(0.85)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
                .background(
                    msg.sender == .user
                        ? EditorialColor.aiAmber.opacity(0.12)
                        : EditorialColor.glassSurface,
                    in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(
                            msg.sender == .user
                                ? EditorialColor.aiAmber.opacity(0.3)
                                : EditorialColor.glassBorder,
                            lineWidth: 1
                        )
                )

                // 助手回答工具栏（朗读 + 复制）
                if msg.sender == .assistant && !msg.content.isEmpty && !msg.isStreaming {
                    HStack(spacing: 12) {
                        Button(action: {
                            store.speechService.speakResponse(msg.content, for: card)
                        }) {
                            HStack(spacing: 4) {
                                Image(systemName: "speaker.wave.2.fill")
                                    .font(.system(size: 10))
                                Text("朗读此回答")
                                    .font(.system(size: 11, weight: .medium))
                            }
                            .foregroundStyle(EditorialColor.textSecondary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(EditorialColor.glassSurface, in: Capsule())
                            .overlay(Capsule().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                        }
                        .buttonStyle(PressableButtonStyle())

                        Button(action: {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(msg.content, forType: .string)
                        }) {
                            HStack(spacing: 4) {
                                Image(systemName: "doc.on.doc")
                                    .font(.system(size: 10))
                                Text("复制")
                                    .font(.system(size: 11, weight: .medium))
                            }
                            .foregroundStyle(EditorialColor.textSecondary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(EditorialColor.glassSurface, in: Capsule())
                            .overlay(Capsule().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                        }
                        .buttonStyle(PressableButtonStyle())

                        Spacer()
                    }
                    .padding(.leading, 2)
                    .padding(.top, 2)
                }
            }

            if msg.sender == .user {
                ZStack {
                    Circle()
                        .fill(Color.accentColor.opacity(0.14))
                        .frame(width: 28, height: 28)
                    Image(systemName: "person.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.accentColor)
                }
                .padding(.top, 2)
            } else {
                Spacer(minLength: 40)
            }
        }
    }

    // MARK: - 错误提示

    private func errorBanner(message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
                .font(.system(size: 12))
            Text(message)
                .font(EditorialFont.caption)
                .foregroundStyle(EditorialColor.textPrimary)
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Color.red.opacity(0.12))
    }

    // MARK: - 底部输入栏

    private var inputBar: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("追问此知识点... (按 ⏎ 发送)", text: $inputText, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...4)
                .font(EditorialFont.bodySerif)
                .focused($isInputFocused)
                .onSubmit {
                    handleSubmit()
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(EditorialColor.glassBorder, lineWidth: 1)
                )

            if store.isChatStreaming {
                Button(action: {
                    store.cancelChatStreaming()
                }) {
                    ZStack {
                        Circle()
                            .fill(Color.red.opacity(0.85))
                            .frame(width: 36, height: 36)
                        Image(systemName: "stop.fill")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(.white)
                    }
                }
                .buttonStyle(PressableButtonStyle())
                .help("停止生成")
            } else {
                Button(action: handleSubmit) {
                    ZStack {
                        Circle()
                            .fill(inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Color.gray.opacity(0.3) : EditorialColor.aiAmber)
                            .frame(width: 36, height: 36)
                        Image(systemName: "arrow.up")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white)
                    }
                }
                .buttonStyle(PressableButtonStyle())
                .disabled(inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .help("发送追问 (⏎)")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(EditorialColor.canvasDark.opacity(0.4))
    }

    private func handleSubmit() {
        let trimmed = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !store.isChatStreaming else { return }
        inputText = ""
        store.sendChatMessage(prompt: trimmed)
    }
}
