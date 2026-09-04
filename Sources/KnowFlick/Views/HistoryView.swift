import SwiftUI

/// 历史记录：看过的卡片列表，支持筛选与回看
struct HistoryView: View {
    let store: AppStore
    let onClose: () -> Void

    @State private var filter: SwipeDirection? = nil
    @State private var selectedCard: KnowledgeCard? = nil
    @State private var showConfirmClear = false

    private var items: [KnowledgeCard] {
        store.history.filter { filter == nil || $0.swiped == filter }
    }

    var body: some View {
        ZStack {
            LinearGradient(colors: [.black.opacity(0.9), .black.opacity(0.7)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                // 头部
                HStack(spacing: 16) {
                    Button(action: onClose) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white.opacity(0.8))
                            .frame(width: 32, height: 32)
                            .background(.white.opacity(0.1), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .keyboardShortcut(.escape, modifiers: [])

                    Text("历史记录")
                        .font(.title2.bold())
                        .foregroundStyle(.white)

                    Spacer()

                    Picker("筛选", selection: $filter) {
                        Text("全部").tag(Optional<SwipeDirection>.none)
                        Text("感兴趣").tag(Optional<SwipeDirection>.some(.right))
                        Text("不喜欢").tag(Optional<SwipeDirection>.some(.left))
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 260)

                    Button(role: .destructive) {
                        showConfirmClear = true
                    } label: {
                        Label("清空", systemImage: "trash")
                            .font(.callout)
                            .foregroundStyle(.white.opacity(0.7))
                    }
                    .buttonStyle(.plain)
                    .disabled(store.history.isEmpty)
                }
                .padding(20)

                Divider().opacity(0.25)

                // 列表
                if items.isEmpty {
                    Spacer()
                    VStack(spacing: 12) {
                        Image(systemName: "clock")
                            .font(.system(size: 40))
                            .foregroundStyle(.white.opacity(0.4))
                        Text(store.history.isEmpty ? "还没有刷过卡片" : "该筛选下暂无记录")
                            .foregroundStyle(.white.opacity(0.6))
                    }
                    Spacer()
                } else {
                    ScrollView {
                        LazyVStack(spacing: 10) {
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
            DetailView(card: card, store: store) {
                selectedCard = nil
            }
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
    }

    private func historyRow(_ card: KnowledgeCard) -> some View {
        Button {
            selectedCard = card
        } label: {
            HStack(spacing: 14) {
                Image(systemName: card.swiped == .right ? "heart.fill" : "xmark")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(card.swiped == .right ? .green : .red)
                    .frame(width: 34, height: 34)
                    .background(.white.opacity(0.08), in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text(card.headline)
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.95))
                        .lineLimit(1)
                    HStack(spacing: 8) {
                        Text(card.category)
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.5))
                        Text("·")
                            .foregroundStyle(.white.opacity(0.3))
                        Text(card.seenAt?.formatted(date: .abbreviated, time: .shortened) ?? "")
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.4))
                        Text("·")
                            .foregroundStyle(.white.opacity(0.3))
                        Text(card.source == .ai ? "AI" : "预置")
                            .font(.caption)
                            .foregroundStyle(card.source == .ai ? .orange.opacity(0.8) : .green.opacity(0.8))
                    }
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.3))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }
}
