import SwiftUI

// MARK: - 深色卡片容器（Awwwards 级双层微质感）
//
// 融合 Doppelrand 双层嵌套架构与镜面高光 (Specular Light Catch)：
//   · 顶部微光渐变层，增强立体景深
//   · 1pt 精密描边：顶部迎光高亮，底部自然暗下
//   · 极度细腻的漫反射浮雕阴影

struct InsightCard<Content: View>: View {
    var cornerRadius: CGFloat = InsightRadius.card
    var padding: CGFloat = InsightLayout.contentPadding
    var isSelected: Bool = false
    var isInteractive: Bool = false
    @ViewBuilder var content: Content

    @State private var isHovered = false

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(InsightColor.surface)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(
                        isSelected ? AnyShapeStyle(InsightColor.accent) : (isHovered ? AnyShapeStyle(InsightColor.borderStrong) : AnyShapeStyle(InsightColor.border)),
                        lineWidth: 1
                    )
            )
            .shadow(
                color: Color.black.opacity(isHovered ? 0.08 : 0.03),
                radius: isHovered ? 6 : 2,
                y: isHovered ? 2 : 1
            )
            .onHover { hovering in
                if isInteractive {
                    withAnimation(InsightMotion.tactile) {
                        isHovered = hovering
                    }
                }
            }
    }
}

/// 实体硬件容器（极简统一单层卡片）
struct InsightDoubleBezelCard<Content: View>: View {
    var outerRadius: CGFloat = InsightRadius.cardOuter
    var innerRadius: CGFloat = InsightRadius.cardInner
    var outerPadding: CGFloat = 0
    var contentPadding: CGFloat = InsightLayout.contentPadding
    var isSelected: Bool = false
    var isInteractive: Bool = false
    @ViewBuilder var content: Content

    @State private var isHovered = false

    var body: some View {
        content
            .padding(contentPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(InsightColor.surface)
            .clipShape(RoundedRectangle(cornerRadius: outerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: outerRadius, style: .continuous)
                    .strokeBorder(
                        isSelected ? AnyShapeStyle(InsightColor.accent) : (isHovered ? AnyShapeStyle(InsightColor.borderStrong) : AnyShapeStyle(InsightColor.border)),
                        lineWidth: 1
                    )
            )
            .shadow(
                color: Color.black.opacity(isHovered ? 0.08 : 0.03),
                radius: isHovered ? 6 : 2,
                y: isHovered ? 2 : 1
            )
            .onHover { hovering in
                if isInteractive {
                    withAnimation(InsightMotion.tactile) {
                        isHovered = hovering
                    }
                }
            }
    }
}

/// 无内边距变体：内容自己控制 padding（如列表行）
struct InsightRawCard<Content: View>: View {
    var cornerRadius: CGFloat = InsightRadius.card
    var isSelected: Bool = false
    @ViewBuilder var content: Content

    var body: some View {
        content
            .background(InsightColor.surface)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(
                        isSelected ? AnyShapeStyle(InsightColor.accent) : AnyShapeStyle(InsightColor.border),
                        lineWidth: 1
                    )
            )
    }
}

// MARK: - 分区标签（大写 + 小字距）

/// Cutline 的 `MY WORKSPACE` / `Pinned 3` / `FOLDERS` 形态。
struct InsightSectionLabel: View {
    let text: String
    var trailing: String? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: InsightSpacing.small) {
            Text(LocalizedStringKey(text))
                .font(InsightFont.sectionLabel(1.2))
                .tracking(1.2)
                .foregroundStyle(InsightColor.textTertiary)
            Spacer(minLength: 0)
            if let trailing {
                Text(trailing)
                    .font(InsightFont.monoSmall)
                    .foregroundStyle(InsightColor.textMuted)
                    .monospacedDigit()
            }
        }
    }
}

// MARK: - 药丸徽章（语义色）

