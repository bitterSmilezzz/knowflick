import SwiftUI
import AppKit

/// 详情页：顶部摄影横幅 + 展开解释 + 科普链接
struct DetailView: View {
    let card: KnowledgeCard
    let store: AppStore
    let onClose: () -> Void

    @Environment(\.openURL) private var openURL
    @State private var theme: CategoryTheme = .empty

    var body: some View {
        ZStack {
            // ambient 背景
            LinearGradient(colors: theme.ambient, startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
            NoiseOverlay().ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    // 顶部横幅：摄影图 + 渐隐
                    ZStack(alignment: .bottomLeading) {
                        // 固定高度容器，图片不参与布局
                        Rectangle()
                            .fill(theme.ambient.last ?? .black)
                            .frame(height: 210)

                        if let img = theme.image {
                            GeometryReader { geo in
                                Image(nsImage: img)
                                    .resizable()
                                    .aspectRatio(contentMode: .fill)
                                    .frame(width: geo.size.width, height: geo.size.height)
                                    .clipped()
                                    .overlay(
                                        LinearGradient(
                                            colors: [.clear, theme.ambient.last ?? .black],
                                            startPoint: .center, endPoint: .bottom
                                        )
                                    )
                            }
                            .frame(height: 210)
                        }

                        // 关闭按钮浮层
                        VStack {
                            HStack {
                                Spacer()
                                closeButton
                            }
                            Spacer()
                        }
                        .padding(18)
                    }
                    .frame(height: 210)

                    VStack(alignment: .leading, spacing: 0) {
                        // 头部
                        HStack(spacing: 10) {
                            Text(card.category)
                                .font(.system(size: 12.5, weight: .bold))
                                .tracking(1.5)
                                .foregroundStyle(Color.black.opacity(0.82))
                                .padding(.horizontal, 12)
                                .padding(.vertical, 5)
                                .background(theme.accent, in: Capsule())
                            Text(card.source == .ai ? "AI 生成" : "预置精选")
                                .font(.system(size: 11.5, weight: .medium))
                                .foregroundStyle(.white.opacity(0.45))
                        }

                        Text(card.headline)
                            .font(.custom("Songti SC Black", size: 28))
                            .foregroundStyle(Color(red: 0.97, green: 0.96, blue: 0.93))
                            .lineSpacing(6)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 14)

                        Rectangle()
                            .fill(theme.accent)
                            .frame(width: 34, height: 3)
                            .cornerRadius(1.5)
                            .padding(.top, 14)

                        // 正文
                        VStack(alignment: .leading, spacing: 16) {
                            ForEach(paragraphs, id: \.self) { para in
                                Text(para)
                                    .font(.system(size: 15.5, design: .serif))
                                    .lineSpacing(7)
                                    .foregroundStyle(.white.opacity(0.86))
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .padding(.top, 22)

                        // 科普链接
                        if !card.links.isEmpty {
                            VStack(alignment: .leading, spacing: 10) {
                                Text("延伸阅读")
                                    .font(.system(size: 12.5, weight: .bold))
                                    .tracking(2)
                                    .foregroundStyle(.white.opacity(0.5))

                                ForEach(card.links, id: \.self) { link in
                                    linkRow(link)
                                }
                            }
                            .padding(.top, 26)
                        }

                        // 操作
                        HStack(spacing: 12) {
                            actionButton(title: "不喜欢", icon: "xmark", tint: Color(red: 0.92, green: 0.48, blue: 0.45)) {
                                onClose()
                                store.swipe(card, direction: .left)
                            }
                            actionButton(title: "感兴趣", icon: "heart.fill", tint: Color(red: 0.45, green: 0.80, blue: 0.55)) {
                                onClose()
                                store.swipe(card, direction: .right)
                            }
                        }
                        .padding(.top, 28)
                        .padding(.bottom, 36)
                    }
                    .padding(.horizontal, 38)
                }
                .frame(maxWidth: 700, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
        }
        .preferredColorScheme(.dark)
        .task {
            theme = CategoryTheme.theme(for: card.category, cache: .shared)
        }
    }

    private var closeButton: some View {
        Button(action: onClose) {
            Image(systemName: "xmark")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.white.opacity(0.85))
                .frame(width: 30, height: 30)
                .background(.black.opacity(0.4), in: Circle())
                .overlay(Circle().strokeBorder(.white.opacity(0.15), lineWidth: 1))
        }
        .buttonStyle(PressableButtonStyle())
        .keyboardShortcut(.escape, modifiers: [])
    }

    private func linkRow(_ link: ScienceLink) -> some View {
        Button {
            if let url = URL(string: link.url) {
                openURL(url)
            }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(theme.accent)
                Text(link.title)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white.opacity(0.88))
                    .lineLimit(1)
                Spacer()
                Text(displayHost(link.url))
                    .font(.system(size: 11.5))
                    .foregroundStyle(.white.opacity(0.38))
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 11)
            .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
            )
        }
        .buttonStyle(PressableButtonStyle(scale: 0.985))
    }

    private func actionButton(title: String, icon: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tint)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .strokeBorder(tint.opacity(0.5), lineWidth: 1.3)
                )
        }
        .buttonStyle(PressableButtonStyle(scale: 0.97))
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
