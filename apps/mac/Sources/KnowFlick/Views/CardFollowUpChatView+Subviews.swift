import SwiftUI
import AppKit
import KnowFlickCore

// MARK: - 追问面板子件（自 678 行主文件拆出，行为与视觉不变）
//
// 抽取原则：只搬「叶子视图」——数据以参数传入、动作以闭包上报，
// 主文件保留编排（会话状态、滚动锚定、输入栏与 FocusState）。
// 拆分的核心动因是让流式渲染的性能改动（滚动节流）有清晰的落点，
// 而不是为了行数好看。

// MARK: 欢迎页与启发式切入点

struct ChatWelcomeStarters: View {
    let headline: String
    let onAsk: (String) -> Void

    struct StarterItem: Identifiable {
        let id = UUID()
        let icon: String
        let title: String
        let subtitle: String
        let prompt: String
    }

    private let starters: [StarterItem] = [
        StarterItem(
            icon: "lightbulb.fill",
            title: "生活化比喻",
            subtitle: "用小学生都能懂的生活比喻拆解运转机理",
            prompt: "用小学生都能听懂的生活比喻，解释它的底层运转机理"
        ),
        StarterItem(
            icon: "atom",
            title: "现实应用",
            subtitle: "工业界、日常生活或前沿科技的反转案例",
            prompt: "在工业界、现实生活或前沿科技中有哪些典型应用或反转案例？"
        ),
        StarterItem(
            icon: "arrow.triangle.merge",
            title: "跨界交叉",
            subtitle: "与其他不同学科意料之外的思维交汇与碰撞",
            prompt: "这个概念与哪些其他学科存在意料之外的交叉与碰撞？"
        ),
        StarterItem(
            icon: "clock.arrow.circlepath",
            title: "思维演进",
            subtitle: "最初如何被发现及学术界的争论迭代脉络",
            prompt: "学术界最初是如何发现它的？背后有什么争议或思维迭代？"
        )
    ]

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                VStack(spacing: 10) {
                    ZStack {
                        Circle()
                            .fill(RadialGradient(
                                colors: [InsightColor.warning.opacity(0.28), .clear],
                                center: .center,
                                startRadius: 0,
                                endRadius: 28
                            ))
                            .frame(width: 56, height: 56)

                        Image(systemName: "sparkles")
                            .font(.system(size: 24, weight: .semibold))
                            .foregroundStyle(InsightColor.warning)
                    }

                    Text("探讨《\(headline)》")
                        .font(.system(size: 17, weight: .bold, design: .serif))
                        .foregroundStyle(InsightColor.textPrimary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)

                    Text("选择切入点或在底部直接输入，向 AI 导师追问底层脉络")
                        .font(InsightFont.caption)
                        .foregroundStyle(InsightColor.textSecondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 24)

                VStack(alignment: .leading, spacing: 10) {
                    Text("启发式切入点 (Click to Ask)")
                        .font(InsightFont.captionSmall.weight(.bold))
                        .foregroundStyle(InsightColor.textTertiary)
                        .padding(.horizontal, 4)

                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                        ForEach(starters) { item in
                            Button(action: { onAsk(item.prompt) }) {
                                VStack(alignment: .leading, spacing: 8) {
                                    HStack(spacing: 8) {
                                        ZStack {
                                            Circle()
                                                .fill(InsightColor.warning.opacity(0.12))
                                                .frame(width: 26, height: 26)
                                            Image(systemName: item.icon)
                                                .font(.system(size: 11, weight: .semibold))
                                                .foregroundStyle(InsightColor.warning)
                                        }

                                        Text(LocalizedStringKey(item.title))
                                            .font(InsightFont.bodyStrong)
                                            .foregroundStyle(InsightColor.textPrimary)

                                        Spacer()

                                        Image(systemName: "arrow.up.circle.fill")
                                            .font(.system(size: 13))
                                            .foregroundStyle(InsightColor.warning.opacity(0.75))
                                    }

                                    Text(LocalizedStringKey(item.subtitle))
                                        .font(InsightFont.captionSmall)
                                        .foregroundStyle(InsightColor.textSecondary)
                                        .lineLimit(2)
                                        .multilineTextAlignment(.leading)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                .padding(12)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous))
                                .overlay(
                                    RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
                                        .strokeBorder(InsightColor.border, lineWidth: 1)
                                )
                                .shadow(color: Color.black.opacity(0.06), radius: 4, y: 1)
                            }
                            .buttonStyle(PressableButtonStyle(scale: 0.98))
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 20)
            }
        }
    }
}

// MARK: 单条消息气泡行

