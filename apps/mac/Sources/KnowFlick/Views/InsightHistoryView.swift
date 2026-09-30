import SwiftUI
import KnowFlickCore

// 历史内容区（自 InsightPlaceholderViews.swift 拆出）。

// MARK: - 历史

struct InsightHistoryPlaceholder: View {
    @Bindable var store: AppStore
    var onOpenSheet: (ActiveSheet) -> Void

    var body: some View {
        InsightContentScaffold(
            title: "历史",
            subtitle: "刷过的卡片按时间倒序"
        ) {
            Group {
                if store.history.isEmpty {
                    InsightEmptyState(icon: "clock", title: "还没有记录", message: "刷过的卡片会出现在这里。")
                } else {
                    ScrollView {
                        LazyVStack(spacing: InsightSpacing.tiny) {
                            ForEach(Array(store.history.prefix(80).enumerated()), id: \.element.id) { index, card in
                                InsightListRow(card: card, trailing: relativeTime(card.seenAt ?? card.createdAt)) {
                                    onOpenSheet(.detail(card))
                                }
                                .modifier(InsightStaggerReveal(index: index))
                            }
                        }
                        .padding(.horizontal, InsightLayout.contentPadding)
                        .padding(.bottom, InsightSpacing.large)
                    }
                }
            }
        }
    }

    /// 相对时间格式化器（静态单例）：原实现每行都新建一个 RelativeDateTimeFormatter，
    /// 80 行列表就是 80 次格式化器构造
    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter
    }()

    private func relativeTime(_ date: Date) -> String {
        Self.relativeFormatter.localizedString(for: date, relativeTo: Date())
    }
}
