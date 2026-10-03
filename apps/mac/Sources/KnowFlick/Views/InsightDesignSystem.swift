import SwiftUI
import AppKit

// MARK: - Cutline / Filen 设计语言（重设计基座）
//
// 素材来源：`.scratch/ui-material/05_HTCuOh3aoAA4Qv0.png`（Cutline）
//          `.scratch/ui-material/05_HTD7CdOacAAbUJL.png`（Filen）
// 两张完整 App 设计稿共同的语言特征：
//   · 近黑底 + 深色浮动卡片，几乎不用渐变
//   · 圆角浮动侧栏（20pt）与主内容区之间有可见的结构分区
//   · 深色卡片 + 1pt 微描边（不用阴影撑层次）
//   · 药丸状态徽章（PILL）表达状态，颜色即语义
//   · 大写 + 小字距（tracking）的分区标签
//   · 大数字统计块（大字号数字 + 小字说明）
//   · 分段药丸筛选器，选中项为实心浅色药丸
//
// 命名用 `Insight*` 前缀以区别于旧 `Editorial*` 体系，可增量迁移、可回退。

// MARK: - 色彩

public enum InsightColor {
    public static func dynamic(light: NSColor, dark: NSColor) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let match = appearance.bestMatch(from: [.darkAqua, .aqua])
            return match == .darkAqua ? dark : light
        })
    }

    // MARK: 画布与表面
    /// 应用画布：比 windowBackgroundColor 更黑一档，让深色卡片「浮」起来。
    /// 浅色档带一点纸的暖灰（原值偏冷、与白色卡片几乎贴在一起）
    public static let canvas = dynamic(
        light: NSColor(red: 0.957, green: 0.949, blue: 0.933, alpha: 1.0),
        dark: NSColor(red: 0.055, green: 0.058, blue: 0.066, alpha: 1.0)
    )
    /// 侧栏：与画布略有区分（Cutline 侧栏比主区亮一档）
    public static let sidebar = dynamic(
        light: NSColor(white: 0.925, alpha: 1.0),
        dark: NSColor(red: 0.086, green: 0.090, blue: 0.102, alpha: 1.0)
    )
    /// 卡片表面：主内容区的深色卡片
    public static let surface = dynamic(
        light: NSColor(white: 1.0, alpha: 1.0),
        dark: NSColor(red: 0.118, green: 0.122, blue: 0.137, alpha: 1.0)
    )
    /// 卡片表面（次级）：用于嵌套在卡片内的小块
    public static let surfaceSunken = dynamic(
        light: NSColor(white: 0.965, alpha: 1.0),
        dark: NSColor(red: 0.086, green: 0.090, blue: 0.102, alpha: 1.0)
    )
    /// 悬浮层：sheet / popover / 浮卡
    public static let surfaceRaised = dynamic(
        light: NSColor(white: 1.0, alpha: 1.0),
        dark: NSColor(red: 0.141, green: 0.145, blue: 0.161, alpha: 1.0)
    )

    // MARK: 描边
    /// 卡片描边：1pt，深色模式下几乎不可见但提供了边缘清晰度
    public static let border = dynamic(
        light: NSColor(white: 0.0, alpha: 0.08),
        dark: NSColor.white.withAlphaComponent(0.075)
    )
    /// 卡片描边（强）：hover 或选中态
    public static let borderStrong = dynamic(
        light: NSColor(white: 0.0, alpha: 0.16),
        dark: NSColor.white.withAlphaComponent(0.16)
    )
    /// 分割线
    public static let divider = dynamic(
        light: NSColor(white: 0.0, alpha: 0.06),
        dark: NSColor.white.withAlphaComponent(0.07)
    )

    // MARK: 文字
    public static let textPrimary = dynamic(
        light: NSColor(red: 0.10, green: 0.11, blue: 0.13, alpha: 1.0),
        dark: NSColor(red: 0.965, green: 0.961, blue: 0.949, alpha: 1.0)
    )
    public static let textSecondary = dynamic(
        light: NSColor(red: 0.24, green: 0.26, blue: 0.30, alpha: 0.90),
        dark: NSColor.white.withAlphaComponent(0.62)
    )
    public static let textTertiary = dynamic(
        light: NSColor(red: 0.38, green: 0.40, blue: 0.44, alpha: 1.0),
        dark: NSColor.white.withAlphaComponent(0.58)
    )
    public static let textMuted = dynamic(
        light: NSColor(red: 0.43, green: 0.45, blue: 0.49, alpha: 1.0),
        dark: NSColor.white.withAlphaComponent(0.52)
    )

    // MARK: 语义色（药丸徽章用）
    /// 主强调：黛青墨——墨落于纸的青黑，替代原通用系统蓝（Cutline 蓝偏冷、无身份感）。
    /// 白字按钮对比度：浅色 ≈7:1、深色 ≈4.3:1（AA 大字达标）
    public static let accent = dynamic(
        light: NSColor(red: 0.153, green: 0.298, blue: 0.545, alpha: 1.0),
        dark: NSColor(red: 0.333, green: 0.470, blue: 0.780, alpha: 1.0)
    )
    public static let accentSoft = dynamic(
        light: NSColor(red: 0.153, green: 0.298, blue: 0.545, alpha: 0.10),
        dark: NSColor(red: 0.435, green: 0.573, blue: 0.859, alpha: 0.18)
    )
    /// 朱砂（印记色）：只用于「今天 / 当下」这类独一时点强调——一次界面最多一处。
    /// 这是本应用的签名色，不得用于常规状态或装饰。
    public static let seal = dynamic(
        light: NSColor(red: 0.702, green: 0.216, blue: 0.161, alpha: 1.0),
        dark: NSColor(red: 0.898, green: 0.435, blue: 0.353, alpha: 1.0)
    )
    public static let sealSoft = dynamic(
        light: NSColor(red: 0.702, green: 0.216, blue: 0.161, alpha: 0.12),
        dark: NSColor(red: 0.898, green: 0.435, blue: 0.353, alpha: 0.20)
    )
    public static let success = dynamic(
        light: NSColor(red: 0.145, green: 0.510, blue: 0.345, alpha: 1.0),
        dark: NSColor(red: 0.353, green: 0.760, blue: 0.553, alpha: 1.0)
    )
    public static let successSoft = dynamic(
        light: NSColor(red: 0.145, green: 0.510, blue: 0.345, alpha: 0.12),
        dark: NSColor(red: 0.353, green: 0.760, blue: 0.553, alpha: 0.18)
    )
    public static let warning = dynamic(
        light: NSColor(red: 0.82, green: 0.53, blue: 0.10, alpha: 1.0),
        dark: NSColor(red: 0.98, green: 0.71, blue: 0.29, alpha: 1.0)
    )
    public static let warningSoft = dynamic(
        light: NSColor(red: 0.82, green: 0.53, blue: 0.10, alpha: 0.13),
        dark: NSColor(red: 0.98, green: 0.71, blue: 0.29, alpha: 0.18)
    )
    public static let danger = dynamic(
        light: NSColor(red: 0.85, green: 0.28, blue: 0.26, alpha: 1.0),
        dark: NSColor(red: 0.98, green: 0.44, blue: 0.42, alpha: 1.0)
    )
    public static let dangerSoft = dynamic(
        light: NSColor(red: 0.85, green: 0.28, blue: 0.26, alpha: 0.12),
        dark: NSColor(red: 0.98, green: 0.44, blue: 0.42, alpha: 0.18)
    )
    public static let neutral = dynamic(
        light: NSColor(red: 0.35, green: 0.38, blue: 0.44, alpha: 1.0),
        dark: NSColor.white.withAlphaComponent(0.58)
    )
    public static let neutralSoft = dynamic(
        light: NSColor(white: 0.0, alpha: 0.06),
        dark: NSColor.white.withAlphaComponent(0.10)
    )
    /// 紫色：Cutline 的工作区标识色（头像/团队徽标）
    public static let violet = dynamic(
        light: NSColor(red: 0.48, green: 0.32, blue: 0.92, alpha: 1.0),
        dark: NSColor(red: 0.58, green: 0.42, blue: 0.98, alpha: 1.0)
    )

    // MARK: 与旧体系的桥接
    /// 摄影卡片上的文字恒定亮色（CardView 仍在用 cardText*）
    public static let cardTextPrimary = Color(red: 0.97, green: 0.96, blue: 0.94)
    public static let cardTextSecondary = Color.white.opacity(0.85)
    public static let cardTextTertiary = Color.white.opacity(0.58)
    public static let cardTextMuted = Color.white.opacity(0.40)
}

