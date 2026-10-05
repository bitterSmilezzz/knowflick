import SwiftUI
import AppKit
import KnowFlickCore

/// 沉浸式 3D 翻转测验卡片：正面主动回忆，背面揭晓答案与艾宾浩斯自评
struct QuizCardView: View {
    let card: KnowledgeCard
    let isFlipped: Bool
    let onFlip: () -> Void
    let onRate: (AppStore.QuizRating) -> Void
    var onOpenChat: (() -> Void)? = nil

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hoveredRating: AppStore.QuizRating? = nil

    private var theme: CategoryTheme {
        CategoryTheme.theme(for: card, cache: .shared)
    }

    var body: some View {
        ZStack {
            // 正面：题目与主动回忆倒逼思考
            ScrollView { frontView }
                .opacity(isFlipped ? 0 : 1)
                // 透明度在翻转前半段先淡出：旋转越过 90° 之前正面已隐，
                // 背面镜像字不会在翻转中段露出来
                .animation(reduceMotion ? nil : .easeIn(duration: 0.2), value: isFlipped)
                .rotation3DEffect(
                    .degrees(reduceMotion ? 0 : (isFlipped ? 180 : 0)),
                    axis: (x: 0, y: 1, z: 0),
                    perspective: 0.55
                )
                .allowsHitTesting(!isFlipped)

            // 背面：答案解析与记忆评级反馈
            backView
                .opacity(isFlipped ? 1 : 0)
                // 透明度在翻转后半段再淡入：与正面错时，接缝落在 90° 侧棱上
                .animation(reduceMotion ? nil : .easeIn(duration: 0.2).delay(0.2), value: isFlipped)
                .rotation3DEffect(
                    .degrees(reduceMotion ? 0 : (isFlipped ? 0 : -180)),
                    axis: (x: 0, y: 1, z: 0),
                    perspective: 0.55
                )
                .allowsHitTesting(isFlipped)
        }
        .frame(width: 560, height: 500)
    }

    // MARK: - 正面视图（问题与思考）

