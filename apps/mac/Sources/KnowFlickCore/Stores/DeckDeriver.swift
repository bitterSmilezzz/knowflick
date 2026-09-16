import Foundation

/// 卡堆派生：把「卡片池 + 来源开关 + 偏好分类 + 当前卡堆 + 上次划卡」算成新的卡堆/历史/收藏。
///
/// 为什么抽成纯函数（拆分方案 B Step 2）：这套四分支状态机原先埋在 `AppStore.recomputeDeckAndHistory` 里，
/// 只能通过构造整个 store 间接测试（四条分支里原本只有 2 条有断言）。纯函数化之后可以穷举输入，
/// 也把「卡堆顺序为什么是这样」的理由集中到一处——这是拆分里最容易改坏、也最值得固定下来的逻辑。
///
/// 纯函数纪律：不读写任何全局状态（`CardThemeResolver` 的 key 缓存是纯函数式缓存，不影响结果）。
enum DeckDeriver {
    /// 派生结果：三份快照由调用方一次性赋值，避免逐项变更触发观察风暴。
    struct Derived: Equatable {
        let deck: [KnowledgeCard]
        let history: [KnowledgeCard]
        let favorites: [KnowledgeCard]
    }

    /// 派生卡堆/历史/收藏。
    /// - Parameters:
    ///   - cards: 卡片池（领域真源）
    ///   - currentDeck: 当前卡堆：日常刷卡要 100% 保序，新卡只追加到尾部，都不能靠重算
    ///   - enableSeed / enableAI: 来源开关（全关则队列为空，含导入卡片，口径见 CONTEXT.md）
    ///   - preferredCategories: 偏好分类（`CategoryRegistry.resolve` 解析后的结果，空 = 全部）
    ///   - lastSwipedCardId: 上一张划走的卡：用于识别「撤销插回」这一唯一需要置顶的场景
    ///   - lastSwipedKey: 上一张划走卡的图 key：全量重排时避开它，杜绝划走后立刻撞图
    static func derive(
        cards: [KnowledgeCard],
        currentDeck: [KnowledgeCard],
        enableSeed: Bool,
        enableAI: Bool,
        preferredCategories: [String],
        lastSwipedCardId: UUID?,
        lastSwipedKey: String?
    ) -> Derived {
        let hist = cards.filter { $0.seenAt != nil }
            .sorted { ($0.seenAt ?? .distantPast) > ($1.seenAt ?? .distantPast) }
        let favorites = cards.filter(\.isFavorite)
            .sorted { ($0.favoritedAt ?? .distantPast) > ($1.favoritedAt ?? .distantPast) }
        // 缓存只保留仍然存在的卡片，避免已删除卡片的条目永久驻留
        CardThemeResolver.pruneKeyCache(keeping: Set(cards.map(\.id)))

        var unseen = cards.filter { $0.seenAt == nil }
        // 来源开关：只开其一则只看该来源；全关则队列为空（含外部导入卡片，口径见 CONTEXT.md）
        if !enableSeed || !enableAI {
            unseen = unseen.filter {
                switch $0.source {
                case .seed: return enableSeed
                case .ai: return enableAI
                case .imported: return false
                }
            }
        }
        let filtered: [KnowledgeCard]
        if preferredCategories.isEmpty {
            filtered = unseen
        } else {
            let preferred = unseen.filter { preferredCategories.contains($0.category) }
            filtered = preferred.isEmpty ? unseen : preferred
        }

        let existingDeckIds = Set(currentDeck.map(\.id))
        let currentCards = Dictionary(filtered.map { ($0.id, $0) }, uniquingKeysWith: { _, latest in latest })
        let remainingInDeck = currentDeck.compactMap { currentCards[$0.id] }
        let newCards = filtered.filter { !existingDeckIds.contains($0.id) }

        let deck: [KnowledgeCard]
        if !remainingInDeck.isEmpty && newCards.isEmpty {
            // 绝大多数日常划卡出队场景：直接移除划走卡片，100% 保留排好的无碰撞队列顺序，杜绝重排抖动
            deck = remainingInDeck
        } else if !remainingInDeck.isEmpty && newCards.count == 1 && newCards.first?.id == lastSwipedCardId {
            // 撤销上一张场景：插回顶部。走统一的插回入口做防重校验——
            // 收藏阁对「未读收藏卡」划不喜欢时，该卡可能从卡堆中部消失，裸插顶部会与队首同图（距离 1）
            deck = insertRespectingMinDistance(newCards[0], into: remainingInDeck)
        } else if !remainingInDeck.isEmpty && !newCards.isEmpty && newCards.count <= 10 {
            // 后台 AI 异步生成新卡（3~6 张）：对新卡安排 minDistance 排布后追加至末尾，绝不打散前部正在浏览的卡堆
            let lastKey = remainingInDeck.last.map { CardThemeResolver.resolveKey(for: $0) }
            let arrangedNew = CardThemeResolver.arrangeWithMinDistance(newCards, minDistance: 5, avoidingTopKey: lastKey)
            deck = remainingInDeck + arrangedNew
        } else {
            // 全新初始化、切换分类过滤、清空历史等场景：全量重新排布无碰撞队列
            let lastKey = hist.first.map { CardThemeResolver.resolveKey(for: $0) } ?? lastSwipedKey
            deck = CardThemeResolver.arrangeWithMinDistance(filtered, minDistance: 5, avoidingTopKey: lastKey)
        }

        return Derived(deck: deck, history: hist, favorites: favorites)
    }

