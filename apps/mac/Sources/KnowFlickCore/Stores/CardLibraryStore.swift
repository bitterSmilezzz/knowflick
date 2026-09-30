import Foundation
import Observation

/// 卡片库子系统（拆分方案 B Step 5）：卡片池 / 卡堆派生 / 历史 / 收藏的状态所有权，
/// 以及 swipe / undo / import / merge / 测验记录等卡片域意图化动作。
///
/// `AppStore` 保留同名转发属性与方法，视图与测试零改动。两个跨域接口：
/// - 设置：所有权在 facade（`settings.didSet` 驱动语音同步等副作用），经 `settingsDidChange`
///   单漏斗同步进 `lastKnownSettings` 供派生使用——所有设置写入都会触发该 didSet，快照不会漂移；
/// - 加载守卫：`isLoadingSeed` 是卡片库自己的状态（「快照是否可信」必须与 `cards.isEmpty`
///   动态结合判断，测试在加载期写入卡片也必须照常落盘），facade 转发读写。
@MainActor
@Observable
public final class CardLibraryStore {
    // MARK: - 状态

    public var cards: [KnowledgeCard] = [] {
        didSet {
            recomputeDeckAndHistory()
        }
    }
    /// 学习范围（学习地图下发）：生效时接管卡堆的分类维度。
    /// **只在本次会话内生效，不落盘**——重启回到全景，与 Android 侧同一产品口径。
    public var studyScope: StudyScope = .none {
        didSet {
            guard studyScope != oldValue else { return }
            recomputeDeckAndHistory()
        }
    }
    /// 首启是否还在加载预置库。守卫语义见 `cardSnapshotIsUntrusted`。
    public var isLoadingSeed = true

    public private(set) var deck: [KnowledgeCard] = []
    public private(set) var history: [KnowledgeCard] = []

    /// 收藏阁：显式收藏的卡片列表（按收藏时间倒序，与喜好意图解耦）。
    /// 存储派生快照，随 recomputeDeckAndHistory 刷新；避免视图 body 每次访问都全库 filter+sort。
    public private(set) var favorites: [KnowledgeCard] = []

    public var topCard: KnowledgeCard? { deck.first }

    /// 派生用的设置快照：经 `settingsDidChange` 单漏斗保持同步（见类型注释）。
    private var lastKnownSettings: AISettings
    private var lastSwipedCardId: UUID?
    private var lastSwipedKey: String?

    private let persistence: PersistenceCoordinator

    init(persistence: PersistenceCoordinator, initialSettings: AISettings = .default) {
        self.persistence = persistence
        self.lastKnownSettings = initialSettings
        recomputeDeckAndHistory()
    }

    // MARK: - 跨域同步入口

    /// facade 的 `settings` 每次赋值都会调用（didSet）：刷新派生快照并重算卡堆。
    func settingsDidChange(_ settings: AISettings) {
        lastKnownSettings = settings
        recomputeDeckAndHistory()
    }

    /// 卡片快照此刻是否可信：加载未完成（`isLoadingSeed`）且没有任何卡片时，
    /// 落盘等于把「空库」写成用户数据（实测「启动未完成即退出」会让 cards.json 变成 `[]`，
    /// 下次启动被判损坏并重播种）。判据取「仍在加载中 **且** 没有任何卡片」：
    /// 加载中却有卡片 = 调用方已经明确放进来的内容，照常落盘；两者同时成立才不可信。
    var cardSnapshotIsUntrusted: Bool { isLoadingSeed && cards.isEmpty }

    // MARK: - 派生

    /// 卡片池 → 卡堆/历史/收藏 的派生统一走 `DeckDeriver`（纯函数，可穷举单测）。
    /// 这里只做「取值 → 派生 → 一次性赋值」，避免逐项变更触发观察风暴。
    private func recomputeDeckAndHistory() {
        let derived = DeckDeriver.derive(
            cards: cards,
            currentDeck: deck,
            enableSeed: lastKnownSettings.enableSeed,
            enableAI: lastKnownSettings.enableAI,
            preferredCategories: lastKnownSettings.preferredCategories,
            studyScope: studyScope,
            lastSwipedCardId: lastSwipedCardId,
            lastSwipedKey: lastSwipedKey
        )
        history = derived.history
        favorites = derived.favorites
        deck = derived.deck
    }

    // MARK: - 持久化

    private func persist() {
        persistence.persist(cards: cards, skipCards: cardSnapshotIsUntrusted)
    }

    // MARK: - 刷卡动作

    /// Explicit reading completion preserves collection membership and review history.
    public func completeReading(_ card: KnowledgeCard) {
        guard let index = cards.firstIndex(where: { $0.id == card.id }) else { return }
        var updated = cards
        updated[index].seenAt = Date()
        cards = updated
        persist()
    }

