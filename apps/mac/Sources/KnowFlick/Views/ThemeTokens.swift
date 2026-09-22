import SwiftUI
import AppKit
import KnowFlickCore

// MARK: - 外观枚举适配 SwiftUI ColorScheme

public extension AppearanceMode {
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .dark: return .dark
        case .light: return .light
        }
    }
}

// MARK: - 全局设计系统规范：人文画报风 (Editorial Design System - Dark & Light)

public enum EditorialColor {
    /// 辅助方法：创建 macOS 原生动态色彩（根据系统当前或 preferredColorScheme 自动切换）
    public static func dynamic(light: NSColor, dark: NSColor) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let match = appearance.bestMatch(from: [.darkAqua, .aqua])
            return match == .darkAqua ? dark : light
        })
    }


// 画布底色
    public static let canvasDark = dynamic(
        light: NSColor(red: 0.959, green: 0.951, blue: 0.933, alpha: 1.0),
        dark: NSColor(red: 0.075, green: 0.079, blue: 0.075, alpha: 1.0)
    )

    public static let canvasGradientTop = dynamic(
        light: NSColor(red: 0.984, green: 0.979, blue: 0.966, alpha: 1.0),
        dark: NSColor(red: 0.098, green: 0.102, blue: 0.094, alpha: 1.0)
    )
    public static let canvasGradientBottom = dynamic(
        light: NSColor(red: 0.942, green: 0.933, blue: 0.911, alpha: 1.0),
        dark: NSColor(red: 0.060, green: 0.064, blue: 0.060, alpha: 1.0)
    )
    public static let canvasGradient = LinearGradient(
        colors: [canvasGradientTop, canvasGradientBottom],
        startPoint: .top,
        endPoint: .bottom
    )

    // 半透明磨砂玻璃表面与边框
    public static let glassSurface = dynamic(
        light: NSColor(white: 1.0, alpha: 0.78),
        dark: NSColor.white.withAlphaComponent(0.065)
    )
    public static let glassSurfaceHover = dynamic(
        light: NSColor(white: 1.0, alpha: 0.94),
        dark: NSColor.white.withAlphaComponent(0.10)
    )
    public static let glassSurfaceActive = dynamic(
        light: NSColor(white: 0.94, alpha: 1.0),
        dark: NSColor.white.withAlphaComponent(0.14)
    )
    public static let glassBorder = dynamic(
        light: NSColor(white: 0.0, alpha: 0.09),
        dark: NSColor.white.withAlphaComponent(0.12)
    )
    public static let glassBorderHover = dynamic(
        light: NSColor(white: 0.0, alpha: 0.18),
        dark: NSColor.white.withAlphaComponent(0.24)
    )
    public static let glassDivider = dynamic(
        light: NSColor(white: 0.0, alpha: 0.07),
        dark: NSColor.white.withAlphaComponent(0.08)
    )

    // 窗口与通用界面文字层级
    public static let textPrimary = dynamic(
        light: NSColor(red: 0.11, green: 0.12, blue: 0.14, alpha: 1.0),
        dark: NSColor(red: 0.97, green: 0.96, blue: 0.94, alpha: 1.0)
    )
    public static let textSecondary = dynamic(
        light: NSColor(red: 0.18, green: 0.20, blue: 0.24, alpha: 0.85),
        dark: NSColor.white.withAlphaComponent(0.82)
    )
    public static let textTertiary = dynamic(
        light: NSColor(red: 0.25, green: 0.28, blue: 0.32, alpha: 0.65),
        dark: NSColor.white.withAlphaComponent(0.56)
    )
    public static let textMuted = dynamic(
        light: NSColor(red: 0.35, green: 0.38, blue: 0.42, alpha: 0.48),
        dark: NSColor.white.withAlphaComponent(0.38)
    )

    // 摄影卡片内部文字（始终置于暗色摄影底图与动态非线性遮罩之上，双模式下保持明亮通透）
    public static let cardTextPrimary = Color(red: 0.97, green: 0.96, blue: 0.94)
    public static let cardTextSecondary = Color.white.opacity(0.85)
    public static let cardTextTertiary = Color.white.opacity(0.58)
    public static let cardTextMuted = Color.white.opacity(0.40)

    // 功能强调色
    public static let likeGreen = dynamic(
        light: NSColor(red: 0.18, green: 0.68, blue: 0.38, alpha: 1.0),
        dark: NSColor(red: 0.45, green: 0.82, blue: 0.58, alpha: 1.0)
    )
    public static let dislikeRed = dynamic(
        light: NSColor(red: 0.88, green: 0.30, blue: 0.28, alpha: 1.0),
        dark: NSColor(red: 0.94, green: 0.46, blue: 0.44, alpha: 1.0)
    )
    public static let skipGray = dynamic(
        light: NSColor(white: 0.42, alpha: 1.0),
        dark: NSColor(white: 0.68, alpha: 1.0)
    )
    public static let aiAmber = dynamic(
        light: NSColor(red: 0.88, green: 0.55, blue: 0.15, alpha: 1.0),
        dark: NSColor(red: 0.98, green: 0.72, blue: 0.38, alpha: 1.0)
    )
    public static let aiAmberBg = dynamic(
        light: NSColor.orange.withAlphaComponent(0.12),
        dark: NSColor.orange.withAlphaComponent(0.16)
    )
    public static let aiAmberBorder = dynamic(
        light: NSColor.orange.withAlphaComponent(0.35),
        dark: NSColor.orange.withAlphaComponent(0.42)
    )

    /// 详情蓝：数据看板与统计条目的强调色（与 Android 端 EditorialColor.detailBlue 同值）
    public static let detailBlue = dynamic(
        light: NSColor(red: 0.290, green: 0.486, blue: 0.616, alpha: 1.0),
        dark: NSColor(red: 0.420, green: 0.612, blue: 0.741, alpha: 1.0)
    )
}