/// Cutline 的 `6 IN REVIEW` / `RENDERING` / `PUBLISHED` 形态。
/// 颜色即语义：实心浅底 + 同色系前景 + 同色系描边 + 呼吸微光点。
struct InsightPill: View {
    enum Tone {
        case accent, success, warning, danger, neutral, violet

        var foreground: Color {
            switch self {
            case .accent: InsightColor.accent
            case .success: InsightColor.success
            case .warning: InsightColor.warning
            case .danger: InsightColor.danger
            case .neutral: InsightColor.textSecondary
            case .violet: InsightColor.violet
            }
        }
        var background: Color {
            switch self {
            case .accent: InsightColor.accentSoft
            case .success: InsightColor.successSoft
            case .warning: InsightColor.warningSoft
            case .danger: InsightColor.dangerSoft
            case .neutral: InsightColor.neutralSoft
            case .violet: InsightColor.violet.opacity(0.18)
            }
        }
    }

    let text: String
    var tone: Tone = .neutral
    var icon: String? = nil
    var showIndicator: Bool = false

    var body: some View {
        HStack(spacing: 5) {
            if showIndicator {
                Circle()
                    .fill(tone.foreground)
                    .frame(width: 5, height: 5)
                    .shadow(color: tone.foreground.opacity(0.7), radius: 3)
            }
            if let icon {
                Image(systemName: icon)
                    .font(.system(size: 8.5, weight: .bold))
            }
            Text(LocalizedStringKey(text))
                .font(InsightFont.sectionLabel(0.6))
                .tracking(0.6)
                .textCase(.uppercase)
                .lineLimit(1)
        }
        .foregroundStyle(tone.foreground)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(tone.background, in: Capsule())
        .overlay(Capsule().strokeBorder(tone.foreground.opacity(0.28), lineWidth: 1))
    }
}

// MARK: - 分段药丸筛选器
//
// 素材 e7/ 的分段控件：选中项为实心浅色药丸，滑块用 matchedGeometryEffect 平滑吸边。

struct InsightSegmented: View {
    let items: [String]
    @Binding var selection: String
    var counts: [String: Int]? = nil

    @Namespace private var pill
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 2) {
            ForEach(items, id: \.self) { item in
                InsightSegmentedItem(
                    title: item,
                    count: counts?[item],
                    isOn: item == selection,
                    ns: pill
                ) {
                    selection = item
                }
            }
        }
        .padding(3)
        .background(InsightColor.surfaceSunken, in: Capsule())
        .overlay(Capsule().strokeBorder(InsightColor.border, lineWidth: 1))
        // 滑块吸边动画契约内置在组件里：matchedGeometryEffect 的宿主必须自带
        // 动画上下文，否则换一个调用方就退化成硬跳（此前仅 HistoryView 包了）
        .animation(reduceMotion ? nil : InsightMotion.pill, value: selection)
    }
}

