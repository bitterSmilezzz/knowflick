import SwiftUI
import KnowFlickCore

/// 历史记录：看过的卡片列表，支持筛选与回看
struct HistoryView: View {
    let store: AppStore
    let showAIMark: Bool   // 设置：显示 AI 内容标记
    var categoryFilter: String? = nil   // 非nil=只看该分类（从统计页跳转进来）
    let onClose: () -> Void

    @State private var filter: SwipeDirection? = nil
    @State private var selectedCard: KnowledgeCard? = nil
    @State private var sharePosterCard: KnowledgeCard? = nil
    @State private var showConfirmClear = false

    private var items: [KnowledgeCard] {
        store.history.filter { card in
            (filter == nil || card.swiped == filter)
                && (categoryFilter == nil || card.category == categoryFilter)
        }
    }

    var body: some View {
        ZStack {
            InsightColor.canvas
                .ignoresSafeArea()
            NoiseOverlay().ignoresSafeArea()

            VStack(spacing: 0) {
                // 头部
                HStack(spacing: 16) {
                    // Esc 所有权跟随最上层：详情浮层打开时先收起详情，再退回卡堆
                    GlassIconButton(icon: "chevron.left", help: "返回 (Esc)") {
                        if selectedCard != nil {
                            selectedCard = nil
                        } else {
                            onClose()
                        }
                    }
                    .keyboardShortcut(.escape, modifiers: [])

                    HStack(spacing: 8) {
                        Image(systemName: "clock.arrow.circlepath")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(InsightColor.textSecondary)
                        Text("历史足迹")
                            .font(InsightFont.title)
                            .foregroundStyle(InsightColor.textPrimary)
                    }

                    if let cat = categoryFilter {
                        let catAccent = CategoryTheme.visualSpec(for: cat).accent
                        Text(cat)
                            .font(InsightFont.caption.weight(.semibold))
                            .foregroundStyle(catAccent)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(InsightColor.surface, in: Capsule())
                            .overlay(Capsule().strokeBorder(catAccent.opacity(0.4), lineWidth: 1))
                    }

                    Spacer()

                    InsightSegmented(
                        items: ["全部", "感兴趣", "不喜欢"],
                        selection: Binding(
                            get: {
                                switch filter {
                                case .none: return "全部"
                                case .right: return "感兴趣"
                                case .left, .skip: return "不喜欢"
                                @unknown default: return "全部"
                                }
                            },
                            set: { newValue in
                                withAnimation(InsightMotion.pill) {
                                    filter = switch newValue {
                                    case "全部": Optional<SwipeDirection>.none
                                    case "感兴趣": Optional<SwipeDirection>.some(.right)
                                    default: Optional<SwipeDirection>.some(.left)
                                    }
                                }
                            }
                        )
                    )

                    Button {
                        showConfirmClear = true
                    } label: {
                        Label("清空", systemImage: "trash")
                            .font(InsightFont.callout)
                            .foregroundStyle(store.history.isEmpty ? InsightColor.textMuted : InsightColor.danger.opacity(0.85))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    .buttonStyle(PressableButtonStyle())
                    .disabled(store.history.isEmpty)
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 18)

                Divider().overlay(InsightColor.divider)

                // 列表
                if items.isEmpty {
                    Spacer()
                    VStack(spacing: 14) {
                        Image(systemName: "clock")
                            .font(.system(size: 42))
                            .foregroundStyle(InsightColor.textMuted)
                        Text(store.history.isEmpty ? "还没有刷过卡片" : "该筛选下暂无记录")
                            .font(InsightFont.body)
                            .foregroundStyle(InsightColor.textTertiary)
                    }
                    Spacer()
                } else {
                    ScrollView {
                        LazyVStack(spacing: 10) {
                            ForEach(items) { card in
                                historyRow(card)
                            }
                        }
                        .padding(24)
                    }
                }
            }
        }
        .sheet(item: $selectedCard) { card in
            DetailView(
                card: card,
                store: store,
                showAIMark: showAIMark,
                hasPrevious: false,
                hasNext: nextHistoryCard(after: card) != nil,
                // 历史页改标签：swiped 是真实的喜好意图，与收藏（isFavorite）解耦。
                // 依赖：AppStore.swipe 对已有 seenAt 的卡片保留原时间（AppStore.swift:224-233），
                // 因此这里打标签不会再重写 seenAt、把卡片顶到时间线顶部；统计口径保持稳定。
                onSwipe: { direction in
                    store.swipe(card, direction: direction)
                    if let next = nextHistoryCard(after: card) { selectedCard = next } else { selectedCard = nil }
                },
                onToggleFavorite: {
                    // 收藏状态读 isFavorite 字段（与 swiped 解耦），不再用 swiped == .right 判断。
                    store.toggleFavorite(card)
                },
                onNext: {
                    if let next = nextHistoryCard(after: card) { selectedCard = next }
                },
                onPrevious: {},
                onClose: { selectedCard = nil },
                relatedCards: store.getRelatedCards(for: card),
                onSelectCard: { target in
                    selectedCard = target
                }
            )
        }
        .alert("清空历史记录？", isPresented: $showConfirmClear) {
            Button("清空", role: .destructive) {
                withAnimation { store.clearHistory() }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("所有卡片会回到待刷队列，此操作不可撤销。")
        }
        .overlay {
            if let pc = sharePosterCard {
                CardPosterExportSheet(card: pc) {
                    sharePosterCard = nil
                }
                .transition(.opacity.combined(with: .scale(scale: 0.98)))
            }
        }
        .frame(minWidth: 700, minHeight: 520)
    }

    private func historyRow(_ card: KnowledgeCard) -> some View {
        let mark = directionMark(card.swiped)
        let catAccent = CategoryTheme.visualSpec(for: card).accent
        return Button {
            selectedCard = card
        } label: {
            HStack(spacing: 14) {
                Image(systemName: mark.icon)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(mark.color)
                    .frame(width: 36, height: 36)
                    .background(mark.color.opacity(0.14), in: Circle())
                    .overlay(Circle().strokeBorder(mark.color.opacity(0.3), lineWidth: 1))

                VStack(alignment: .leading, spacing: 5) {
                    Text(card.headline)
                        .font(InsightFont.bodyStrong)
                        .foregroundStyle(InsightColor.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 8) {
                        Text(card.category)
                            .font(InsightFont.captionSmall.weight(.semibold))
                            .foregroundStyle(catAccent)
                        dot
                        Text(card.seenAt?.formatted(date: .abbreviated, time: .shortened) ?? "")
                            .font(InsightFont.captionSmall)
                            .foregroundStyle(InsightColor.textTertiary)
                        if card.source == .ai {
                            if showAIMark {
                                dot
                                Text("AI")
                                    .font(InsightFont.captionSmall.weight(.bold))
                                    .foregroundStyle(InsightColor.warning)
                            }
                        } else {
                            dot
                            // 三态来源：AI / 导入 / 预置精选。此前把导入笔记也标成「精选」，
                            // 与 DetailView、CardView 的「导入笔记」标注不一致。
                            Text(card.source == .imported ? "导入笔记" : "精选")
                                .font(InsightFont.captionSmall)
                                .foregroundStyle(InsightColor.textMuted)
                        }
                    }
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(InsightColor.textMuted)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .editorialGlassCard(cornerRadius: InsightRadius.control)
        }
        .buttonStyle(PressableButtonStyle(scale: 0.99))
        .contextMenu {
            Button {
                sharePosterCard = card
            } label: {
                Label("导出分享海报...", systemImage: "square.and.arrow.up")
            }
            Button {
                selectedCard = card
            } label: {
                Label("查看详情", systemImage: "arrow.up.left.and.arrow.down.right")
            }
        }
    }

    /// 当前筛选下位于 card 之后的下一条记录；若 card 已被筛选移出（如筛选「感兴趣」时点了「不喜欢」），从列表头继续
    private func nextHistoryCard(after card: KnowledgeCard) -> KnowledgeCard? {
        guard let idx = items.firstIndex(where: { $0.id == card.id }) else {
            return items.first
        }
        return idx + 1 < items.count ? items[idx + 1] : nil
    }

    /// 方向标记：右划=心形绿，左划=叉红，跳过/无意图=前进灰
    private func directionMark(_ swiped: SwipeDirection?) -> (icon: String, color: Color) {
        switch swiped {
        case .right:
            ("heart.fill", InsightColor.success)
        case .left:
            ("xmark", InsightColor.danger)
        case .skip, nil:
            ("forward.fill", InsightColor.neutral)
        }
    }

    private var dot: some View {
        Circle().fill(InsightColor.divider.opacity(0.8)).frame(width: 3, height: 3)
    }
}
