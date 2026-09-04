import SwiftUI

/// 单张知识卡片（正面）
struct CardView: View {
    let card: KnowledgeCard

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // 顶部：分类徽章 + 来源
            HStack {
                Text(card.category)
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(.white.opacity(0.18), in: Capsule())

                Spacer()

                HStack(spacing: 4) {
                    Circle()
                        .fill(card.source == .ai ? Color.orange : Color.green)
                        .frame(width: 6, height: 6)
                    Text(card.source == .ai ? "AI 生成" : "预置精选")
                        .font(.caption2)
                        .opacity(0.8)
                }
            }

            Spacer(minLength: 24)

            // 主标题
            Text(card.headline)
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(4)
                .minimumScaleFactor(0.7)

            Spacer(minLength: 12)

            // 摘要
            Text(card.summary)
                .font(.system(size: 17, design: .rounded))
                .foregroundStyle(.white.opacity(0.85))
                .lineLimit(3)

            Spacer(minLength: 20)

            // 底部提示
            HStack {
                Label("点击查看详情", systemImage: "hand.tap")
                Spacer()
                Label("左右拖动换一张", systemImage: "arrow.left.and.right")
            }
            .font(.caption)
            .foregroundStyle(.white.opacity(0.6))
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            LinearGradient(
                colors: categoryColors,
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .strokeBorder(.white.opacity(0.15), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.25), radius: 24, y: 12)
    }

    /// 分类 → 渐变色
    private var categoryColors: [Color] {
        switch card.category {
        case "物理": [Color.blue, Color.indigo]
        case "生物": [Color.green, Color.teal]
        case "天文": [Color.purple, Color.indigo]
        case "数学": [Color.orange, Color.red]
        case "化学": [Color.mint, Color.cyan]
        case "历史": [Color.brown, Color.orange]
        case "心理": [Color.pink, Color.purple]
        case "脑科学": [Color.pink, Color.red]
        case "语言": [Color.cyan, Color.blue]
        case "科技": [Color.cyan, Color.mint]
        case "生活": [Color.yellow, Color.orange]
        case "地理": [Color.green, Color.mint]
        default: [Color.gray, Color.blue]
        }
    }
}
