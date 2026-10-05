import SwiftUI

// 侧栏内容区公共件（自 InsightPlaceholderViews.swift 拆出）：
// 通用内容区框架（标题 + 描述 + 右侧操作）、空态、列表交错入场动效。

struct InsightContentScaffold<Actions: View, Content: View>: View {
    let title: String
    let subtitle: String
    @ViewBuilder var actions: Actions
    @ViewBuilder var content: Content

    init(
        title: String,
        subtitle: String,
        @ViewBuilder actions: () -> Actions = { EmptyView() },
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.subtitle = subtitle
        self.actions = actions()
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: InsightSpacing.hair) {
                    Text(LocalizedStringKey(title))
                        .font(InsightFont.title)
                        .foregroundStyle(InsightColor.textPrimary)
                    Text(subtitle)
                        .font(InsightFont.callout)
                        .foregroundStyle(InsightColor.textTertiary)
                }
                Spacer(minLength: InsightSpacing.large)
                actions
            }
            .padding(.horizontal, InsightLayout.contentPadding)
            .padding(.top, InsightSpacing.large)
            .padding(.bottom, InsightSpacing.default)

            content
        }
    }
}

// MARK: - 墨点细线空态插画（视觉轮：程序化、零位图、深浅自适应）
//
// 构图为「墨落于纸」的极简映射：三层同心细线环 + 一笔圆弧笔触 + 三枚错落墨点，
// 加一枚实心强调点（默认黛青墨，刷卡清空这类「今天/当下」语义可换朱砂）。
// 全部用 stroke/fill 绘制，无位图、无渐变洗底；深浅两色随 InsightColor 自动切换。

struct InsightInkEmptyArt: View {
    var tint: Color = InsightColor.accent
    var size: CGFloat = 92
    /// 朱砂强调点：只给「今天/当下」语义的空态（如刷卡清空），其余保持黛青墨
    var sealDot: Bool = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var settled = false

    private var dotColor: Color { sealDot ? InsightColor.seal : tint }

    var body: some View {
        ZStack {
            // 外层墨环
            Circle()
                .strokeBorder(tint.opacity(0.22), lineWidth: 1)
            // 中层墨环
            Circle()
                .strokeBorder(tint.opacity(0.13), lineWidth: 1)
                .padding(size * 0.13)
            // 一笔弧线：手写笔触的暗示，圆头起收
            Circle()
                .trim(from: 0.10, to: 0.52)
                .stroke(tint.opacity(0.42), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
                .rotationEffect(.degrees(-38))
                .padding(size * 0.26)
            // 墨点：大小与浓度错落，固定点位保证每次渲染一致
            inkDot(diameter: size * 0.098, opacity: 0.80, x: -0.30, y: 0.22)
            inkDot(diameter: size * 0.065, opacity: 0.48, x: 0.30, y: -0.12)
            inkDot(diameter: size * 0.044, opacity: 0.30, x: 0.06, y: 0.36)
            // 强调点：落在弧线起笔处，视觉上成为落款
            inkDot(diameter: size * 0.076, opacity: 1.0, x: -0.315, y: -0.17, color: dotColor)
        }
        .frame(width: size, height: size)
        .scaleEffect(settled ? 1 : 0.94)
        .opacity(settled ? 1 : 0)
        .onAppear {
            guard !reduceMotion else {
                settled = true
                return
            }
            withAnimation(EditorialSpring.content.delay(0.05)) { settled = true }
        }
        .accessibilityHidden(true)
    }

    private func inkDot(diameter: CGFloat, opacity: Double, x: CGFloat, y: CGFloat, color: Color? = nil) -> some View {
        Circle()
            .fill((color ?? tint).opacity(opacity))
            .frame(width: diameter, height: diameter)
            .offset(x: size * x, y: size * y)
    }
}

/// 空态（Cutline 用图标 + 标题 + 说明 + 动作；`inkArt` 变体用程序化墨点细线插画）
struct InsightEmptyState: View {
    var icon: String = "tray"
    var inkArt: Bool = false
    /// 墨点变体的强调点用朱砂（仅「今天/当下」语义的空态置 true）
    var sealDot: Bool = false
    let title: String
    let message: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: InsightSpacing.default) {
            if inkArt {
                InsightInkEmptyArt(sealDot: sealDot)
            } else {
                Image(systemName: icon)
                    .font(.system(size: 34))
                    .foregroundStyle(InsightColor.textMuted)
            }
            Text(LocalizedStringKey(title))
                .font(inkArt ? InsightFont.display(19) : InsightFont.headline)
                .foregroundStyle(inkArt ? InsightColor.textPrimary : InsightColor.textSecondary)
            Text(LocalizedStringKey(message))
                .font(InsightFont.body)
                .foregroundStyle(InsightColor.textTertiary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 360)
            if let actionTitle, let action {
                InsightButton(title: actionTitle, style: .secondary, action: action)
                    .padding(.top, InsightSpacing.small)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// 列表交错入场（素材 e7 的 stagger 手法）
struct InsightStaggerReveal: ViewModifier {
    let index: Int
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        // reduce-motion 分层判据（ui-research 共识 5）：整屏级入场属 large motion，
        // 系统开启「减弱动态效果」时塌为直出；micro 过渡（图标形变、勾选）不受影响
        content
            .opacity(reduceMotion || shown ? 1 : 0)
            .offset(y: reduceMotion ? 0 : (shown ? 0 : 8))
            .onAppear {
                guard !reduceMotion else {
                    shown = true
                    return
                }
                withAnimation(InsightMotion.page.delay(Double(index) * InsightMotion.stagger)) {
                    shown = true
                }
            }
    }
}
