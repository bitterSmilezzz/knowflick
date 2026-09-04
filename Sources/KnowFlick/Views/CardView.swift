import SwiftUI
import AppKit

/// 单张知识卡片（正面）：分类摄影背景图 + 衬线大标题
struct CardView: View {
    let card: KnowledgeCard
    @State private var theme: CategoryTheme = .empty
    @State private var hovering = false

    var body: some View {
        // 前景内容层（决定布局），背景图放 .background 不参与布局
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                categoryBadge
                sourceMark
                Spacer()
            }

            Spacer(minLength: 20)

            // 衬线大标题
            Text(card.headline)
                .font(.custom("Songti SC Black", size: 33))
                .foregroundStyle(Color(red: 0.97, green: 0.96, blue: 0.93))
                .lineSpacing(7)
                .lineLimit(4)
                .minimumScaleFactor(0.72)
                .shadow(color: .black.opacity(0.55), radius: 8, y: 2)
                .fixedSize(horizontal: false, vertical: true)

            Rectangle()
                .fill(theme.accent)
                .frame(width: 34, height: 3)
                .cornerRadius(1.5)
                .padding(.top, 14)
                .padding(.bottom, 12)

            Text(card.summary)
                .font(.system(size: 15.5, weight: .medium, design: .serif))
                .foregroundStyle(Color.white.opacity(0.85))
                .lineSpacing(4.5)
                .lineLimit(3)
                .shadow(color: .black.opacity(0.5), radius: 5, y: 1)

            HStack {
                Label("详情", systemImage: "arrow.up.left.and.arrow.down.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.55))
                Spacer()
                Text("拖动换一张")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.42))
            }
            .padding(.top, 22)
        }
        .padding(26)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
        .background(backgroundLayer)
        .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .strokeBorder(Color.white.opacity(hovering ? 0.22 : 0.13), lineWidth: 1)
        )
        .shadow(color: theme.ambient.last?.opacity(0.85) ?? .black.opacity(0.5), radius: 34, y: 16)
        .onHover { hovering = $0 }
        .task(id: card.category) {
            withAnimation(.easeIn(duration: 0.3)) {
                theme = CategoryTheme.theme(for: card.category, cache: .shared)
            }
        }
    }

    // MARK: - 背景层（不参与前景布局）

    @ViewBuilder
    private var backgroundLayer: some View {
        ZStack {
            if let img = theme.image {
                GeometryReader { geo in
                    Image(nsImage: img)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(width: geo.size.width, height: geo.size.height)
                        .clipped()
                }
            } else {
                LinearGradient(colors: theme.ambient, startPoint: .top, endPoint: .bottom)
            }

            // 顶部压暗，保证徽章可读
            LinearGradient(
                colors: [Color.black.opacity(0.50), .clear],
                startPoint: .top, endPoint: UnitPoint(x: 0.5, y: 0.40)
            )

            // 底部加重，标题区始终可读
            LinearGradient(
                colors: [.clear, Color.black.opacity(0.46)],
                startPoint: UnitPoint(x: 0.5, y: 0.45), endPoint: .bottom
            )
        }
    }

    private var categoryBadge: some View {
        Text(card.category)
            .font(.system(size: 12.5, weight: .bold))
            .tracking(1.5)
            .foregroundStyle(Color.black.opacity(0.82))
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(theme.accent, in: Capsule())
    }

    private var sourceMark: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(card.source == .ai ? Color.orange : Color.white.opacity(0.55))
                .frame(width: 5, height: 5)
            Text(card.source == .ai ? "AI 生成" : "精选")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.white.opacity(0.62))
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Color.black.opacity(0.28), in: Capsule())
    }
}