    /// Edit content without replacing the card or its learning state.
    @discardableResult
    public func updateCardContent(id: UUID, headline: String, category: String, summary: String, details: String) -> Bool {
        let fields = [headline, category, summary, details].map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard fields.allSatisfy({ !$0.isEmpty }), let index = cards.firstIndex(where: { $0.id == id }) else { return false }
        var updated = cards
        updated[index].headline = fields[0]
        updated[index].category = fields[1]
        updated[index].summary = fields[2]
        updated[index].details = fields[3]
        cards = updated
        persist()
        return true
    }

    /// 卡片被划走：记入历史并落盘。
    /// - `right` = 感兴趣：同时写入收藏（与「收藏阁」入口语义一致）
    /// - `left` = 不喜欢：同时移出收藏，避免「不喜欢却仍在收藏阁」
    /// - `skip` = 系统跳过：只写浏览状态，不表达喜好，也不动收藏
    /// 已看过的卡片（历史页/收藏阁打标签等场景）保留原 `seenAt`，避免时间线被重排。
    public func swipe(_ card: KnowledgeCard, direction: SwipeDirection) {
        guard let idx = cards.firstIndex(where: { $0.id == card.id }) else { return }
        lastSwipedCardId = card.id
        lastSwipedKey = CardThemeResolver.resolveKey(for: card)
        var updated = cards
        if updated[idx].seenAt == nil { updated[idx].seenAt = Date() }
        updated[idx].swiped = direction
        switch direction {
        case .right:
            updated[idx].isFavorite = true
            updated[idx].favoritedAt = updated[idx].favoritedAt ?? Date()
        case .left:
            updated[idx].isFavorite = false
            updated[idx].favoritedAt = nil
        case .skip: break
        }
        cards = updated
        persist()
    }

    /// 撤销上一张（从历史顶部退回卡堆顶部）
    public func undoLastSwipe() {
        guard let last = history.first,
              let idx = cards.firstIndex(where: { $0.id == last.id }) else { return }
        // 与 recomputeDeckAndHistory 的「插回顶部」分支对齐：撤销目标就是这张卡。
        lastSwipedCardId = last.id
        lastSwipedKey = CardThemeResolver.resolveKey(for: last)
        var updated = cards
        updated[idx].seenAt = nil
        updated[idx].swiped = nil
        cards = updated
        persist()
    }

    /// 清空历史（「重新探索全部卡片」）：重置浏览记录以重新开始探索。
    /// - 清除 `seenAt`：卡片回到待刷卡堆，历史时间线与由此派生的统计（已刷/喜欢率/连续天数）随之归零，
    ///   这是「重新探索」的预期语义。
    /// - **保留 `isFavorite`**：收藏阁是用户显式沉淀的内容，不因重置浏览进度而丢失。
    /// - 保留 `swiped`：它只在 `seenAt != nil` 时参与统计，清空后不可见，下次刷卡会覆写，无需额外清理。
    public func clearHistory() {
        var updated = cards
        for i in updated.indices {
            updated[i].seenAt = nil
        }
        cards = updated
        persist()
    }

    /// 将指定卡片置顶到待刷卡堆顶部（例如通过全局搜索快速定位并准备浏览）。
    /// 走 `DeckDeriver` 的统一插回入口：置顶语义不变，但插入前做防重校验（P2-3）。
    public func promoteToDeckTop(_ card: KnowledgeCard) {
        guard let target = cards.first(where: { $0.id == card.id }) else { return }
        if deck.first?.id == target.id { return }
        self.deck = DeckDeriver.insertRespectingMinDistance(target, into: deck)
    }

    // MARK: - 收藏管理与笔记导出

    /// 切换卡片的收藏状态（已收藏则取消收藏为 skip，未收藏则标记为 right 收藏）
    public func toggleFavorite(_ card: KnowledgeCard) {
        guard let idx = cards.firstIndex(where: { $0.id == card.id }) else { return }
        var updated = cards
        // 收藏与喜好意图解耦：只翻转 isFavorite，不改写 swiped（否则会污染喜欢/不喜欢统计）。
        // 也不写 seenAt：收藏一张未读卡不应被计为「已浏览」（否则今日目标/统计/复习队列都会凭空 +1）。
        // 收藏时间单独记在 favoritedAt，供收藏阁排序（取消收藏时一并清空）。
        updated[idx].isFavorite.toggle()
        updated[idx].favoritedAt = updated[idx].isFavorite ? Date() : nil
        cards = updated
        persist()
    }

    /// 检查某张卡片是否已被收藏
    public func isFavorite(_ card: KnowledgeCard) -> Bool {
        cards.first(where: { $0.id == card.id })?.isFavorite ?? false
    }

