import SwiftUI
import AppKit
import KnowFlickCore

/// 沉浸式 3D 翻转测验卡片：正面主动回忆，背面揭晓答案与艾宾浩斯自评
struct QuizCardView: View {
    let card: KnowledgeCard
    let isFlipped: Bool
    let onFlip: () -> Void
    let onRate: (AppStore.QuizRating) -> Void

    @State private var isHoveringFront = false
    @State private var hoveredRating: AppStore.QuizRating? = nil

    private var theme: CategoryTheme {
        CategoryTheme.theme(for: card, cache: .shared)
    }

    var body: some View {
        ZStack {
            // 正面：题目与主动回忆倒逼思考
            ScrollView { frontView }
                .opacity(isFlipped ? 0 : 1)
                .rotation3DEffect(
                    .degrees(isFlipped ? 180 : 0),
                    axis: (x: 0, y: 1, z: 0),
                    perspective: 0.55
                )
                .allowsHitTesting(!isFlipped)

            // 背面：答案解析与记忆评级反馈
            backView
                .opacity(isFlipped ? 1 : 0)
                .rotation3DEffect(
                    .degrees(isFlipped ? 0 : -180),
                    axis: (x: 0, y: 1, z: 0),
                    perspective: 0.55
                )
                .allowsHitTesting(isFlipped)
        }
        .frame(width: 520, height: 490)
    }

    // MARK: - 正面视图（问题与思考）