// MARK: - 纸质主题调色盘 (Paper Theme Palette)

public struct PaperThemeColors: Sendable {
    public let canvasLight: NSColor
    public let canvasDark: NSColor
    public let surfaceLight: NSColor
    public let surfaceDark: NSColor
    public let borderLight: NSColor
    public let borderDark: NSColor
    public let textPrimaryLight: NSColor
    public let textPrimaryDark: NSColor

    public var canvas: Color { EditorialColor.dynamic(light: canvasLight, dark: canvasDark) }
    public var surface: Color { EditorialColor.dynamic(light: surfaceLight, dark: surfaceDark) }
    public var border: Color { EditorialColor.dynamic(light: borderLight, dark: borderDark) }
    public var textPrimary: Color { EditorialColor.dynamic(light: textPrimaryLight, dark: textPrimaryDark) }
}

public enum PaperThemePalette {
    public static func colors(for theme: PaperTheme) -> PaperThemeColors {
        switch theme {
        case .xuanzhiWhite:
            return PaperThemeColors(
                canvasLight: NSColor(red: 0.984, green: 0.976, blue: 0.961, alpha: 1.0),
                canvasDark: NSColor(red: 0.078, green: 0.078, blue: 0.086, alpha: 1.0),
                surfaceLight: NSColor(white: 1.0, alpha: 0.95),
                surfaceDark: NSColor(red: 0.110, green: 0.110, blue: 0.122, alpha: 1.0),
                borderLight: NSColor(red: 0.910, green: 0.894, blue: 0.863, alpha: 1.0),
                borderDark: NSColor(red: 0.173, green: 0.173, blue: 0.188, alpha: 1.0),
                textPrimaryLight: NSColor(red: 0.169, green: 0.157, blue: 0.141, alpha: 1.0),
                textPrimaryDark: NSColor(red: 0.929, green: 0.914, blue: 0.882, alpha: 1.0)
            )
        case .parchment:
            return PaperThemeColors(
                canvasLight: NSColor(red: 0.961, green: 0.937, blue: 0.878, alpha: 1.0),
                canvasDark: NSColor(red: 0.094, green: 0.082, blue: 0.071, alpha: 1.0),
                surfaceLight: NSColor(red: 0.980, green: 0.965, blue: 0.925, alpha: 0.95),
                surfaceDark: NSColor(red: 0.133, green: 0.118, blue: 0.098, alpha: 1.0),
                borderLight: NSColor(red: 0.886, green: 0.843, blue: 0.765, alpha: 1.0),
                borderDark: NSColor(red: 0.208, green: 0.180, blue: 0.145, alpha: 1.0),
                textPrimaryLight: NSColor(red: 0.173, green: 0.141, blue: 0.106, alpha: 1.0),
                textPrimaryDark: NSColor(red: 0.918, green: 0.882, blue: 0.824, alpha: 1.0)
            )
        case .morningMist:
            return PaperThemeColors(
                canvasLight: NSColor(red: 0.941, green: 0.949, blue: 0.957, alpha: 1.0),
                canvasDark: NSColor(red: 0.071, green: 0.078, blue: 0.090, alpha: 1.0),
                surfaceLight: NSColor(red: 0.973, green: 0.976, blue: 0.980, alpha: 0.95),
                surfaceDark: NSColor(red: 0.102, green: 0.114, blue: 0.133, alpha: 1.0),
                borderLight: NSColor(red: 0.867, green: 0.882, blue: 0.902, alpha: 1.0),
                borderDark: NSColor(red: 0.157, green: 0.176, blue: 0.208, alpha: 1.0),
                textPrimaryLight: NSColor(red: 0.118, green: 0.137, blue: 0.157, alpha: 1.0),
                textPrimaryDark: NSColor(red: 0.894, green: 0.910, blue: 0.929, alpha: 1.0)
            )
        case .warmObsidian:
            return PaperThemeColors(
                canvasLight: NSColor(red: 0.137, green: 0.133, blue: 0.125, alpha: 1.0),
                canvasDark: NSColor(red: 0.051, green: 0.051, blue: 0.059, alpha: 1.0),
                surfaceLight: NSColor(red: 0.176, green: 0.169, blue: 0.157, alpha: 0.95),
                surfaceDark: NSColor(red: 0.082, green: 0.082, blue: 0.094, alpha: 1.0),
                borderLight: NSColor(red: 0.243, green: 0.231, blue: 0.216, alpha: 1.0),
                borderDark: NSColor(red: 0.141, green: 0.141, blue: 0.161, alpha: 1.0),
                textPrimaryLight: NSColor(red: 0.941, green: 0.925, blue: 0.902, alpha: 1.0),
                textPrimaryDark: NSColor(red: 0.918, green: 0.910, blue: 0.894, alpha: 1.0)
            )
        }
    }