    // MARK: - 统一插回入口（防重排布收敛）

    /// 把一张卡插到队首，并保证它与随后的卡不撞图（CONTEXT.md：连续两张不同图）。
    ///
    /// 为什么需要统一入口（P2-3）：撤销插回、全局搜索置顶、导入置顶原先都直接 `insert(at: 0)`，
    /// 完全绕过 `CardThemeResolver` 的防重排布，可达「新顶卡与下一张同 key → 距离 1」。
    /// 这里保证置顶语义（`card` 一定在队首），只把与它过近的同图卡后移，其余顺序原样保留。
    static func insertRespectingMinDistance(
        _ card: KnowledgeCard,
        into deck: [KnowledgeCard],
        minDistance: Int = 5
    ) -> [KnowledgeCard] {
        let topKey = CardThemeResolver.resolveKey(for: card)
        let rest = deck.filter { $0.id != card.id }
        guard minDistance > 1, rest.count > 1 else { return [card] + rest }

        // 需要挪动的只有「与顶卡在 minDistance 内同图」的卡；其余相对顺序保持不变（避免整堆抖动）
        var displaced: [KnowledgeCard] = []
        var kept: [KnowledgeCard] = []
        for (index, candidate) in rest.enumerated() {
            if index < minDistance - 1, CardThemeResolver.resolveKey(for: candidate) == topKey {
                displaced.append(candidate)
            } else {
                kept.append(candidate)
            }
        }
        guard !displaced.isEmpty else { return [card] + rest }

        // 逐张放回：从第 minDistance 位起找第一个与前后 minDistance 内都不同图的位置
        for cardToPlace in displaced {
            let key = CardThemeResolver.resolveKey(for: cardToPlace)
            var insertAt = kept.count
            if kept.count >= minDistance - 1 {
                for index in (minDistance - 1)...kept.count where isSpaced(key, in: kept, at: index, topKey: topKey, minDistance: minDistance) {
                    insertAt = index
                    break
                }
            }
            kept.insert(cardToPlace, at: insertAt)
        }
        return [card] + kept
    }

    /// `key` 插到 `deck` 的下标 `index` 处后，是否与前后 minDistance 张内都没有同图
    private static func isSpaced(
        _ key: String,
        in deck: [KnowledgeCard],
        at index: Int,
        topKey: String,
        minDistance: Int
    ) -> Bool {
        // 与顶卡的距离：下标 0 的卡与顶卡相邻（距离 1）
        if index + 1 < minDistance && key == topKey { return false }
        let lower = max(0, index - (minDistance - 1))
        if lower < index, deck[lower..<index].contains(where: { CardThemeResolver.resolveKey(for: $0) == key }) {
            return false
        }
        let upper = min(deck.count, index + minDistance - 1)
        if index < upper, deck[index..<upper].contains(where: { CardThemeResolver.resolveKey(for: $0) == key }) {
            return false
        }
        return true
    }
}
