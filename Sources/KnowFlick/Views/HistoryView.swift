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
            EditorialColor.canvasGradient
                .ignoresSafeArea()
            NoiseOverlay().ignoresSafeArea()

            VStack(spacing: 0) {
                // 头部
                HStack(spacing: 16) {
                    Button(action: onClose) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(EditorialColor.textPrimary)
                            .frame(width: 32, height: 32)
                            .background(EditorialColor.glassSurface, in: Circle())
                            .overlay(Circle().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                    }
                    .buttonStyle(PressableButtonStyle())
                    .keyboardShortcut(.escape, modifiers: [])

                    HStack(spacing: 8) {
                        Image(systemName: "clock.arrow.circlepath")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(EditorialColor.textSecondary)
                        Text("历史足迹")
                            .font(EditorialFont.modalTitle)
                            .foregroundStyle(EditorialColor.textPrimary)
                    }

                    if let cat = categoryFilter {
                        Text(cat)
                            .font(EditorialFont.caption.weight(.semibold))
                            .foregroundStyle(CategoryTheme.theme(for: cat, cache: .shared).accent)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(EditorialColor.glassSurface, in: Capsule())
                            .overlay(Capsule().strokeBorder(CategoryTheme.theme(for: cat, cache: .shared).accent.opacity(0.4), lineWidth: 1))
                    }

                    Spacer()

                    Picker("筛选", selection: $filter) {
                        Text("全部").tag(Optional<SwipeDirection>.none)
                        Text("感兴趣").tag(Optional<SwipeDirection>.some(.right))
                        Text("不喜欢").tag(Optional<SwipeDirection>.some(.left))
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 240)

                    Button {
                        showConfirmClear = true
                    } label: {
                        Label("清空", systemImage: "trash")
                            .font(EditorialFont.labelSmall)
                            .foregroundStyle(store.history.isEmpty ? EditorialColor.textMuted : EditorialColor.dislikeRed.opacity(0.85))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    .buttonStyle(PressableButtonStyle())
                    .disabled(store.history.isEmpty)
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 18)

                Divider().overlay(EditorialColor.glassDivider)

                // 列表
                if items.isEmpty {
                    Spacer()
                    VStack(spacing: 14) {
                        Image(systemName: "clock")
                            .font(.system(size: 42))
                            .foregroundStyle(EditorialColor.textMuted)
                        Text(store.history.isEmpty ? "还没有刷过卡片" : "该筛选下暂无记录")
                            .font(EditorialFont.bodySerif)
                            .foregroundStyle(EditorialColor.textTertiary)
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
                onSwipe: { direction in
                    store.swipe(card, direction: direction)
                    if let next = nextHistoryCard(after: card) { selectedCard = next } else { selectedCard = nil }
                },
                onToggleFavorite: {
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
        let catAccent = CategoryTheme.theme(for: card, cache: .shared).accent
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
                        .font(EditorialFont.label)
                        .foregroundStyle(EditorialColor.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 8) {
                        Text(card.category)
                            .font(EditorialFont.captionSmall.weight(.semibold))
                            .foregroundStyle(catAccent)
                        dot
                        Text(card.seenAt?.formatted(date: .abbreviated, time: .shortened) ?? "")
                            .font(EditorialFont.captionSmall)
                            .foregroundStyle(EditorialColor.textTertiary)
                        if card.source == .ai {
                            if showAIMark {
                                dot
                                Text("AI")
                                    .font(EditorialFont.captionSmall.weight(.bold))
                                    .foregroundStyle(EditorialColor.aiAmber)
                            }
                        } else {
                            dot
                            Text("精选")
                                .font(EditorialFont.captionSmall)
                                .foregroundStyle(EditorialColor.textMuted)
                        }
                    }
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(EditorialColor.textMuted)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .editorialGlassCard(cornerRadius: EditorialRadius.control)
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
            ("heart.fill", EditorialColor.likeGreen)
        case .left:
            ("xmark", EditorialColor.dislikeRed)
        case .skip, nil:
            ("forward.fill", EditorialColor.skipGray)
        }
    }

    private var dot: some View {
        Circle().fill(EditorialColor.glassDivider.opacity(0.8)).frame(width: 3, height: 3)
    }
}