    public static func canvasGradient(for theme: PaperTheme) -> LinearGradient {
        let palette = colors(for: theme)
        return LinearGradient(
            colors: [palette.canvas, palette.canvas.opacity(0.92)],
            startPoint: .top,
            endPoint: .bottom
        )
    }
}

public enum EditorialFont {
    // 宋体粗体主标题
    public static let heroHeadline = Font.custom("Songti SC Black", size: 29)
    public static let detailHeadline = Font.custom("Songti SC Black", size: 26)
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

// MARK: - 按压反馈按钮样式（hover 亮起 + 按压缩小）
// 原位于 CardDeckView.swift 底部，17 个文件使用；归属设计系统文件

struct PressableButtonStyle: ButtonStyle {
    var scale: CGFloat = 0.94

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1.0)
            .opacity(configuration.isPressed ? 0.85 : 1.0)
            .animation(.spring(response: 0.25, dampingFraction: 0.6), value: configuration.isPressed)
            .onHover { hovering in
                if hovering {
                    NSCursor.pointingHand.push()
                } else {
                    NSCursor.pop()
                }
            }
    }
}

// MARK: - 玻璃圆形图标按钮（弹窗返回/关闭统一组件）

/// 32×32 玻璃圆底图标按钮：弹窗顶栏「返回 / 关闭」的标准形态。
/// 图标字号/前景色可调（12pt xmark 关闭、13pt chevron 返回）。
struct GlassIconButton: View {
    let icon: String
    var size: CGFloat = 32
    var iconSize: CGFloat = 13
    var tint: Color = EditorialColor.textPrimary
    var help: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: iconSize, weight: .bold))
                .foregroundStyle(tint)
                .frame(width: size, height: size)
                .background(EditorialColor.glassSurface, in: Circle())
                .overlay(Circle().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
        }
        .buttonStyle(PressableButtonStyle())
        .help(help)
    }
}
