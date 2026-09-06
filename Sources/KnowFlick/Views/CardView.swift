import SwiftUI
import AppKit
import KnowFlickCore

/// 单张知识卡片（正面）：分类摄影背景图 + 衬线大标题
struct CardView: View {
    let card: KnowledgeCard
    let showAIMark: Bool   // 设置：显示 AI 内容标记
    @State private var hovering = false

    private var theme: CategoryTheme {
        CategoryTheme.theme(for: card.category, cache: .shared)
    }

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
                .font(EditorialFont.heroHeadline)
                .foregroundStyle(EditorialColor.textPrimary)
                .lineSpacing(7.5)
                .lineLimit(5)
                .minimumScaleFactor(0.65)
                .shadow(color: .black.opacity(0.65), radius: 10, y: 3)
                .fixedSize(horizontal: false, vertical: true)

            Rectangle()
                .fill(theme.accent)
                .frame(width: 36, height: 3.5)
                .cornerRadius(1.75)
                .padding(.top, 16)
                .padding(.bottom, 14)

            Text(card.summary)
                .font(EditorialFont.summarySerif)
                .foregroundStyle(EditorialColor.textSecondary)
                .lineSpacing(5.5)
                .lineLimit(4)
                .shadow(color: .black.opacity(0.55), radius: 6, y: 1.5)

            HStack {
                Label("详情", systemImage: "arrow.up.left.and.arrow.down.right")
                    .font(EditorialFont.caption.weight(.semibold))
                    .foregroundStyle(EditorialColor.textTertiary)
                Spacer()
                Text("拖动换一张")
                    .font(EditorialFont.caption)
                    .foregroundStyle(EditorialColor.textMuted)
            }
            .padding(.top, 24)
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
        .background(backgroundLayer)
        .clipShape(RoundedRectangle(cornerRadius: EditorialRadius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: EditorialRadius.card, style: .continuous)
                .strokeBorder(hovering ? EditorialColor.glassBorderHover : EditorialColor.glassBorder, lineWidth: 1.2)
        )
        .shadow(color: (theme.ambient.last ?? .black).opacity(0.88), radius: 36, y: 18)
        .shadow(color: .black.opacity(0.4), radius: 8, y: 4)
        .onHover { hovering = $0 }
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

            // 多阶非线性动态遮罩
            DynamicScrimOverlay()
        }
    }

    private var categoryBadge: some View {
        Text(card.category)
            .font(EditorialFont.badge)
            .tracking(1.5)
            .foregroundStyle(Color.black.opacity(0.85))
            .padding(.horizontal, 13)
            .padding(.vertical, 6)
            .background(theme.accent, in: Capsule())
            .shadow(color: theme.accent.opacity(0.35), radius: 8, y: 2)
    }

    /// 来源标记：AI 卡显示醒目的橙色徽章（可按设置隐藏）；精选卡保持低调
    @ViewBuilder
    private var sourceMark: some View {
        if card.source == .ai {
            if showAIMark {
                Label("AI 生成", systemImage: "sparkles")
                    .font(EditorialFont.caption.weight(.bold))
                    .foregroundStyle(EditorialColor.aiAmber)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(EditorialColor.aiAmberBg, in: Capsule())
                    .overlay(Capsule().strokeBorder(EditorialColor.aiAmberBorder, lineWidth: 1))
            }
        } else {
            HStack(spacing: 5) {
                Circle()
                    .fill(Color.white.opacity(0.6))
                    .frame(width: 5, height: 5)
                Text("精选")
                    .font(EditorialFont.caption)
                    .foregroundStyle(EditorialColor.textSecondary)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Color.black.opacity(0.35), in: Capsule())
            .overlay(Capsule().strokeBorder(EditorialColor.glassBorder, lineWidth: 0.8))
        }
    }
}