    private var frontView: some View {
        VStack(alignment: .leading, spacing: 0) {
            // 顶栏徽章
            HStack(spacing: 8) {
                HStack(spacing: 5) {
                    Image(systemName: theme.iconName)
                        .font(.system(size: 11, weight: .bold))
                    Text(card.category)
                        .font(EditorialFont.badge)
                }
                .foregroundStyle(theme.accent)
                .padding(.horizontal, 10)
                .padding(.vertical, 4.5)
                .background(theme.accent.opacity(0.12), in: Capsule())
                .overlay(Capsule().strokeBorder(theme.accent.opacity(0.3), lineWidth: 1))

                HStack(spacing: 4) {
                    Image(systemName: "brain.head.profile")
                        .font(.system(size: 11, weight: .medium))
                    Text("主动回忆")
                        .font(EditorialFont.caption.weight(.semibold))
                }
                .foregroundStyle(EditorialColor.aiAmber)
                .padding(.horizontal, 9)
                .padding(.vertical, 4.5)
                .background(EditorialColor.aiAmberBg, in: Capsule())
                .overlay(Capsule().strokeBorder(EditorialColor.aiAmberBorder, lineWidth: 1))

                Spacer()

                masteryBadge
            }

            Spacer(minLength: 16)

            // 测验引导
            Text("QUESTION")
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .tracking(2.0)
                .foregroundStyle(EditorialColor.textTertiary)
                .padding(.bottom, 6)

            // 问题大标题
            Text(card.headline)
                .font(EditorialFont.heroHeadline)
                .foregroundStyle(EditorialColor.textPrimary)
                .lineSpacing(6)
                .fixedSize(horizontal: false, vertical: true)

            Rectangle()
                .fill(theme.accent)
                .frame(width: 42, height: 3.5)
                .cornerRadius(1.75)
                .padding(.top, 16)
                .padding(.bottom, 16)

            // 深度回忆指引
            VStack(alignment: .leading, spacing: 6) {
                Text("💭 尝试在脑海中组织语言：")
                    .font(EditorialFont.labelSmall)
                    .foregroundStyle(EditorialColor.textSecondary)
                Text("这个知识的核心机制、前因后果或关键结论是什么？组织好思路后，翻看背面核对。")
                    .font(EditorialFont.caption)
                    .foregroundStyle(EditorialColor.textMuted)
                    .lineSpacing(4)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(EditorialColor.glassBorder, lineWidth: 1)
            )

            Spacer(minLength: 16)

            // 翻转按钮
            Button(action: onFlip) {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.system(size: 14, weight: .bold))
                    Text("查看答案与解析")
                        .font(EditorialFont.label)
                    Spacer()
                    Text("␣ 空格 / ⏎")
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .opacity(0.8)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(Color.white.opacity(0.2), in: Capsule())
                }
                .foregroundStyle(Color.white)
                .padding(.horizontal, 18)
                .padding(.vertical, 13)
                .background(
                    LinearGradient(
                        colors: [theme.accent, theme.accent.opacity(0.85)],
                        startPoint: .leading,
                        endPoint: .trailing
                    ),
                    in: RoundedRectangle(cornerRadius: EditorialRadius.container, style: .continuous)
                )
                .shadow(color: theme.accent.opacity(0.35), radius: 8, y: 3)
            }
            .buttonStyle(PressableButtonStyle())
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: EditorialRadius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: EditorialRadius.card, style: .continuous)
                .strokeBorder(EditorialColor.glassBorder, lineWidth: 1.2)
        )
        .shadow(
            color: EditorialColor.dynamic(
                light: NSColor.black.withAlphaComponent(0.08),
                dark: NSColor.black.withAlphaComponent(0.45)
            ),
            radius: 16,
            y: 8
        )
    }

    // MARK: - 背面视图（答案与评级）

    private var backView: some View {
        VStack(alignment: .leading, spacing: 0) {
            // 顶栏：卡片原始小标题概览
            HStack(spacing: 8) {
                HStack(spacing: 5) {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 11, weight: .bold))
                    Text("答案解析")
                        .font(EditorialFont.badge)
                }
                .foregroundStyle(EditorialColor.likeGreen)
                .padding(.horizontal, 10)
                .padding(.vertical, 4.5)
                .background(EditorialColor.likeGreen.opacity(0.12), in: Capsule())
                .overlay(Capsule().strokeBorder(EditorialColor.likeGreen.opacity(0.3), lineWidth: 1))

                Text(card.category)
                    .font(EditorialFont.caption.weight(.semibold))
                    .foregroundStyle(EditorialColor.textTertiary)

                Spacer()

                Button(action: onFlip) {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.turn.up.left")
                            .font(.system(size: 11, weight: .semibold))
                        Text("回看题目")
                            .font(EditorialFont.captionSmall.weight(.semibold))
                    }
                    .foregroundStyle(EditorialColor.textTertiary)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4)
                    .background(EditorialColor.glassSurface, in: Capsule())
                    .overlay(Capsule().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                }
                .buttonStyle(PressableButtonStyle())
                .help("翻回题目正面 (空格键)")
            }

            // 题目微缩标题
            Text(card.headline)
                .font(.system(size: 14.5, weight: .bold))
                .foregroundStyle(EditorialColor.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 10)
                .padding(.bottom, 12)

            // 核心观点引用块
            VStack(alignment: .leading, spacing: 4) {
                Text("核心要点")
                    .font(.system(size: 10.5, weight: .bold, design: .monospaced))
                    .tracking(1.0)
                    .foregroundStyle(EditorialColor.aiAmber)
                Text(card.summary)
                    .font(EditorialFont.summarySerif)
                    .foregroundStyle(EditorialColor.textPrimary)
                    .lineSpacing(5)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(EditorialColor.aiAmberBg, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(EditorialColor.aiAmberBorder, lineWidth: 1)
            )

            // 深入解读正文
            ScrollView(.vertical, showsIndicators: true) {
                Text(card.details)
                    .font(EditorialFont.bodySerif)
                    .foregroundStyle(EditorialColor.textSecondary)
                    .lineSpacing(6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 10)
            }
            .frame(maxHeight: .infinity)

            Divider()
                .overlay(EditorialColor.glassDivider)
                .padding(.vertical, 10)

            // 底部自评按键提示区
            VStack(spacing: 8) {
                Text("回忆难度评级（艾宾浩斯间隔记忆）")
                    .font(EditorialFont.captionSmall)
                    .foregroundStyle(EditorialColor.textTertiary)

                HStack(spacing: 12) {
                    ratingButton(
                        rating: .forgot,
                        tint: EditorialColor.dislikeRed,
                        shortcut: "⌘1"
                    )

                    ratingButton(
                        rating: .hesitant,
                        tint: EditorialColor.aiAmber,
                        shortcut: "⌘2"
                    )

                    ratingButton(
                        rating: .mastered,
                        tint: EditorialColor.likeGreen,
                        shortcut: "⌘3"
                    )
                }
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: EditorialRadius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: EditorialRadius.card, style: .continuous)
                .strokeBorder(EditorialColor.glassBorder, lineWidth: 1.2)
        )
        .shadow(
            color: EditorialColor.dynamic(
                light: NSColor.black.withAlphaComponent(0.08),
                dark: NSColor.black.withAlphaComponent(0.45)
            ),
            radius: 16,
            y: 8
        )
    }

    // MARK: - 辅助组件

    private var masteryBadge: some View {
        Group {
            if card.masteryLevel == 2 {
                Label("已掌握", systemImage: "checkmark.circle.fill")
                    .font(EditorialFont.captionSmall.weight(.bold))
                    .foregroundStyle(EditorialColor.likeGreen)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3.5)
                    .background(EditorialColor.likeGreen.opacity(0.12), in: Capsule())
            } else if card.masteryLevel == 1 {
                Label("学习中", systemImage: "arrow.triangle.2.circlepath")
                    .font(EditorialFont.captionSmall.weight(.bold))
                    .foregroundStyle(EditorialColor.aiAmber)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3.5)
                    .background(EditorialColor.aiAmberBg, in: Capsule())
            } else {
                Text("待强化")
                    .font(EditorialFont.captionSmall.weight(.semibold))
                    .foregroundStyle(EditorialColor.textMuted)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3.5)
                    .background(EditorialColor.glassSurface, in: Capsule())
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
            VStack(spacing: 4) {
                HStack(spacing: 5) {
                    Image(systemName: rating.icon)
                        .font(.system(size: 13, weight: .bold))
                    Text(rating.title)
                        .font(EditorialFont.label)
                }
                .foregroundStyle(tint)

                Text(shortcut)
                    .font(.system(size: 10.5, weight: .bold, design: .monospaced))
                    .foregroundStyle(EditorialColor.textMuted)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(tint.opacity(0.32), lineWidth: 1.2)
            )
        }
        .buttonStyle(PressableButtonStyle())
        .help("\(rating.title) (\(shortcut))")
    }

    private var cardBackground: some View {
        ZStack {
            EditorialColor.dynamic(
                light: NSColor(white: 0.985, alpha: 1.0),
                dark: NSColor(red: 0.11, green: 0.12, blue: 0.14, alpha: 1.0)
            )

            // 微弱漫反射底色
            RadialGradient(
                colors: [theme.accent.opacity(0.08), .clear],
                center: .topTrailing,
                startRadius: 20,
                endRadius: 400
            )

            NoiseOverlay().opacity(0.3)
        }
    }
}