private struct InsightSegmentedItem: View {
    let title: String
    var count: Int?
    let isOn: Bool
    let ns: Namespace.ID
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: InsightSpacing.small) {
                Text(LocalizedStringKey(title))
                    .font(InsightFont.bodyStrong)
                    .foregroundStyle(isOn ? InsightColor.textPrimary : (hovering ? InsightColor.textSecondary : InsightColor.textTertiary))
                if let count {
                    Text("\(count)")
                        .font(InsightFont.monoSmall)
                        .monospacedDigit()
                        .foregroundStyle(isOn ? InsightColor.textSecondary : InsightColor.textMuted)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background {
                ZStack {
                    if isOn {
                        Capsule()
                            .fill(InsightColor.surfaceRaised)
                            .overlay(Capsule().strokeBorder(InsightColor.border, lineWidth: 1))
                            .matchedGeometryEffect(id: "pill", in: ns)
                    } else if hovering {
                        Capsule().fill(InsightColor.neutralSoft.opacity(0.6))
                    }
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(PressableButtonStyle(scale: 0.97))
        .onHover { hovering = $0 }
        .accessibilityAddTraits(isOn ? [.isSelected] : [])
    }
}

// MARK: - 筛选 chip（⌘F 搜索面板等过滤条的统一形态）
//
// 选中 = accentSoft 实心底 + accent 描边；悬停 = 中性微底。一次只表达「选中/未选中」
// 一个维度，替代此前来源行与分类行各自手写、选中态还长得不一样的两套样式。

struct InsightFilterChip: View {
    let title: String
    var icon: String? = nil
    var count: String? = nil
    let isSelected: Bool
    var action: () -> Void

    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 10))
                }
                Text(LocalizedStringKey(title))
                    .font(InsightFont.callout)
                if let count {
                    Text(count)
                        .font(InsightFont.monoSmall)
                        .monospacedDigit()
                        .opacity(0.7)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(
                isSelected ? InsightColor.accentSoft : (hovering ? InsightColor.neutralSoft : InsightColor.surface),
                in: Capsule()
            )
            .overlay(
                Capsule().strokeBorder(
                    isSelected ? InsightColor.accent.opacity(0.55) : (hovering ? InsightColor.borderStrong : InsightColor.border),
                    lineWidth: 1
                )
            )
            .foregroundStyle(isSelected ? InsightColor.textPrimary : (hovering ? InsightColor.textSecondary : InsightColor.textTertiary))
            .contentShape(Capsule())
        }
        .buttonStyle(PressableButtonStyle(scale: 0.96, playAudio: false))
        .onHover { hovering = $0 }
        .animation(reduceMotion ? nil : InsightMotion.tactile, value: hovering)
        .animation(reduceMotion ? nil : InsightMotion.tactile, value: isSelected)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}

// MARK: - 统计块（大数字 + 小说明）

/// Cutline 的 `84.2 GB / 42% of 200 GB used` 与 Filen 的 `245.6 GB of 1 TB used`。
struct InsightStatBlock: View {
    let value: String
    let label: String
    var caption: String? = nil
    var tone: InsightPill.Tone = .neutral
    var progress: Double? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: InsightSpacing.small) {
            HStack(alignment: .firstTextBaseline, spacing: InsightSpacing.small) {
                Text(value)
                    .font(InsightFont.statMedium)
                    .foregroundStyle(InsightColor.textPrimary)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    // numericText 只在动画上下文里生效：这里补上触发键，
                    // 否则调用方不包 withAnimation 时数字仍是硬跳（ui-research 共识 22）
                    .animation(reduceMotion ? nil : InsightMotion.value, value: value)
                if let caption {
                    Text(caption)
                        .font(InsightFont.caption)
                        .foregroundStyle(InsightColor.textMuted)
                }
            }
            if let progress {
                InsightProgressBar(value: progress, tint: tone.foreground)
            }
            Text(label)
                .font(InsightFont.caption)
                .foregroundStyle(InsightColor.textSecondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - 进度条

struct InsightProgressBar: View {
    let value: Double
    var tint: Color = InsightColor.accent
    var height: CGFloat = 5
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(InsightColor.neutralSoft)
                Capsule()
                    .fill(tint)
                    .frame(width: geo.size.width * CGFloat(min(max(value, 0), 1)))
            }
        }
        .frame(height: height)
        .clipShape(Capsule())
        .animation(reduceMotion ? nil : InsightMotion.value, value: value)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("进度")
        .accessibilityValue("\(Int(min(max(value, 0), 1) * 100))%")
    }
}

// MARK: - 图标按钮

