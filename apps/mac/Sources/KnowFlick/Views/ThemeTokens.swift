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

    /// 面板（弹窗 / 次级窗口 / 双栏侧边）画布色：与主界面同色温，避免「进设置像换了 App」。
    /// 此前六个面板各自复制一份 `dynamic(windowBackgroundColor / white)`，light 模式是系统灰白、
    /// 与主界面暖白 #F5F1EE 色温断裂，且深浅两套值各自漂移。这里收敛为单一事实来源。
    public static let panelBackground = dynamic(
        light: NSColor(red: 0.957, green: 0.949, blue: 0.941, alpha: 1.0),
        dark: NSColor(red: 0.086, green: 0.090, blue: 0.090, alpha: 1.0)
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

    /// 输入框描边：比 `glassBorder` 更明确（浅色模式下 `glassBorder` 仅 0.09 黑，
    /// 叠在 0.78 白玻璃上几乎不可见，导致用户找不到输入框在哪）。
    public static let fieldBorder = dynamic(
        light: NSColor(white: 0.0, alpha: 0.20),
        dark: NSColor.white.withAlphaComponent(0.22)
    )
    public static let fieldBorderFocused = dynamic(
        light: NSColor(white: 0.0, alpha: 0.38),
        dark: NSColor.white.withAlphaComponent(0.46)
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

// MARK: - 阴影（层级即语义）

/// 阴影的语义刻度。此前 33 处 `.shadow(` 有 7 套规格（radius 4→40），
/// 且 9 个文件的玻璃卡干脆没有阴影——扁平贴纸感。
/// 按使用场景取档：控件入 control 档、玻璃卡入 elevation 档、弹窗入 panel 档。
public enum EditorialShadow {
    /// 控件级：按钮、徽章、Toast。贴地、被环境光遮蔽，只有一道细影。
    public static let controlColor: Color = EditorialColor.dynamic(
        light: NSColor.black.withAlphaComponent(0.06),
        dark: NSColor.black.withAlphaComponent(0.32)
    )
    public static let control = (radius: CGFloat(5), y: CGFloat(1.5))
    /// 控件悬停态：仅加深，不改尺寸。
    public static let controlHover = (radius: CGFloat(7), y: CGFloat(2))

    /// 内容级：玻璃卡、列表容器、图表卡片。两道影叠出「抬起」感。
    public static let elevationNearColor: Color = EditorialColor.dynamic(
        light: NSColor.black.withAlphaComponent(0.07),
        dark: NSColor.black.withAlphaComponent(0.38)
    )
    public static let elevationNear = (radius: CGFloat(9), y: CGFloat(3))
    public static let elevationFarColor: Color = EditorialColor.dynamic(
        light: NSColor.black.withAlphaComponent(0.12),
        dark: NSColor.black.withAlphaComponent(0.52)
    )
    public static let elevationFar = (radius: CGFloat(22), y: CGFloat(8))

    /// 面板级：弹窗、全局搜索、海报预览等悬浮于应用之上的内容。广域漫反射。
    public static let panelNearColor: Color = EditorialColor.dynamic(
        light: NSColor.black.withAlphaComponent(0.10),
        dark: NSColor.black.withAlphaComponent(0.45)
    )
    public static let panelNear = (radius: CGFloat(12), y: CGFloat(4))
    public static let panelFarColor: Color = EditorialColor.dynamic(
        light: NSColor.black.withAlphaComponent(0.18),
        dark: NSColor.black.withAlphaComponent(0.62)
    )
    public static let panelFar = (radius: CGFloat(32), y: CGFloat(14))

    /// 写真卡片：摄影底图主视觉，三层复合软影（近距接触 + 广域纸张漫反射 + 深邃层次）。
    /// 这是设计系统最佳实践（`CardView` 已在用），入库供其它卡片复刻。
    public static let photoNearColor: Color = EditorialColor.dynamic(
        light: NSColor.black.withAlphaComponent(0.05),
        dark: NSColor.black.withAlphaComponent(0.38)
    )
    public static let photoNear = (radius: CGFloat(4), y: CGFloat(2))
    public static let photoMidColor: Color = EditorialColor.dynamic(
        light: NSColor.black.withAlphaComponent(0.12),
        dark: NSColor.black.withAlphaComponent(0.60)
    )
    public static let photoMid = (radius: CGFloat(22), y: CGFloat(10))
    public static let photoFarColor: Color = EditorialColor.dynamic(
        light: NSColor.black.withAlphaComponent(0.04),
        dark: NSColor.black.withAlphaComponent(0.24)
    )
    public static let photoFar = (radius: CGFloat(40), y: CGFloat(18))
}

// MARK: - 动效（语义即弹簧参数）

/// 动效刻度。此前 38 处弹簧挤在 `response 0.25~0.5 / damping 0.6~0.8` 窄带，
/// **14 组不同参数表达同一类语义**，且无一处有回弹感。
/// 按「发生什么」而非「用哪个数」取档，消灭参数漂移。
public enum EditorialSpring {
    /// 微交互：按钮按压、开关、勾选。快、稳、几乎无回弹（避免抖动显廉价）。
    public static let micro = Animation.spring(response: 0.22, dampingFraction: 0.82)
    /// 状态切换：胶囊选中、分段控件、Tab、悬停着色。稍慢以显从容。
    public static let state = Animation.spring(response: 0.32, dampingFraction: 0.82)
    /// 内容出现：卡片堆叠就位、Toast 滑入、弹窗浮现。略带回弹。
    public static let content = Animation.spring(response: 0.38, dampingFraction: 0.76)
    /// 大位移：卡片飞出、面板整体换页。慢出，带回弹收尾。
    public static let motion = Animation.spring(response: 0.48, dampingFraction: 0.72)

    /// 显式曲线：进度条、扫光等有明确起止语义的非弹性动画。
    public static let standard = Animation.easeInOut(duration: 0.28)
    public static let exit = Animation.easeOut(duration: 0.22)
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

// MARK: - 卡片修饰符（旧玻璃卡已随视觉轮收敛删除）
//
// 原 `EditorialGlassCardModifier`（白 sheen + 对角三段渐变描边 + 0.18 广域影）
// 在设置/同步/导入/导出/剪藏/历史七处与知识库的扁平卡两制并存，
// 2026-10-05 视觉轮归一到 `insightPanelCard`（InsightDesignSystem.swift）。

public extension View {
    // MARK: 阴影便捷方法（按层级取档，消灭 7 套规格漂移）

    /// 控件级阴影（按钮、徽章、Toast）
    func editorialControlShadow() -> some View {
        let s = EditorialShadow.control
        return shadow(color: EditorialShadow.controlColor, radius: s.radius, y: s.y)
    }

    /// 内容级阴影（玻璃卡、列表容器、图表卡片）：近距接触 + 广域漫反射
    func editorialElevationShadow() -> some View {
        let near = EditorialShadow.elevationNear
        let far = EditorialShadow.elevationFar
        return shadow(color: EditorialShadow.elevationNearColor, radius: near.radius, y: near.y)
            .shadow(color: EditorialShadow.elevationFarColor, radius: far.radius, y: far.y)
    }

    // MARK: 图表入场编排

    /// 图表区块的 stagger 浮现：`index` 决定第几个入场（每个间隔 55ms），
    /// `revealed` 由宿主在 `onAppear` 翻 true。
    /// 只驱动 opacity + 位移，不改 frame —— 几何驱动的图表改 frame 会与 GeometryReader 打架。
    func chartReveal(index: Int, revealed: Bool, stagger: Double = 0.055) -> some View {
        opacity(revealed ? 1 : 0)
            .offset(y: revealed ? 0 : 14)
            .animation(
                EditorialSpring.content.delay(Double(index) * stagger),
                value: revealed
            )
    }

    // MARK: 输入框描边

    /// 输入框描边：浅色模式下 `glassBorder`（0.09 黑）叠 0.78 白玻璃几乎不可见，
    /// 用 `fieldBorder`（0.20 黑）取代可保证边界可辨。`isFocused` 时进一步加深。
    func editorialFieldBorder(cornerRadius: CGFloat = EditorialRadius.control, isFocused: Bool = false) -> some View {
        let color = isFocused ? EditorialColor.fieldBorderFocused : EditorialColor.fieldBorder
        return overlay(
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .strokeBorder(color, lineWidth: isFocused ? 1.5 : 1)
        )
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
    var scale: CGFloat = 0.97
    var playAudio: Bool = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? scale : 1.0)
            .opacity(configuration.isPressed ? 0.85 : 1.0)
            .animation(reduceMotion ? nil : EditorialSpring.micro, value: configuration.isPressed)
            .onChange(of: configuration.isPressed) { wasPressed, isPressed in
                if isPressed && !wasPressed && playAudio {
                    AudioEffectManager.shared.playMechanicalSwitch()
                    HapticFeedbackHelper.shared.buttonClick()
                }
            }
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
        .help(Text(LocalizedStringKey(help)))
    }
}
