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
                    Text(title)
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

/// 空态（Cutline 用图标 + 标题 + 说明 + 动作）
struct InsightEmptyState: View {
    let icon: String
    let title: String
    let message: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: InsightSpacing.default) {
            Image(systemName: icon)
                .font(.system(size: 34))
                .foregroundStyle(InsightColor.textMuted)
            Text(LocalizedStringKey(title))
                .font(InsightFont.headline)
                .foregroundStyle(InsightColor.textSecondary)
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