// MARK: - 字体

public enum InsightFont {
    // 界面主字：SF Pro，不用宋体——Cutline/Filen 都是无衬线工具型界面
    public static let largeTitle = Font.system(size: 26, weight: .bold)
    public static let title = Font.system(size: 20, weight: .bold)
    public static let headline = Font.system(size: 15, weight: .semibold)
    public static let body = Font.system(size: 13, weight: .regular)
    public static let bodyStrong = Font.system(size: 13, weight: .semibold)
    public static let callout = Font.system(size: 12, weight: .medium)
    public static let caption = Font.system(size: 11, weight: .medium)
    public static let captionSmall = Font.system(size: 10, weight: .medium)
    public static let mono = Font.system(size: 11, weight: .semibold, design: .monospaced)
    public static let monoSmall = Font.system(size: 10, weight: .semibold, design: .monospaced)

    /// 统计块大数字：Cutline 的「84.2 GB」「48」「16」都是粗体大号
    public static let statLarge = Font.system(size: 30, weight: .bold)
    public static let statMedium = Font.system(size: 20, weight: .bold)

    /// 阅读面衬线（宋体基因）：详情页正文标题、海报、听书条已在使用——
    /// 工具界面保持无衬线（Cutline），阅读面用衬线，这是本应用「纸与墨」的分界约定。
    public static func display(_ size: CGFloat, weight: Font.Weight = .bold) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }

    /// 分区标签：大写 + 小 + semiBold（Cutline 的 MY WORKSPACE / Pinned）
    public static func sectionLabel(_ tracking: CGFloat = 0.8) -> Font {
        .system(size: 10.5, weight: .bold)
    }
}

