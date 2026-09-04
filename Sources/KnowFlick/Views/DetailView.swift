import SwiftUI
import AppKit

/// 详情页：展开解释 + 科普链接
struct DetailView: View {
    let card: KnowledgeCard
    let store: AppStore
    let onClose: () -> Void

    @Environment(\.openURL) private var openURL

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [.black.opacity(0.9), .black.opacity(0.75)],
                startPoint: .top, endPoint: .bottom
            )
            .ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    // 关闭按钮
                    HStack {
                        Spacer()
                        Button(action: onClose) {
                            Image(systemName: "xmark")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(.white.opacity(0.7))
                                .frame(width: 32, height: 32)
                                .background(.white.opacity(0.1), in: Circle())
                        }
                        .buttonStyle(.plain)
                        .keyboardShortcut(.escape, modifiers: [])
                    }

                    // 头部
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 8) {
                            Text(card.category)
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 4)
                                .background(.white.opacity(0.15), in: Capsule())
                            Text(card.source == .ai ? "AI 生成" : "预置精选")
                                .font(.caption2)
                                .foregroundStyle(.white.opacity(0.5))
                        }
                        Text(card.headline)
                            .font(.system(size: 32, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Divider().opacity(0.3)

                    // 正文
                    VStack(alignment: .leading, spacing: 14) {
                        ForEach(paragraphs, id: \.self) { para in
                            Text(para)
                                .font(.system(size: 16, design: .rounded))
                                .lineSpacing(6)
                                .foregroundStyle(.white.opacity(0.88))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }

                    // 科普链接
                    if !card.links.isEmpty {
                        Divider().opacity(0.3)

                        VStack(alignment: .leading, spacing: 12) {
                            Label("延伸阅读", systemImage: "book")
                                .font(.headline)
                                .foregroundStyle(.white)

                            ForEach(card.links, id: \.self) { link in
                                Button {
                                    if let url = URL(string: link.url) {
                                        openURL(url)
                                    }
                                } label: {
                                    HStack(spacing: 10) {
                                        Image(systemName: "arrow.up.right.square")
                                            .foregroundStyle(.cyan)
                                        Text(link.title)
                                            .foregroundStyle(.white.opacity(0.9))
                                            .lineLimit(1)
                                        Spacer()
                                        Text(displayHost(link.url))
                                            .font(.caption2)
                                            .foregroundStyle(.white.opacity(0.4))
                                    }
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 10)
                                    .background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    // 操作
                    HStack(spacing: 14) {
                        Button {
                            onClose()
                            store.swipe(card, direction: .left)
                        } label: {
                            Label("不喜欢", systemImage: "xmark")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.red.opacity(0.8))

                        Button {
                            onClose()
                            store.swipe(card, direction: .right)
                        } label: {
                            Label("感兴趣", systemImage: "heart.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.green.opacity(0.8))
                    }
                    .padding(.top, 8)
                }
                .padding(40)
                .frame(maxWidth: 720, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
        }
        .preferredColorScheme(.dark)
    }

    private var paragraphs: [String] {
        card.details
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map(String.init)
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    private func displayHost(_ url: String) -> String {
        URL(string: url)?.host?.replacingOccurrences(of: "www.", with: "") ?? url
    }
}