    private var frontView: some View {
        VStack(alignment: .leading, spacing: 0) {
            // 顶栏徽章（分类徽章沿用 CategoryTheme 语义色；「主动回忆」为面板主色 accent）
            HStack(spacing: InsightSpacing.compact) {
                HStack(spacing: InsightSpacing.tiny) {
                    Image(systemName: theme.iconName)
                        .font(.system(size: 11, weight: .bold))
                    Text(card.category)
                        .font(InsightFont.callout)
                }
                .foregroundStyle(theme.accent)
                .padding(.horizontal, InsightSpacing.default)
                .padding(.vertical, 4.5)
                .background(theme.accent.opacity(0.12), in: Capsule())
                .overlay(Capsule().strokeBorder(theme.accent.opacity(0.3), lineWidth: 1))

                HStack(spacing: InsightSpacing.tiny) {
                    Image(systemName: "brain.head.profile")
                        .font(.system(size: 11, weight: .medium))
                    Text("主动回忆")
                        .font(InsightFont.caption.weight(.semibold))
                }
                .foregroundStyle(InsightColor.accent)
                .padding(.horizontal, InsightSpacing.default)
                .padding(.vertical, 4.5)
                .background(InsightColor.accentSoft, in: Capsule())
                .overlay(Capsule().strokeBorder(InsightColor.accent.opacity(0.3), lineWidth: 1))

                Spacer()

                masteryBadge
            }

            Spacer(minLength: InsightSpacing.medium)

            // 测验引导
            Text("QUESTION")
                .font(InsightFont.monoSmall)
                .tracking(2.0)
                .foregroundStyle(InsightColor.textTertiary)
                .padding(.bottom, InsightSpacing.small)

            // 问题大标题
            Text(card.displayHeadline)
                .font(InsightFont.largeTitle)
                .foregroundStyle(InsightColor.textPrimary)
                .lineSpacing(6)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, InsightSpacing.tiny)

            // 深度回忆指引
            VStack(alignment: .leading, spacing: InsightSpacing.small) {
                Text("尝试在脑海中组织语言：")
                    .font(InsightFont.callout)
                    .foregroundStyle(InsightColor.textSecondary)
                Text("这个知识的核心机制、前因后果或关键结论是什么？组织好思路后，翻看背面核对。")
                    .font(InsightFont.caption)
                    .foregroundStyle(InsightColor.textMuted)
                    .lineSpacing(4)
            }
            .padding(InsightSpacing.medium)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(InsightColor.surfaceSunken, in: RoundedRectangle(cornerRadius: InsightRadius.inset, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: InsightRadius.inset, style: .continuous)
                    .strokeBorder(InsightColor.border, lineWidth: 1)
            )

            Spacer(minLength: InsightSpacing.medium)

            // 翻转按钮（主操作：accent 白字实底，去渐变与投影）
            Button(action: onFlip) {
                HStack(spacing: InsightSpacing.compact) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.system(size: 14, weight: .bold))
                    Text("查看答案与解析")
                        .font(InsightFont.bodyStrong)
                    Spacer()
                    Text("␣ 空格 / ⏎")
                        .font(InsightFont.monoSmall)
                        .opacity(0.85)
                        .padding(.horizontal, InsightSpacing.small)
                        .padding(.vertical, 3)
                        .background(Color.white.opacity(0.2), in: Capsule())
                }
                .foregroundStyle(Color.white)
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
                .background(InsightColor.accent, in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.2), lineWidth: 1)
                )
            }
            .buttonStyle(PressableButtonStyle(scale: 0.98))
        }
        .padding(InsightSpacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous)
                .strokeBorder(InsightColor.border, lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.12), radius: 12, y: 4)
    }

    // MARK: - 背面视图（答案与评级）

    private var backView: some View {
        VStack(alignment: .leading, spacing: 0) {
            // 顶栏：卡片原始小标题概览
            HStack(spacing: InsightSpacing.compact) {
                HStack(spacing: InsightSpacing.tiny) {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 11, weight: .bold))
                    Text("答案解析")
                        .font(InsightFont.callout)
                }
                .foregroundStyle(InsightColor.success)
                .padding(.horizontal, InsightSpacing.default)
                .padding(.vertical, 4.5)
                .background(InsightColor.successSoft, in: Capsule())
                .overlay(Capsule().strokeBorder(InsightColor.success.opacity(0.3), lineWidth: 1))

                Text(card.category)
                    .font(InsightFont.caption.weight(.semibold))
                    .foregroundStyle(InsightColor.textTertiary)

                Spacer()

                Button(action: onFlip) {
                    HStack(spacing: InsightSpacing.tiny) {
                        Image(systemName: "arrow.turn.up.left")
                            .font(.system(size: 11, weight: .semibold))
                        Text("回看题目")
                            .font(InsightFont.captionSmall.weight(.semibold))
                    }
                    .foregroundStyle(InsightColor.textTertiary)
                    .padding(.horizontal, InsightSpacing.small)
                    .padding(.vertical, InsightSpacing.tiny)
                    .background(InsightColor.surfaceSunken, in: Capsule())
                    .overlay(Capsule().strokeBorder(InsightColor.border, lineWidth: 1))
                }
                .buttonStyle(PressableButtonStyle())
                .help("翻回题目正面 (空格键)")
            }

            // 题目微缩标题
            Text(card.displayHeadline)
                .font(InsightFont.headline)
                .foregroundStyle(InsightColor.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, InsightSpacing.compact)
                .padding(.bottom, InsightSpacing.default)

            // 核心观点引用块（强调块用 accent，替代旧琥珀当主色）
            VStack(alignment: .leading, spacing: InsightSpacing.tiny) {
                Text("核心要点")
                    .font(InsightFont.monoSmall)
                    .tracking(1.0)
                    .foregroundStyle(InsightColor.accent)
                Text(card.displaySummary)
                    .font(InsightFont.body)
                    .foregroundStyle(InsightColor.textPrimary)
                    .lineSpacing(5)
            }
            .padding(InsightSpacing.medium)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(InsightColor.accentSoft, in: RoundedRectangle(cornerRadius: InsightRadius.inset, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: InsightRadius.inset, style: .continuous)
                    .strokeBorder(InsightColor.accent.opacity(0.3), lineWidth: 1)
            )

            // 深入解读正文
            ScrollView(.vertical, showsIndicators: true) {
                Text(card.details)
                    .font(InsightFont.body)
                    .foregroundStyle(InsightColor.textSecondary)
                    .lineSpacing(6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, InsightSpacing.compact)
            }
            .frame(maxHeight: .infinity)

            if let onOpenChat {
                // AI 相关入口保留 warning 语义
                Button(action: onOpenChat) {
                    HStack(spacing: InsightSpacing.small) {
                        Image(systemName: "cpu")
                            .font(.system(size: 11, weight: .semibold))
                        Text("向 AI 追问本卡解析")
                            .font(InsightFont.callout)
                    }
                    .foregroundStyle(InsightColor.warning)
                    .padding(.horizontal, InsightSpacing.default)
                    .padding(.vertical, InsightSpacing.small)
                    .background(InsightColor.warningSoft, in: Capsule())
                    .overlay(Capsule().strokeBorder(InsightColor.warning.opacity(0.35), lineWidth: 1))
                }
                .buttonStyle(PressableButtonStyle())
                .padding(.top, InsightSpacing.tiny)
            }

            Divider()
                .overlay(InsightColor.divider)
                .padding(.vertical, InsightSpacing.compact)

            // 底部自评按键提示区
            VStack(spacing: InsightSpacing.compact) {
                Text("回忆难度评级（艾宾浩斯间隔记忆）")
                    .font(InsightFont.captionSmall)
                    .foregroundStyle(InsightColor.textTertiary)

                HStack(spacing: InsightSpacing.default) {
                    ratingButton(
                        rating: .forgot,
                        tint: InsightColor.danger,
                        shortcut: "⌘1"
                    )

                    ratingButton(
                        rating: .hesitant,
                        tint: InsightColor.warning,
                        shortcut: "⌘2"
                    )

                    ratingButton(
                        rating: .mastered,
                        tint: InsightColor.success,
                        shortcut: "⌘3"
                    )
                }
            }
        }
        .padding(InsightSpacing.large)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous)
                .strokeBorder(InsightColor.border, lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.12), radius: 12, y: 4)
    }

    // MARK: - 辅助组件

    private var masteryBadge: some View {
        Group {
            if card.masteryLevel == 2 {
                Label("已掌握", systemImage: "checkmark.circle.fill")
                    .font(InsightFont.captionSmall.weight(.bold))
                    .foregroundStyle(InsightColor.success)
                    .padding(.horizontal, InsightSpacing.compact)
                    .padding(.vertical, 3.5)
                    .background(InsightColor.successSoft, in: Capsule())
            } else if card.masteryLevel == 1 {
                Label("学习中", systemImage: "arrow.triangle.2.circlepath")
                    .font(InsightFont.captionSmall.weight(.bold))
                    .foregroundStyle(InsightColor.warning)
                    .padding(.horizontal, InsightSpacing.compact)
                    .padding(.vertical, 3.5)
                    .background(InsightColor.warningSoft, in: Capsule())
            } else {
                Text("待强化")
                    .font(InsightFont.captionSmall.weight(.semibold))
                    .foregroundStyle(InsightColor.textMuted)
                    .padding(.horizontal, InsightSpacing.compact)
                    .padding(.vertical, 3.5)
                    .background(InsightColor.surface, in: Capsule())
            }
        }
    }

    private func ratingButton(
        rating: AppStore.QuizRating,
        tint: Color,
        shortcut: String
    ) -> some View {
        Button {
            onRate(rating)
        } label: {
            VStack(spacing: InsightSpacing.tiny) {
                HStack(spacing: InsightSpacing.small) {
                    Image(systemName: rating.icon)
                        .font(.system(size: 13, weight: .bold))
                    Text(LocalizedStringKey(rating.title))
                        .font(InsightFont.bodyStrong)
                }
                .foregroundStyle(tint)

                Text(shortcut)
                    .font(InsightFont.monoSmall)
                    .foregroundStyle(InsightColor.textMuted)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: InsightRadius.inset, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: InsightRadius.inset, style: .continuous)
                    .strokeBorder(tint.opacity(0.24), lineWidth: 1)
            )
        }
        .buttonStyle(PressableButtonStyle(scale: 0.98))
        .help("\(rating.title) (\(shortcut))")
    }
}
