import SwiftUI
import KnowFlickCore

/// 学习地图：学科 → 分支 → 难度 三级选择器，回答「我现在学什么」。
///
/// 两种用法都支持（与 Android `LearningMapScreen` 同一产品口径）：
/// - **专学**：只刷这一条支线，按导入顺序一级一级往前推（`sequential = true`）；
/// - **混合**：把多个分支/难度加进同一个卡堆混着刷（`sequential = false`）。
///
/// 范围只在本次会话内生效，重启自动回到全景。
struct LearningMapView: View {
    @Bindable var store: AppStore
    /// 应用「专学」后直接进刷卡；混合模式留在地图继续勾选
    let onEnterDeck: () -> Void

    /// 是否处于第二层（分支列表）；`slug == nil` 表示「未分级」片，也支持钻取
    @State private var isSubjectOpen = false
    @State private var openedSubject: String? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var scope: StudyScope { store.studyScope }
    private var cards: [KnowledgeCard] { store.cards }

    /// 学科 → 分支的层级切换转场：小幅横移表达「钻入/钻出」，reduce-motion 退化为淡入淡出
    private var levelTransition: AnyTransition {
        reduceMotion ? .opacity : .asymmetric(
            insertion: .offset(x: 24).combined(with: .opacity),
            removal: .opacity
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: InsightSpacing.compact) {
                    if isSubjectOpen {
                        branchSection
                            .transition(levelTransition)
                    } else {
                        if scope.isActive {
                            scopeSummaryBar
                                .transition(.opacity)
                        }
                        subjectRows
                            .transition(levelTransition)
                    }
                }
                .padding(.horizontal, InsightLayout.contentPadding)
                .padding(.bottom, InsightSpacing.xl)
                .frame(maxWidth: 1200, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: 顶栏（与刷卡视图同款：标题 + 描述 + 右侧操作）

    private var topBar: some View {
        HStack(alignment: .firstTextBaseline, spacing: InsightSpacing.medium) {
            VStack(alignment: .leading, spacing: InsightSpacing.hair) {
                Text("学习地图")
                    .font(InsightFont.title)
                    .foregroundStyle(InsightColor.textPrimary)
                Text(subtitleText)
                    .font(InsightFont.callout)
                    .foregroundStyle(InsightColor.textTertiary)
            }
            Spacer(minLength: InsightSpacing.large)
            if scope.isActive {
                InsightButton(title: "退出范围", icon: "xmark.circle", style: .secondary) {
                    withAnimation(InsightMotion.shell) {
                        store.studyScope = .none
                        isSubjectOpen = false
                        openedSubject = nil
                    }
                }
            }
            if isSubjectOpen {
                InsightButton(title: "返回学科列表", icon: "chevron.left", style: .secondary) {
                    // 返回也要在动画上下文里（此前只有钻入有动画，退出是硬切）
                    withAnimation(reduceMotion ? nil : InsightMotion.shell) {
                        isSubjectOpen = false
                        openedSubject = nil
                    }
                }
            }
        }
        .foregroundStyle(InsightColor.textPrimary)
        .padding(.horizontal, InsightLayout.contentPadding)
        .padding(.top, InsightSpacing.large)
        .padding(.bottom, InsightSpacing.compact)
    }

    private var subtitleText: String {
        if scope.isActive {
            let remaining = StudyMap.remaining(cards, scope: scope)
            return "当前范围：\(scope.describe()) · 还剩 \(remaining) 张"
        }
        return "\(cards.count) 张卡 · 未限定范围"
    }

    // MARK: 范围摘要条：只在有范围时出现，给一个显式的"回到全景"出口

    private var scopeSummaryBar: some View {
        HStack(spacing: InsightSpacing.compact) {
            Image(systemName: "scope")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(InsightColor.accent)
            VStack(alignment: .leading, spacing: InsightSpacing.hair) {
                Text("正在限定范围学习")
                    .font(InsightFont.caption)
                    .foregroundStyle(InsightColor.accent)
                Text(scope.describe())
                    .font(InsightFont.callout)
                    .foregroundStyle(InsightColor.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, InsightSpacing.default)
        .padding(.vertical, 10)
        .background(InsightColor.accentSoft, in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
            .strokeBorder(InsightColor.accent.opacity(0.3), lineWidth: 1))
        .padding(.vertical, InsightSpacing.small)
    }

    // MARK: 第一层：学科行

    @ViewBuilder
    private var subjectRows: some View {
        let progress = StudyMap.subjectProgress(cards)
        if progress.isEmpty {
            Text("卡库还是空的，先去生成或导入一些卡片")
                .font(InsightFont.body)
                .foregroundStyle(InsightColor.textTertiary)
                .padding(.top, InsightSpacing.large)
        }
        ForEach(progress) { row in
            Button {
                withAnimation(reduceMotion ? nil : InsightMotion.shell) {
                    openedSubject = row.slug
                    isSubjectOpen = true
                }
            } label: {
                mapRow(row)
            }
            .buttonStyle(PressableButtonStyle(scale: 0.99, playAudio: false))
        }
    }

    private func mapRow(_ row: SubjectProgress) -> some View {
        InsightCard(isInteractive: true) {
            VStack(alignment: .leading, spacing: InsightSpacing.small) {
                Text(row.name)
                    .font(InsightFont.headline)
                    .foregroundStyle(InsightColor.textPrimary)
                Text("\(row.total) 张 · 已看 \(row.seen) · 已掌握 \(row.mastered) · \(row.branchCount) 条支线")
                    .font(InsightFont.caption)
                    .foregroundStyle(InsightColor.textTertiary)
                progressBar(ratio: row.total > 0 ? Double(row.seen) / Double(row.total) : 0)
            }
        }
    }

    // MARK: 第二层：分支卡（专学 / 加入混合）+ 难度阶梯

    @ViewBuilder
    private var branchSection: some View {
        let subject = openedSubject
        let branches = StudyMap.branchProgress(cards, subject: subject)
        Text(SubjectRegistry.displayName(subject: subject))
            .font(InsightFont.callout)
            .foregroundStyle(InsightColor.textTertiary)
            .padding(.top, InsightSpacing.small)

        ForEach(branches) { branch in
            branchCard(branch, subject: subject)
        }

        levelLadder(branches: branches, subject: subject)
    }

    private func branchCard(_ branch: BranchProgress, subject: String?) -> some View {
        let selected = scope.branches.contains(branch.key)
        return InsightCard(isSelected: selected, isInteractive: true) {
            VStack(alignment: .leading, spacing: InsightSpacing.small) {
                HStack(alignment: .firstTextBaseline) {
                    Text(branch.name)
                        .font(InsightFont.bodyStrong)
                        .foregroundStyle(InsightColor.textPrimary)
                    Spacer(minLength: InsightSpacing.compact)
                    if selected {
                        Text("已在范围")
                            .font(InsightFont.captionSmall.weight(.bold))
                            .foregroundStyle(InsightColor.accent)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(InsightColor.accent.opacity(0.14), in: Capsule())
                    }
                }
                Text("\(branch.total) 张 · 已看 \(branch.seen) · 已掌握 \(branch.mastered)" +
                     (branch.nextLevel.map { " · 下一步 \(SubjectRegistry.levelName($0))" } ?? ""))
                    .font(InsightFont.caption)
                    .foregroundStyle(InsightColor.textTertiary)
                progressBar(ratio: branch.total > 0 ? Double(branch.seen) / Double(branch.total) : 0)
                HStack(spacing: InsightSpacing.small) {
                    InsightButton(title: "专学这条支线", icon: "arrow.right.circle", style: .primary) {
                        withAnimation(InsightMotion.shell) {
                            store.studyScope = StudyScope(
                                subjects: subject.map { [$0] } ?? [],
                                branches: [branch.key],
                                sequential: true
                            )
                        }
                        onEnterDeck()
                    }
                    InsightButton(title: selected ? "移出混合" : "加入混合", icon: "plus.circle", style: .secondary) {
                        withAnimation(InsightMotion.shell) {
                            store.studyScope = toggleMix(branch: branch, subject: subject)
                        }
                    }
                }
                .padding(.top, InsightSpacing.hair)
            }
        }
    }

    /// 「加入混合」：把分支并进当前范围并退出顺序模式；再点一次移出。
    /// 首次从空范围加入时带上所属学科，避免范围只剩复合键却丢了学科锚点。
    private func toggleMix(branch: BranchProgress, subject: String?) -> StudyScope {
        if scope.branches.contains(branch.key) {
            var next = scope
            next.branches.remove(branch.key)
            next.sequential = false
            if next.branches.isEmpty && next.levels.isEmpty { next.subjects = [] }
            return next
        }
        var next = scope
        if !next.subjects.isEmpty, let subject {
            next.subjects.insert(subject)
        }
        next.branches.insert(branch.key)
        next.sequential = false
        return next
    }

    /// 难度阶梯：整学科按难度选（英语 L1→L5 一点点看的入口）
    @ViewBuilder
    private func levelLadder(branches: [BranchProgress], subject: String?) -> some View {
        let merged = mergedLevels(branches)
        if !merged.isEmpty {
            VStack(alignment: .leading, spacing: InsightSpacing.small) {
                Text("按难度选")
                    .font(InsightFont.bodyStrong)
                    .foregroundStyle(InsightColor.textPrimary)
                Text("点一下加进范围，再点取消；只选难度时自动按顺序推进")
                    .font(InsightFont.captionSmall)
                    .foregroundStyle(InsightColor.textMuted)
                HStack(spacing: InsightSpacing.small) {
                    ForEach(merged.keys.sorted(), id: \.self) { level in
                        let cell = merged[level]!
                        levelChip(level: level, total: cell.total, seen: cell.seen, subject: subject)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(InsightSpacing.default)
            .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous)
                .strokeBorder(InsightColor.border, lineWidth: 1))
        }
    }

    private func mergedLevels(_ branches: [BranchProgress]) -> [Int: (total: Int, seen: Int)] {
        var merged: [Int: (total: Int, seen: Int)] = [:]
        for branch in branches {
            for level in branch.levels {
                guard let cell = level.level else { continue }
                let bucket = merged[cell] ?? (0, 0)
                merged[cell] = (bucket.total + level.total, bucket.seen + level.seen)
            }
        }
        return merged
    }

    private func levelChip(level: Int, total: Int, seen: Int, subject: String?) -> some View {
        let selected = scope.levels.contains(level)
        return Button {
            withAnimation(reduceMotion ? nil : InsightMotion.shell) {
                store.studyScope = toggleLevel(level, subject: subject)
            }
        } label: {
            Text("\(SubjectRegistry.levelName(level)) \(seen)/\(total)")
                .font(InsightFont.caption)
                .fontWeight(selected ? .semibold : .regular)
                .foregroundStyle(selected ? Color.white : InsightColor.textSecondary)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(selected ? InsightColor.accent : Color.clear, in: Capsule())
                .overlay(Capsule().strokeBorder(selected ? InsightColor.accent : InsightColor.border, lineWidth: 1))
                .contentShape(Capsule())
                .animation(reduceMotion ? nil : InsightMotion.tactile, value: selected)
        }
        .buttonStyle(PressableButtonStyle(scale: 0.94, playAudio: false))
    }

    /// 「按难度选」：切换难度档；只选难度（没有分支）时自动顺序推进，与 Android 同口径
    private func toggleLevel(_ level: Int, subject: String?) -> StudyScope {
        var next = scope
        if next.levels.contains(level) {
            next.levels.remove(level)
        } else {
            // 首次从空范围选难度时带上所属学科，避免范围只剩难度却丢了学科锚点
            if next.subjects.isEmpty, let subject {
                next.subjects = [subject]
            }
            next.levels.insert(level)
        }
        next.sequential = !next.levels.isEmpty && next.branches.isEmpty
        if next.levels.isEmpty && next.branches.isEmpty {
            next.subjects = []
            next.sequential = false
        }
        return next
    }

    // MARK: 发丝边进度条（与统计中心的扁平口径一致）

    private func progressBar(ratio: Double) -> some View {
        InsightProgressBar(value: max(0, min(1, ratio)), tint: InsightColor.accent, height: 4)
    }
}