// MARK: - 圆角

public enum InsightRadius {
    /// 侧栏/大容器外圆角（Cutline 侧栏 20pt）
    public static let sidebar: CGFloat = 12
    /// 卡片圆角（Cutline 项目卡约 14pt）
    public static let card: CGFloat = 10
    /// 卡片内嵌小块
    public static let inset: CGFloat = 10
    /// 控件（按钮/输入框）
    public static let control: CGFloat = 8
    /// 药丸
    public static let pill: CGFloat = 999
}

// MARK: - 布局常量

public enum InsightLayout {
    /// 侧栏展开宽度（Cutline 约 240pt）
    public static let sidebarExpanded: CGFloat = 232
    /// 侧栏折叠宽度（Cutline 折叠态约 72pt）
    public static let sidebarCollapsed: CGFloat = 72
    /// 主内容区水平内边距
    public static let contentPadding: CGFloat = 24
    /// 卡片网格最小列宽
    public static let gridMinColumn: CGFloat = 240
    /// 主窗口默认尺寸
    public static let defaultWindow = (width: CGFloat(1180), height: CGFloat(800))
}

// MARK: - 间距

public enum InsightSpacing {
    public static let hair: CGFloat = 2
    public static let tiny: CGFloat = 4
    public static let small: CGFloat = 6
    public static let compact: CGFloat = 8
    public static let `default`: CGFloat = 12
    public static let medium: CGFloat = 16
    public static let large: CGFloat = 20
    public static let xl: CGFloat = 28
}

// MARK: - 动效

public enum InsightMotion {
    /// 侧栏展开/折叠、面板进出
    public static let shell = Animation.spring(response: 0.36, dampingFraction: 0.82)
    /// 侧栏展开：开比关长（ui-research 共识 27「关比开短」——起与落用不同速率，不对称才有重量）
    public static let shellOpen = shell
    /// 侧栏折叠：比展开短一档，退场要利落
    public static let shellClose = Animation.spring(response: 0.26, dampingFraction: 0.84)
    /// 卡片 hover / 选中
    public static let card = Animation.spring(response: 0.28, dampingFraction: 0.84)
    /// 药丸筛选器吸边（素材 e7 的分段控件滑块）
    public static let pill = Animation.spring(response: 0.34, dampingFraction: 0.78)
    /// 数字/进度变化
    public static let value = Animation.spring(response: 0.42, dampingFraction: 0.80)
    /// 列表交错入场单项延迟
    public static let stagger: Double = 0.04
    /// 页面切换
    public static let page = Animation.spring(response: 0.42, dampingFraction: 0.86)
}
