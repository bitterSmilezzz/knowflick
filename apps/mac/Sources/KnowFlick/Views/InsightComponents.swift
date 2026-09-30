import SwiftUI

// MARK: - 深色卡片容器
//
// Cutline/Filen 的基础构件：圆角深色块 + 1pt 微描边 + 可选中变亮描边。
// 替代旧 `editorialGlassCard`（纯色半透明 + 描边，浅色下发虚）。

struct InsightCard<Content: View>: View {
    var cornerRadius: CGFloat = InsightRadius.card
    var padding: CGFloat = InsightLayout.contentPadding
    var isSelected: Bool = false
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(
                        isSelected ? InsightColor.borderStrong : InsightColor.border,
                        lineWidth: 1
                    )
            )
            .animation(InsightMotion.card, value: isSelected)
    }
}

/// 无内边距变体：内容自己控制 padding（如列表行）
struct InsightRawCard<Content: View>: View {
    var cornerRadius: CGFloat = InsightRadius.card
    var isSelected: Bool = false
    @ViewBuilder var content: Content

    var body: some View {
        content
            .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(
                        isSelected ? InsightColor.borderStrong : InsightColor.border,
                        lineWidth: 1
                    )
            )
            .animation(InsightMotion.card, value: isSelected)
    }
}

// MARK: - 分区标签（大写 + 小字距）

/// Cutline 的 `MY WORKSPACE` / `Pinned 3` / `FOLDERS` 形态。
struct InsightSectionLabel: View {
    let text: String
    var trailing: String? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: InsightSpacing.small) {
            Text(text)
                .font(InsightFont.sectionLabel())
                .tracking(0.9)
                .textCase(.uppercase)
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
/// 颜色即语义：实心浅底 + 同色系前景 + 同色系描边。
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

    var body: some View {
        HStack(spacing: 4) {
            if let icon {
                Image(systemName: icon)
                    .font(.system(size: 8.5, weight: .bold))
            }
            Text(text)
                .font(InsightFont.sectionLabel(0.5))
                .tracking(0.5)
                .textCase(.uppercase)
                .lineLimit(1)
        }
        .foregroundStyle(tone.foreground)
        .padding(.horizontal, 7)
        .padding(.vertical, 3.5)
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

    var body: some View {
        HStack(spacing: 2) {
            ForEach(items, id: \.self) { item in
                let isOn = item == selection
                Button {
                    withAnimation(InsightMotion.pill) { selection = item }
                } label: {
                    HStack(spacing: InsightSpacing.small) {
                        Text(item)
                            .font(InsightFont.bodyStrong)
                            .foregroundStyle(isOn ? InsightColor.textPrimary : InsightColor.textTertiary)
                        if let counts, let n = counts[item] {
                            Text("\(n)")
                                .font(InsightFont.monoSmall)
                                .monospacedDigit()
                                .foregroundStyle(isOn ? InsightColor.textSecondary : InsightColor.textMuted)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background {
                        if isOn {
                            Capsule()
                                .fill(InsightColor.surfaceRaised)
                                .overlay(Capsule().strokeBorder(InsightColor.border, lineWidth: 1))
                                .matchedGeometryEffect(id: "pill", in: pill)
                        }
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(InsightColor.surfaceSunken, in: Capsule())
        .overlay(Capsule().strokeBorder(InsightColor.border, lineWidth: 1))
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
                    .animation(InsightMotion.value, value: value)
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

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(InsightColor.neutralSoft)
                Capsule()
                    .fill(tint)
                    .frame(width: max(height, geo.size.width * CGFloat(min(max(value, 0), 1))))
            }
        }
        .frame(height: height)
        .clipShape(Capsule())
        .animation(InsightMotion.value, value: value)
    }
}

// MARK: - 图标按钮

/// Cutline 顶栏图标钮：无底色圆钮，hover 时浮现底色。
struct InsightIconButton: View {
    let icon: String
    var size: CGFloat = 15
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
                .foregroundStyle(isActive && activeTint != nil ? activeTint! : tint)
                .frame(width: frame, height: frame)
                .background(
                    (isActive && activeTint != nil ? activeTint!.opacity(0.16) : (hovering ? InsightColor.neutralSoft : .clear)),
                    in: Circle()
                )
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(help)
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
                    Image(systemName: icon).font(.system(size: 11.5, weight: .semibold))
                }
                Text(title)
                    .font(InsightFont.bodyStrong)
            }
            .padding(.horizontal, style == .plain ? 10 : 14)
            .padding(.vertical, 7)
            .foregroundStyle(foreground)
            .modifier(InsightButtonBackground(style: style, tint: tint, hovering: hovering))
            .opacity(isEnabled ? 1 : 0.4)
            .scaleEffect(hovering && isEnabled ? 1.02 : 1.0)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .onHover { hovering = $0 }
        .animation(InsightMotion.card, value: hovering)
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
    var action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: InsightSpacing.compact) {
                Image(systemName: icon)
                    .font(.system(size: 13.5, weight: .medium))
                    .frame(width: 20)
                    .foregroundStyle(isSelected ? InsightColor.accent : InsightColor.textTertiary)
                if isExpanded {
                    Group {
                        Text(title)
                            .font(InsightFont.body)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        if let count {
                            Text("\(count)")
                                .font(InsightFont.monoSmall)
                                .monospacedDigit()
                                // 计数变化数上去，不跳变（ui-research 共识 22：数字会变时让它数上去）
                                .contentTransition(.numericText())
                                .animation(InsightMotion.value, value: count)
                        }
                    }
                    .transition(.opacity)
                }
            }
            .foregroundStyle(isSelected ? InsightColor.textPrimary : (hovering ? InsightColor.textSecondary : InsightColor.textTertiary))
            .padding(.horizontal, isExpanded ? 10 : 0)
            .padding(.vertical, 7)
            .frame(maxWidth: .infinity, alignment: isExpanded ? .leading : .center)
            .background(
                isSelected ? InsightColor.surfaceRaised : (hovering ? InsightColor.neutralSoft : .clear),
                in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
                    .strokeBorder(isSelected ? InsightColor.border : .clear, lineWidth: 1)
            )
            .overlay(alignment: .leading) {
                if isSelected {
                    Capsule()
                        .fill(InsightColor.accent)
                        .frame(width: 3, height: 18)
                        .padding(.leading, 2)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(title)
        .accessibilityValue(isSelected ? "当前页面" : "")
        .padding(.leading, indent)
        .animation(InsightMotion.card, value: isSelected)
        .animation(InsightMotion.card, value: hovering)
    }
}
