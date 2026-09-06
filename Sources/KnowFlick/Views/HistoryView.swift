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
    @State private var showConfirmClear = false

    private var items: [KnowledgeCard] {
        store.history.filter { card in
            (filter == nil || card.swiped == filter)
                && (categoryFilter == nil || card.category == categoryFilter)
        }
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color(red: 0.085, green: 0.095, blue: 0.12), Color(red: 0.045, green: 0.05, blue: 0.065)],
                startPoint: .top, endPoint: .bottom
            )
            .ignoresSafeArea()
            NoiseOverlay().ignoresSafeArea()

            VStack(spacing: 0) {
                // 头部
                HStack(spacing: 16) {
                    Button(action: onClose) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(.white.opacity(0.8))
                            .frame(width: 30, height: 30)
                            .background(Color.white.opacity(0.07), in: Circle())
                            .overlay(Circle().strokeBorder(Color.white.opacity(0.1), lineWidth: 1))
                    }
                    .buttonStyle(PressableButtonStyle())
                    .keyboardShortcut(.escape, modifiers: [])

                    Text("历史记录")
                        .font(.custom("Songti SC Black", size: 20))
                        .foregroundStyle(Color(red: 0.96, green: 0.95, blue: 0.92))

                    if let cat = categoryFilter {
                        Text(cat)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(CategoryTheme.theme(for: cat, cache: .shared).accent)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(Color.white.opacity(0.07), in: Capsule())
                            .overlay(Capsule().strokeBorder(Color.white.opacity(0.1), lineWidth: 1))
                    }

                    Spacer()

                    Picker("筛选", selection: $filter) {
                        Text("全部").tag(Optional<SwipeDirection>.none)
                        Text("感兴趣").tag(Optional<SwipeDirection>.some(.right))
                        Text("不喜欢").tag(Optional<SwipeDirection>.some(.left))
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 250)

                    Button {
                        showConfirmClear = true
                    } label: {
                        Label("清空", systemImage: "trash")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(.white.opacity(0.6))
                    }
                    .buttonStyle(PressableButtonStyle())
                    .disabled(store.history.isEmpty)
                }
                .padding(.horizontal, 22)
                .padding(.vertical, 18)

                Divider().overlay(Color.white.opacity(0.08))

                // 列表
                if items.isEmpty {
                    Spacer()
                    VStack(spacing: 12) {
                        Image(systemName: "clock")
                            .font(.system(size: 38))
                            .foregroundStyle(.white.opacity(0.3))
                        Text(store.history.isEmpty ? "还没有刷过卡片" : "该筛选下暂无记录")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(.white.opacity(0.5))
                    }
                    Spacer()
                } else {
                    ScrollView {
                        LazyVStack(spacing: 8) {
                            ForEach(items) { card in
                                historyRow(card)
                            }
                        }
                        .padding(20)
                    }
                }
            }
        }
        .sheet(item: $selectedCard) { card in
            DetailView(
                card: card,
                showAIMark: showAIMark,
                hasPrevious: false,
                hasNext: nextHistoryCard(after: card) != nil,
                onSwipe: { direction in
                    store.swipe(card, direction: direction)
                    if let next = nextHistoryCard(after: card) { selectedCard = next } else { selectedCard = nil }
                },
                onNext: {
                    if let next = nextHistoryCard(after: card) { selectedCard = next }
                },
                onPrevious: {},
                onClose: { selectedCard = nil }
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
        .preferredColorScheme(.dark)
        .frame(minWidth: 680, minHeight: 480)
    }

    private func historyRow(_ card: KnowledgeCard) -> some View {
        let mark = directionMark(card.swiped)
        return Button {
            selectedCard = card
        } label: {
            HStack(spacing: 14) {
                Image(systemName: mark.icon)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(mark.color)
                    .frame(width: 32, height: 32)
                    .background(Color.white.opacity(0.06), in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text(card.headline)
                        .font(.system(size: 14.5, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.92))
                        .lineLimit(1)
                    HStack(spacing: 7) {
                        Text(card.category)
                            .font(.system(size: 11.5))
                            .foregroundStyle(.white.opacity(0.5))
                        dot
                        Text(card.seenAt?.formatted(date: .abbreviated, time: .shortened) ?? "")
                            .font(.system(size: 11.5))
                            .foregroundStyle(.white.opacity(0.4))
                        if card.source == .ai {
                            if showAIMark {
                                dot
                                Text("AI")
                                    .font(.system(size: 11.5, weight: .medium))
                                    .foregroundStyle(.orange.opacity(0.75))
                            }
                        } else {
                            dot
                            Text("预置")
                                .font(.system(size: 11.5, weight: .medium))
                                .foregroundStyle(.white.opacity(0.45))
                        }
                    }
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.25))
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 11)
            .background(Color.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.06), lineWidth: 1)
            )
        }
        .buttonStyle(PressableButtonStyle(scale: 0.99))
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
            ("heart.fill", Color(red: 0.45, green: 0.80, blue: 0.55))
        case .left:
            ("xmark", Color(red: 0.92, green: 0.48, blue: 0.45))
        case .skip, nil:
            ("forward.fill", Color.white.opacity(0.35))
        }
    }

    private var dot: some View {
        Circle().fill(Color.white.opacity(0.25)).frame(width: 2.5, height: 2.5)
    }
}