struct ChatMessageRow: View {
    let msg: CardChatMessage
    let isSaved: Bool
    let onSaveAsCard: () -> Void
    let onSpeak: () -> Void
    let onCopy: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if msg.sender == .assistant {
                ZStack {
                    Circle()
                        .fill(InsightColor.warning.opacity(0.16))
                        .frame(width: 28, height: 28)
                    Image(systemName: "cpu")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(InsightColor.warning)
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
                    Text(LocalizedStringKey(msg.sender == .user ? "你" : "KnowFlick 伴学导师"))
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(InsightColor.textTertiary)
                }

                VStack(alignment: .leading, spacing: 8) {
                    if msg.content.isEmpty && msg.isStreaming {
                        HStack(spacing: 4) {
                            Text("正在推演构思...")
                                .font(InsightFont.caption)
                                .foregroundStyle(InsightColor.textSecondary)
                            ProgressView()
                                .controlSize(.mini)
                        }
                        .padding(.vertical, 4)
                    } else {
                        Text(msg.content)
                            .font(InsightFont.body)
                            .foregroundStyle(InsightColor.textPrimary)
                            .lineSpacing(5)
                            .textSelection(.enabled)
                    }

                    if msg.isStreaming {
                        Text("▋")
                            .font(.system(size: 13, weight: .black))
                            .foregroundStyle(InsightColor.warning)
                            .opacity(0.85)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
                .background {
                    ZStack {
                        if msg.sender == .user {
                            InsightColor.warning.opacity(0.14)
                            LinearGradient(
                                stops: [
                                    .init(color: Color.white.opacity(0.08), location: 0),
                                    .init(color: Color.clear, location: 0.5)
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        } else {
                            InsightColor.surface
                            LinearGradient(
                                stops: [
                                    .init(color: Color.white.opacity(0.04), location: 0),
                                    .init(color: Color.clear, location: 0.4)
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        }
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(
                            msg.sender == .user
                                ? AnyShapeStyle(LinearGradient(
                                    stops: [
                                        .init(color: Color.white.opacity(0.3), location: 0),
                                        .init(color: InsightColor.warning.opacity(0.5), location: 0.5),
                                        .init(color: InsightColor.warning.opacity(0.2), location: 1)
                                    ],
                                    startPoint: .top,
                                    endPoint: .bottom
                                ))
                                : AnyShapeStyle(InsightColor.doubleBezelStroke),
                            lineWidth: 1.1
                        )
                )
                .shadow(
                    color: msg.sender == .user ? InsightColor.warning.opacity(0.12) : Color.black.opacity(0.16),
                    radius: 8,
                    y: 2
                )

                // 助手回答工具栏（沉淀为卡片 + 朗读 + 复制）
                if msg.sender == .assistant && !msg.content.isEmpty && !msg.isStreaming {
                    HStack(spacing: 10) {
                        Button(action: onSaveAsCard) {
                            HStack(spacing: 4) {
                                Image(systemName: isSaved ? "checkmark.circle.fill" : "plus.rectangle.on.rectangle")
                                    .font(.system(size: 10))
                                Text(isSaved ? "已沉淀为卡片" : "沉淀为卡片")
                                    .font(.system(size: 11, weight: .medium))
                            }
                            .foregroundStyle(isSaved ? InsightColor.success : InsightColor.warning)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 4)
                            .background(
                                isSaved ? InsightColor.success.opacity(0.12) : InsightColor.warning.opacity(0.12),
                                in: Capsule()
                            )
                            .overlay(
                                Capsule().strokeBorder(
                                    isSaved ? InsightColor.success.opacity(0.3) : InsightColor.warning.opacity(0.3),
                                    lineWidth: 1
                                )
                            )
                        }
                        .buttonStyle(PressableButtonStyle())
                        .disabled(isSaved)

                        Button(action: onSpeak) {
                            HStack(spacing: 4) {
                                Image(systemName: "speaker.wave.2.fill")
                                    .font(.system(size: 10))
                                Text("朗读")
                                    .font(.system(size: 11, weight: .medium))
                            }
                            .foregroundStyle(InsightColor.textSecondary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(InsightColor.surface, in: Capsule())
                            .overlay(Capsule().strokeBorder(InsightColor.border, lineWidth: 1))
                        }
                        .buttonStyle(PressableButtonStyle())

                        Button(action: onCopy) {
                            HStack(spacing: 4) {
                                Image(systemName: "doc.on.doc")
                                    .font(.system(size: 10))
                                Text("复制")
                                    .font(.system(size: 11, weight: .medium))
                            }
                            .foregroundStyle(InsightColor.textSecondary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(InsightColor.surface, in: Capsule())
                            .overlay(Capsule().strokeBorder(InsightColor.border, lineWidth: 1))
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
}

// MARK: 动态追问建议

struct ChatFollowUpSuggestions: View {
    let lastContent: String
    let parentCard: KnowledgeCard
    let onAsk: (String) -> Void

    var body: some View {
        let suggestions = CardChatInsightDeriver.suggestFollowUps(for: lastContent, parentCard: parentCard)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "cpu")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(InsightColor.warning)
                Text("深度追问建议 (Click to Ask)")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(InsightColor.textTertiary)
            }
            .padding(.leading, 4)

            VStack(spacing: 6) {
                ForEach(suggestions, id: \.self) { suggestion in
                    Button(action: { onAsk(suggestion) }) {
                        HStack(spacing: 8) {
                            Text(suggestion)
                                .font(InsightFont.caption)
                                .foregroundStyle(InsightColor.textPrimary)
                                .multilineTextAlignment(.leading)
                            Spacer()
                            Image(systemName: "arrow.up.circle.fill")
                                .font(.system(size: 12))
                                .foregroundStyle(InsightColor.warning.opacity(0.8))
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .strokeBorder(InsightColor.border, lineWidth: 1)
                        )
                    }
                    .buttonStyle(PressableButtonStyle())
                }
            }
        }
        .padding(.top, 4)
        .padding(.bottom, 8)
    }
}

// MARK: 横幅（成功提示 / 内联错误）

struct ChatToastBanner: View {
    let message: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(InsightColor.success)
                .font(.system(size: 12))
            Text(LocalizedStringKey(message))
                .font(InsightFont.caption)
                .foregroundStyle(InsightColor.textPrimary)
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(InsightColor.success.opacity(0.12))
    }
}

/// 聊天页内联错误横幅（非 Toast，常驻显示直至下一条消息）
struct ChatErrorBanner: View {
    let message: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(InsightColor.danger)
                .font(.system(size: 12))
            Text(LocalizedStringKey(message))
                .font(InsightFont.caption)
                .foregroundStyle(InsightColor.textPrimary)
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Color.red.opacity(0.12))
    }
}
