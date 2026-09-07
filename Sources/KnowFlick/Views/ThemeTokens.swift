import SwiftUI
import AppKit

// MARK: - 全局设计系统规范：暗色人文画报风 (Dark Editorial Design System)

public enum EditorialColor {
    // 画布底色
    public static let canvasDark = Color(red: 0.05, green: 0.055, blue: 0.07)
    public static let canvasGradient = LinearGradient(
        colors: [Color(red: 0.075, green: 0.08, blue: 0.10), Color(red: 0.035, green: 0.038, blue: 0.05)],
        startPoint: .top,
        endPoint: .bottom
    )

    // 半透明磨砂玻璃表面
    public static let glassSurface = Color.white.opacity(0.065)
    public static let glassSurfaceHover = Color.white.opacity(0.10)
    public static let glassSurfaceActive = Color.white.opacity(0.14)
    public static let glassBorder = Color.white.opacity(0.12)
    public static let glassBorderHover = Color.white.opacity(0.24)
    public static let glassDivider = Color.white.opacity(0.08)

    // 文字层级
    public static let textPrimary = Color(red: 0.97, green: 0.96, blue: 0.94)
    public static let textSecondary = Color.white.opacity(0.82)
    public static let textTertiary = Color.white.opacity(0.56)
    public static let textMuted = Color.white.opacity(0.38)

    // 功能强调色
    public static let likeGreen = Color(red: 0.45, green: 0.82, blue: 0.58)
    public static let dislikeRed = Color(red: 0.94, green: 0.46, blue: 0.44)
    public static let skipGray = Color(white: 0.68)
    public static let aiAmber = Color(red: 0.98, green: 0.72, blue: 0.38)
    public static let aiAmberBg = Color.orange.opacity(0.16)
    public static let aiAmberBorder = Color.orange.opacity(0.42)
}

public enum EditorialFont {
    // 宋体粗体主标题
    public static let heroHeadline = Font.custom("Songti SC Black", size: 33)
    public static let detailHeadline = Font.custom("Songti SC Black", size: 28)
    public static let modalTitle = Font.custom("Songti SC Black", size: 21)
    public static let sectionTitle = Font.custom("Songti SC Black", size: 17)
    public static let statFigure = Font.custom("Songti SC Black", size: 32)
    public static let statFigureSmall = Font.custom("Songti SC Black", size: 24)

    // 衬线体正文
    public static let bodySerif = Font.system(size: 15.5, weight: .regular, design: .serif)
    public static let summarySerif = Font.system(size: 15.5, weight: .medium, design: .serif)

    // 界面控制标签
    public static let label = Font.system(size: 13, weight: .semibold)
    public static let labelSmall = Font.system(size: 12, weight: .medium)
    public static let badge = Font.system(size: 12, weight: .bold)
    public static let caption = Font.system(size: 11, weight: .medium)
    public static let captionSmall = Font.system(size: 10, weight: .regular)
}

public enum EditorialRadius {
    public static let card: CGFloat = 30
    public static let modal: CGFloat = 24
    public static let container: CGFloat = 18
    public static let pill: CGFloat = 12
    public static let control: CGFloat = 9
}

// MARK: - 动态多阶非线性遮罩 (Dynamic Scrim)

public struct DynamicScrimOverlay: View {
    public init() {}

    public var body: some View {
        ZStack {
            // 顶部暗角：保证顶部徽章、来源标签和关闭按钮对比度
            LinearGradient(
                stops: [
                    .init(color: Color.black.opacity(0.55), location: 0.0),
                    .init(color: Color.black.opacity(0.20), location: 0.22),
                    .init(color: .clear, location: 0.42)
                ],
                startPoint: .top,
                endPoint: .bottom
            )

            // 底部平滑加重非线性渐变：保证标题与摘要正文无论底图明暗均清晰沉稳
            LinearGradient(
                stops: [
                    .init(color: .clear, location: 0.35),
                    .init(color: Color.black.opacity(0.18), location: 0.52),
                    .init(color: Color.black.opacity(0.55), location: 0.76),
                    .init(color: Color.black.opacity(0.82), location: 1.0)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .allowsHitTesting(false)
    }
}

// MARK: - 杂志微质感卡片修饰符

public struct EditorialGlassCardModifier: ViewModifier {
    public var cornerRadius: CGFloat
    public var strokeColor: Color
    public var backgroundColor: Color

    public init(
        cornerRadius: CGFloat = EditorialRadius.container,
        strokeColor: Color = EditorialColor.glassBorder,
        backgroundColor: Color = EditorialColor.glassSurface
    ) {
        self.cornerRadius = cornerRadius
        self.strokeColor = strokeColor
        self.backgroundColor = backgroundColor
    }

    public func body(content: Content) -> some View {
        content
            .background(backgroundColor, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(strokeColor, lineWidth: 1)
            )
    }
}

public extension View {
    func editorialGlassCard(
        cornerRadius: CGFloat = EditorialRadius.container,
        strokeColor: Color = EditorialColor.glassBorder,
        backgroundColor: Color = EditorialColor.glassSurface
    ) -> some View {
        modifier(EditorialGlassCardModifier(cornerRadius: cornerRadius, strokeColor: strokeColor, backgroundColor: backgroundColor))
    }
}

// MARK: - 噪点纹理（空实现，避免全屏动态噪点导致主线程 CPU 飙高与远程桌面编码卡顿）
public struct NoiseOverlay: View {
    public init() {}
    public var body: some View {
        EmptyView()
    }
}