/// 极简图标钮：微质感圆钮，hover 时平滑浮现底色。
struct InsightIconButton: View {
    let icon: String
    var size: CGFloat = 14
    var frame: CGFloat = 30
    var tint: Color = InsightColor.textSecondary
    var activeTint: Color? = nil
    var isActive: Bool = false
    var help: String = ""
    var action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: size, weight: .semibold))
                .foregroundStyle(isActive && activeTint != nil ? activeTint! : (hovering ? InsightColor.textPrimary : tint))
                .frame(width: frame, height: frame)
                .background(
                    ZStack {
                        if isActive && activeTint != nil {
                            Circle().fill(activeTint!.opacity(0.14))
                            Circle().strokeBorder(activeTint!.opacity(0.3), lineWidth: 1)
                        } else if hovering {
                            Circle().fill(InsightColor.surfaceRaised)
                            Circle().strokeBorder(InsightColor.border, lineWidth: 1)
                        }
                    }
                )
                .animation(InsightMotion.tactile, value: hovering)
        }
        // 图标小钮补按压反馈（静默：机械开关音留给主按钮，避免高频小钮过吵）
        .buttonStyle(PressableButtonStyle(scale: 0.90, playAudio: false))
        .onHover { hovering = $0 }
        .help(help)
        .accessibilityLabel(help.isEmpty ? icon : help)
    }
}

// MARK: - 主按钮

struct InsightButton: View {
    enum Style { case primary, secondary, plain }

    let title: String
    var icon: String? = nil
    var style: Style = .secondary
    var tint: Color = InsightColor.accent
    var isEnabled: Bool = true
    var action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: InsightSpacing.small) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 11.5, weight: .semibold))
                        .offset(x: hovering && style == .primary ? 1 : 0)
                        .animation(InsightMotion.tactile, value: hovering)
                }
                Text(LocalizedStringKey(title))
                    .font(InsightFont.bodyStrong)
            }
            .padding(.horizontal, style == .plain ? 10 : 15)
            .padding(.vertical, 8)
            .foregroundStyle(foreground)
            .modifier(InsightButtonBackground(style: style, tint: tint, hovering: hovering))
            .shadow(
                color: Color.black.opacity(style == .primary && isEnabled ? (hovering ? 0.16 : 0.08) : 0),
                radius: hovering ? 6 : 3,
                y: hovering ? 2 : 1
            )
            .animation(InsightMotion.tactile, value: hovering)
            .opacity(isEnabled ? 1 : 0.4)
        }
        .buttonStyle(PressableButtonStyle(scale: 0.96))
        .disabled(!isEnabled)
        .onHover { hovering = $0 }
    }

    private var foreground: Color {
        switch style {
        case .primary: .white
        case .secondary: InsightColor.textPrimary
        case .plain: isEnabled ? tint : InsightColor.textMuted
        }
    }
}

/// 按钮背景 + 描边：抽成 ViewModifier，避免 `@ViewBuilder` 计算属性被当成 ShapeStyle。
private struct InsightButtonBackground: ViewModifier {
    let style: InsightButton.Style
    let tint: Color
    let hovering: Bool

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
        content
            .background { fill }
            .overlay(shape.strokeBorder(stroke, lineWidth: 1))
    }

    @ViewBuilder private var fill: some View {
        switch style {
        case .primary:
            shape(color: tint)
        case .secondary:
            shape(color: hovering ? InsightColor.surfaceRaised : InsightColor.surfaceSunken)
        case .plain:
            shape(color: hovering ? InsightColor.neutralSoft : .clear)
        }
    }

    private func shape(color: Color) -> some View {
        RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous).fill(color)
    }

    private var stroke: Color {
        switch style {
        case .primary: .clear
        case .secondary: hovering ? InsightColor.borderStrong : InsightColor.border
        case .plain: .clear
        }
    }
}

// MARK: - 侧栏行

