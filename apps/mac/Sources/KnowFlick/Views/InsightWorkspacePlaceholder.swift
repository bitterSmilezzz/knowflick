import SwiftUI
import KnowFlickCore

// 今日 / 复习 / 知识库内容区（自 InsightPlaceholderViews.swift 拆出）。

// MARK: - 今日 / 复习 / 知识库

struct InsightWorkspacePlaceholder: View {
    let destination: InsightDestination
    @Bindable var store: AppStore
    var onOpenSheet: (ActiveSheet) -> Void

    var body: some View {
        InsightContentScaffold(
            title: destination.rawValue,
            subtitle: subtitle
        ) {
            ScrollView {
                VStack(alignment: .leading, spacing: InsightSpacing.large) {
                    statRow
                    cardSection
                }
                .padding(.horizontal, InsightLayout.contentPadding)
                .padding(.bottom, InsightSpacing.large)
            }
        }
    }

    private var subtitle: String {
        switch destination {
        case .today: return "今日待刷与学习目标"
        case .review: return "按记忆排程到期的卡片"
        case .library: return "按主题浏览全部 \(store.cards.count) 张卡片"
        default: return ""
        }
    }

    /// Cutline 的统计块行（大数字 + 进度）
    private var statRow: some View {
        HStack(spacing: InsightSpacing.compact) {
            InsightCard(padding: InsightSpacing.default) {
                InsightStatBlock(
                    value: "\(store.deck.count)",
                    label: "待刷卡片",
                    tone: .accent
                )
            }
            InsightCard(padding: InsightSpacing.default) {
                InsightStatBlock(
                    value: "\(store.history.count)",
                    label: "已刷卡片",
                    tone: .success
                )
            }
            InsightCard(padding: InsightSpacing.default) {
                InsightStatBlock(
                    value: "\(store.favorites.count)",
                    label: "收藏卡片",
                    tone: .warning
                )
            }
        }
    }

    @ViewBuilder
    private var cardSection: some View {
        let cards = previewCards
        if cards.isEmpty {
            InsightEmptyState(
                icon: "tray",
                title: "暂无内容",
                message: "换一批新知识，或从其他视图开始探索。"
            )
        } else {
            VStack(alignment: .leading, spacing: InsightSpacing.default) {
                InsightSectionLabel(text: "推荐", trailing: "\(cards.count)")
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: InsightLayout.gridMinColumn), spacing: InsightSpacing.compact)],
                    spacing: InsightSpacing.compact
                ) {
                    ForEach(cards) { card in
                        InsightCardTile(card: card) {
                            onOpenSheet(.detail(card))
                        }
                    }
                }
            }
        }
    }

    private var previewCards: [KnowledgeCard] {
        switch destination {
        case .review:
            return Array(store.cards.filter { $0.seenAt != nil }.prefix(8))
        default:
            return Array(store.cards.prefix(8))
        }
    }
}