    /// 导出收藏夹为兼容 Obsidian / Notion 的 Markdown 格式。
    /// 渲染统一由 CardExportEngine 承担（目录锚点、来源标注、收藏时间口径与通用导出一致）。
    public func exportFavoritesMarkdown(filtered: [KnowledgeCard]? = nil) -> String {
        CardExportEngine.exportFavoritesMarkdown(cards: filtered ?? favorites)
    }

    // MARK: - 卡片批量导入与笔记提炼

    @discardableResult
    public func importCards(_ incoming: [KnowledgeCard], insertAtTop: Bool = true) -> CardImportResult {
        let (toAdd, dupCount) = CardImportEngine.deduplicateAndMerge(existing: cards, incoming: incoming)
        guard !toAdd.isEmpty else {
            return CardImportResult(parsedCards: [], duplicateCount: dupCount, sourceDescription: "所有卡片均已存在，已自动去重")
        }

        let processed = toAdd
        if insertAtTop {
            // didSet 已同步触发 recomputeDeckAndHistory，无需再显式重算一遍。
            // 只有**真正进入卡堆**的导入卡才置顶（已读卡、被来源开关过滤掉的卡不在卡堆里，口径与原先一致）；
            // 逐张从底部反插到队首，让每张都过一次防重校验，保证「导入块 ↔ 原队首」的新接缝也不撞图（P2-3）。
            // 无冲突时结果与原先的 `promoted + otherDeck` 完全一致（导入块内部相对顺序不变）。
            cards = processed + cards
            let processedIds = Set(processed.map(\.id))
            let promoted = deck.filter { processedIds.contains($0.id) }
            var updatedDeck = deck.filter { !processedIds.contains($0.id) }
            for card in promoted.reversed() {
                updatedDeck = DeckDeriver.insertRespectingMinDistance(card, into: updatedDeck)
            }
            self.deck = updatedDeck
        } else {
            cards.append(contentsOf: processed)
            recomputeDeckAndHistory()
        }
        persist()

        return CardImportResult(
            parsedCards: processed,
            duplicateCount: dupCount,
            sourceDescription: "成功导入 \(processed.count) 张新卡片\(dupCount > 0 ? "，自动去重跳过 \(dupCount) 张" : "")"
        )
    }

    /// 智能合并外部卡片库（支持局域网同步就地升级已有卡片的学习进度与内容）
    @discardableResult
    public func mergeCards(_ incoming: [KnowledgeCard], insertNewAtTop: Bool = false) -> (added: Int, updated: Int, ignored: Int) {
        let (merged, added, updated, ignored) = CardImportEngine.mergeCardList(existing: cards, incoming: incoming)
        guard added > 0 || updated > 0 else {
            return (added: 0, updated: 0, ignored: ignored)
        }

        if insertNewAtTop && added > 0 {
            let newCards = Array(merged.suffix(added))
            let existingAndUpdated = Array(merged.prefix(merged.count - added))
            cards = newCards + existingAndUpdated
        } else {
            cards = merged
        }
        persist()

        return (added: added, updated: updated, ignored: ignored)
    }

    // MARK: - 知识测验记录 (Flashcard Quiz)

    /// 记录单次测验反馈：更新卡片掌握度与复习次数，并写盘
    public func recordQuizResult(cardId: UUID, rating: QuizRating) {
        guard let idx = cards.firstIndex(where: { $0.id == cardId }) else { return }
        var updated = cards
        updated[idx].reviewCount += 1
        updated[idx].lastReviewedAt = Date()
        switch rating {
        case .forgot:
            updated[idx].masteryLevel = 0
        case .hesitant:
            updated[idx].masteryLevel = 1
        case .mastered:
            updated[idx].masteryLevel = 2
        }
        cards = updated
        persist()
    }
}

extension CardLibraryStore {
    /// 测验自评档位（自 AppStore 迁入）：定义保持逐字不变，`AppStore.QuizRating` 经 typealias 保持原名可用。
    public enum QuizRating: Int, CaseIterable, Identifiable {
        case forgot = 1      // 没想起来 (完全遗忘)
        case hesitant = 2    // 犹豫想起 (模糊记忆)
        case mastered = 3    // 熟练掌握 (清晰再认)

        public var id: Int { rawValue }

        public var title: String {
            switch self {
            case .forgot: return "没想起来"
            case .hesitant: return "犹豫想起"
            case .mastered: return "熟练掌握"
            }
        }

        public var icon: String {
            switch self {
            case .forgot: return "xmark.circle.fill"
            case .hesitant: return "questionmark.circle.fill"
            case .mastered: return "checkmark.circle.fill"
            }
        }

        public var shortcut: String {
            switch self {
            case .forgot: return "⌘1"
            case .hesitant: return "⌘2"
            case .mastered: return "⌘3"
            }
        }
    }
}