/// Cutline 侧栏行：图标 + 文字 + 右侧计数；选中项为实心浅底圆角块。
struct InsightSidebarRow: View {
    let icon: String
    let title: String
    var count: Int? = nil
    var isSelected: Bool = false
    var isExpanded: Bool = true
    var indent: CGFloat = 0
    var helpText: String? = nil
    var action: () -> Void

    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var hoverDescription: String {
        [helpText ?? title, isSelected ? "当前页面" : nil].compactMap { $0 }.joined(separator: "\n")
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: InsightSpacing.compact) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: isSelected ? .semibold : .medium))
                    .frame(width: 20)
                    .foregroundStyle(isSelected ? InsightColor.textPrimary : InsightColor.textTertiary)
                if isExpanded {
                    Group {
                        Text(LocalizedStringKey(title))
                            .font(InsightFont.body)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        if let count {
                            Text("\(count)")
                                .font(InsightFont.monoSmall)
                                .monospacedDigit()
                                // 计数变化数上去，不跳变（ui-research 共识 22：数字会变时让它数上去）
                                .contentTransition(.numericText())
                                .animation(reduceMotion ? nil : InsightMotion.value, value: count)
                        }
                    }
                    .transition(.opacity)
                }
            }
            .foregroundStyle(isSelected ? InsightColor.textPrimary : (hovering ? InsightColor.textSecondary : InsightColor.textTertiary))
            .padding(.horizontal, isExpanded ? 10 : 0)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: isExpanded ? .leading : .center)
            .background(
                isSelected ? InsightColor.surfaceRaised : (hovering ? InsightColor.neutralSoft : .clear),
                in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
                    .strokeBorder(isSelected ? AnyShapeStyle(InsightColor.borderStrong) : AnyShapeStyle(Color.clear), lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        // 悬停底色与选中块都有过渡：侧栏是点击最密集的区域，硬跳最显廉价
        .animation(reduceMotion ? nil : InsightMotion.tactile, value: hovering)
        .animation(reduceMotion ? nil : InsightMotion.tactile, value: isSelected)
        .help(isExpanded ? hoverDescription : "")
        .sidebarHoverTip(hoverDescription, enabled: !isExpanded)
        .accessibilityLabel(title)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
        .accessibilityValue([isSelected ? "当前页面" : nil, count.map { "\($0) 张" }].compactMap { $0 }.joined(separator: "，"))
        .padding(.leading, indent)
    }
}

/// Directory and task links keep their geometry stable under the pointer.
/// Frequent navigation has immediate feedback; keyboard focus remains visible.
struct InsightListButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        Row(configuration: configuration, isEnabled: isEnabled)
    }

    private struct Row: View {
        let configuration: ButtonStyleConfiguration
        let isEnabled: Bool
        @State private var hovering = false

        var body: some View {
            configuration.label
                .background(
                    isEnabled && (hovering || configuration.isPressed) ? InsightColor.neutralSoft : .clear,
                    in: RoundedRectangle(cornerRadius: InsightRadius.control)
                )
                .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.45)
                .onHover { hovering = $0 }
                .onHover { hovering in
                    if hovering {
                        NSCursor.pointingHand.push()
                    } else {
                        NSCursor.pop()
                    }
                }
        }
    }
}

/// 行内文字链接样式（「进入刷卡模式 ⌘2」「清除搜索」这类入口）：
/// 悬停加亮 + 指针光标 + 按压微缩。不画底色，几何完全稳定。
struct InsightTextLinkStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        Row(configuration: configuration, isEnabled: isEnabled)
    }

    private struct Row: View {
        let configuration: ButtonStyleConfiguration
        let isEnabled: Bool
        @State private var hovering = false
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        var body: some View {
            configuration.label
                .opacity(isEnabled ? (configuration.isPressed ? 0.55 : (hovering ? 1.0 : 0.78)) : 0.45)
                .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
                .onHover { hovering = $0 }
                .onHover { hovering in
                    if hovering {
                        NSCursor.pointingHand.push()
                    } else {
                        NSCursor.pop()
                    }
                }
                .animation(reduceMotion ? nil : InsightMotion.tactile, value: hovering)
        }
    }
}

