import Foundation
import Observation
import Testing
@testable import KnowFlickCore

/// AppStore 卡堆状态机（`recomputeDeckAndHistory`）的行为固化测试（Step 0）。
///
/// 为什么先写这组：拆 AppStore 时唯一不可退让的是「行为等价」。四条分支里原本只有
/// 分支 1（日常刷卡出队）与分支 2（撤销插回）有断言，分支 3（AI 追加 ≤10 张）与
/// 分支 4（全量重排）零覆盖——`generateNewCards` / `refreshDeck` 更是完全没测过
/// （这也是 P1-1「换一批」把整个卡堆刷成已看却无人发现的原因）。
/// 这里把现状的 deck **id 序列**钉死：之后的搬运若改变顺序，断言立刻变红。
@MainActor
struct AppStoreDeckCharacterizationTests {
    private func card(_ name: String, category: String = "冷知识", source: CardSource = .seed) -> KnowledgeCard {
        KnowledgeCard(category: category, headline: name, summary: "摘要-\(name)", details: "详情-\(name)", source: source)
    }

    private func makeStore() -> (AppStore, Storage, URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let storage = Storage(baseDir: directory)
        return (AppStore(storage: storage), storage, directory)
    }

    private func withStore(_ body: (AppStore, Storage) throws -> Void) throws {
        let (store, storage, directory) = makeStore()
        defer {
            store.closeChat()
            store.flushPersistence()
            try? FileManager.default.removeItem(at: directory)
        }
        try body(store, storage)
    }

    private func withStoreAsync(_ body: (AppStore, Storage) async throws -> Void) async throws {
        let (store, storage, directory) = makeStore()
        defer {
            store.closeChat()
            store.flushPersistence()
            try? FileManager.default.removeItem(at: directory)
        }
        try await body(store, storage)
    }

    // MARK: - 四条分支的 deck id 序列

    /// 分支 1：日常刷卡出队。必须 100% 保留排好的顺序（否则每次划卡都重排 → 视觉抖动）。
    @Test func branch1SwipeKeepsRemainingDeckOrder() throws {
        try withStore { store, _ in
            store.cards = [card("甲"), card("乙"), card("丙"), card("丁"), card("戊")]
            let initial = store.deck.map(\.id)
            #expect(initial.count == 5)
            let top = try #require(store.topCard)

            store.swipe(top, direction: .right)

            #expect(store.deck.map(\.id) == Array(initial.dropFirst()))
            #expect(store.history.map(\.id) == [top.id])
        }
    }

    /// 分支 2：撤销把卡精准插回顶部，且整体顺序回到撤销前的排布（不是重新排一遍）。
    @Test func branch2UndoRestoresTheExactPreviousDeckOrder() throws {
        try withStore { store, _ in
            store.cards = [card("甲"), card("乙"), card("丙"), card("丁")]
            let initial = store.deck.map(\.id)
            let top = try #require(store.topCard)

            store.swipe(top, direction: .skip)
            #expect(store.deck.map(\.id) == Array(initial.dropFirst()))

            store.undoLastSwipe()

            #expect(store.deck.map(\.id) == initial)
            #expect(store.history.isEmpty)
            #expect(store.cards.first(where: { $0.id == top.id })?.seenAt == nil)
        }
    }

    /// 分支 3：新卡（≤10 张）只做局部排布后追加到队尾，绝不打散正在浏览的前部卡堆。
    @Test func branch3AppendedCardsAreArrangedAtDeckTail() throws {
        try withStore { store, _ in
            store.cards = [card("甲"), card("乙"), card("丙")]
            let initial = store.deck.map(\.id)
            let extra = [card("新一"), card("新二"), card("新三")]

            store.cards.append(contentsOf: extra)

            // 前部逐位不变
            #expect(Array(store.deck.map(\.id).prefix(initial.count)) == initial)
            // 尾部 = 对新卡单独做 minDistance 排布（避开前部最后一张的图 key）
            let anchor = try #require(store.cards.first(where: { $0.id == initial.last }))
            let expectedTail = CardThemeResolver.arrangeWithMinDistance(
                extra,
                minDistance: 5,
                avoidingTopKey: CardThemeResolver.resolveKey(for: anchor)
            )
            #expect(store.deck.map(\.id) == initial + expectedTail.map(\.id))
        }
    }

    /// 分支 4：整库替换（初始化、切换偏好分类等）走全量重排，顺序 = 盐值打散 + minDistance 贪心。
    /// 这条断言把「重排的确定性」变成契约：同样的输入必须给出同样的队列。
    @Test func branch4WholesaleReplacementReproducesFullRearrange() throws {
        try withStore { store, _ in
            store.cards = [card("旧一"), card("旧二")]
            #expect(!store.deck.isEmpty)

            let fresh = [card("新一"), card("新二"), card("新三"), card("新四"), card("新五")]
            store.cards = fresh

            let expected = CardThemeResolver.arrangeWithMinDistance(fresh, minDistance: 5, avoidingTopKey: nil)
            #expect(store.deck.map(\.id) == expected.map(\.id))
            #expect(Set(store.deck.map(\.id)) == Set(fresh.map(\.id)))
        }
    }

    // MARK: - clearHistory 的分支归宿（旧留档 P3-7 的现状固化）

    /// 「重新探索全部卡片」在历史 ≤10 张时走分支 3：重置出的卡排到**队尾**而不是重新洗进池子。
    /// 用户体感是「点完重新探索，顶卡没变」。这里固化现状，行为变更必须显式改这条断言。
    @Test func clearHistoryWithFewSeenCardsAppendsThemToTheDeckTail() throws {
        try withStore { store, _ in
            store.cards = (0..<20).map { card("卡\($0)") }
            let initialOrder = Set(store.deck.map(\.id))

            for _ in 0..<3 {
                let top = try #require(store.topCard)
                store.swipe(top, direction: .skip)
            }
            let deckBeforeReset = store.deck.map(\.id)
            #expect(deckBeforeReset.count == 17)

            store.clearHistory()

            #expect(store.deck.count == 20)
            #expect(Set(store.deck.map(\.id)) == initialOrder)
            #expect(Array(store.deck.map(\.id).prefix(17)) == deckBeforeReset)   // 顶卡与队列前部不变
            #expect(store.topCard?.id == deckBeforeReset.first)
        }
    }

    /// 历史 >10 张时走分支 4：整堆重排（含重新打散）。
    @Test func clearHistoryWithManySeenCardsRearrangesEverything() throws {
        try withStore { store, _ in
            store.cards = (0..<20).map { card("卡\($0)") }
            for _ in 0..<12 {
                let top = try #require(store.topCard)
                store.swipe(top, direction: .skip)
            }
            let lastKey = CardThemeResolver.resolveKey(for: try #require(store.history.first))

            store.clearHistory()

            let expected = CardThemeResolver.arrangeWithMinDistance(
                store.cards, minDistance: 5, avoidingTopKey: lastKey
            )
            #expect(store.deck.map(\.id) == expected.map(\.id))
        }
    }

    // MARK: - 派生状态的观察契约（拆分方案的前提）

    /// `withObservationTracking` 回调探针：onChange 是 @Sendable 闭包，用带锁引用盒跨隔离域记录。
    private final class ObservationProbe: @unchecked Sendable {
        private let lock = NSLock()
        private var fired: Set<String> = []
        func record(_ name: String) { lock.lock(); fired.insert(name); lock.unlock() }
        func contains(_ name: String) -> Bool { lock.lock(); defer { lock.unlock() }; return fired.contains(name) }
    }

    /// 视图读的是 `cards`/`deck`/`topCard`/`history`/`favorites` 这类**转发与计算属性**。
    /// 拆分方案（facade + 子系统）能成立的前提是：这些属性变更后观察回调照常触发。
    /// 这条测试把该前提钉成 Core 侧契约——搬运后若漏了 @Observable 存储属性，这里会红。
    @Test func cardAndDerivedStateChangesNotifyObservers() throws {
        try withStore { store, _ in
            store.cards = [card("甲"), card("乙"), card("丙")]
            let probe = ObservationProbe()

            withObservationTracking {
                _ = store.cards
            } onChange: {
                probe.record("cards")
            }
            store.cards.append(card("丁"))
            #expect(probe.contains("cards"))

            withObservationTracking {
                _ = store.deck
            } onChange: {
                probe.record("deck")
            }
            store.cards.removeLast()
            #expect(probe.contains("deck"))

            withObservationTracking {
                _ = store.topCard
            } onChange: {
                probe.record("topCard")
            }
            store.swipe(try #require(store.topCard), direction: .skip)
            #expect(probe.contains("topCard"))

            withObservationTracking {
                _ = store.history
            } onChange: {
                probe.record("history")
            }
            store.swipe(try #require(store.deck.first), direction: .skip)
            #expect(probe.contains("history"))

            withObservationTracking {
                _ = store.favorites
            } onChange: {
                probe.record("favorites")
            }
            store.toggleFavorite(try #require(store.deck.first))
            #expect(probe.contains("favorites"))
        }
    }

    /// 设置与聊天告警同样是视图直接读的转发属性（顶栏横幅），变更必须可见。
    @Test func settingsAndChatErrorChangesNotifyObservers() throws {
        try withStore { store, _ in
            let probe = ObservationProbe()

            withObservationTracking {
                _ = store.settings
            } onChange: {
                probe.record("settings")
            }
            store.settings.enableSeed = !store.settings.enableSeed
            #expect(probe.contains("settings"))

            withObservationTracking {
                _ = store.chatErrorMessage
            } onChange: {
                probe.record("chatErrorMessage")
            }
            store.chatErrorMessage = "模拟失败"
            #expect(probe.contains("chatErrorMessage"))
        }
    }

    // MARK: - 契约护栏：视图层不得直写 store 状态

    /// `cards` / `settings` 是 public var：外部直写既不落盘（重启即丢），也不走 Keychain 事务
    /// （`AISettings.encode` 有意不含 apiKey → 密钥被静默丢弃）。现状靠约定维持，这里把约定
    /// 变成可执行的护栏：视图层出现直接赋值就红。测试自身仍需写 `store.cards`（内存态构造），
    /// 所以只扫 `Sources/KnowFlick/`。
    @Test func viewLayerNeverAssignsStoreStateDirectly() throws {
        let viewsRoot = URL(fileURLWithPath: #filePath)          // Tests/KnowFlickCoreTests/xxx.swift
            .deletingLastPathComponent()                          // Tests/KnowFlickCoreTests
            .deletingLastPathComponent()                          // Tests
            .deletingLastPathComponent()                          // apps/mac
            .appendingPathComponent("Sources/KnowFlick")
        guard FileManager.default.fileExists(atPath: viewsRoot.path) else { return }

        // 「store.cards =」这种直接赋值；`==` 比较不算，`store.cards.contains` 这类读取也不算
        let forbidden = try NSRegularExpression(
            pattern: #"store\.(cards|settings|deck|history|favorites|topCard|isGenerating|isLoadingSeed)\s*=(?!=)"#
        )
        var offenders: [String] = []
        let enumerator = FileManager.default.enumerator(at: viewsRoot, includingPropertiesForKeys: nil)
        while let url = enumerator?.nextObject() as? URL, url.pathExtension == "swift" {
            let text = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
            let range = NSRange(text.startIndex..<text.endIndex, in: text)
            for match in forbidden.matches(in: text, range: range) {
                if let hit = Range(match.range, in: text) {
                    offenders.append("\(url.lastPathComponent): \(text[hit])")
                }
            }
        }
        #expect(offenders.isEmpty, "视图层不得直写 store 状态（应走意图化方法）：\(offenders)")
    }

    // MARK: - AI 生成与「换一批」的现状（原本零覆盖）

    /// 生成失败路径：未配置 AI 时抛错写进 `lastError`，卡片池与卡堆保持不变（不得静默吞掉失败）。
    @Test func generateNewCardsWithoutAIConfigurationKeepsCardPoolIntact() async throws {
        try await withStoreAsync { store, _ in
            store.cards = [card("甲"), card("乙")]
            let before = store.deck.map(\.id)

            await store.generateNewCards(count: 3)

            #expect(store.lastError != nil)
            #expect(store.deck.map(\.id) == before)
            #expect(store.cards.count == 2)
        }
    }

    /// 生成成功路径：新卡进卡片池、追加到卡堆尾部、并落盘（重启后仍在）。
    @Test func generateNewCardsAppendsToPoolAndDeckTailAndPersists() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let storage = Storage(baseDir: directory)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [CardGenerationStubProtocol.self]
        let store = AppStore(
            storage: storage,
            aiService: AIService(session: URLSession(configuration: config), retryBaseDelay: 0.01)
        )
        defer { store.flushPersistence() }
        var settings = store.settings
        settings.baseURL = "http://localhost:9/v1"
        settings.apiKey = "test-key"
        settings.model = "test-model"
        settings.autoGenerate = false
        store.settings = settings
        store.cards = [card("甲"), card("乙")]
        let before = store.deck.map(\.id)

        await store.generateNewCards(count: 1)

        #expect(store.lastError == nil)
        #expect(store.cards.count == 3)
        #expect(Array(store.deck.map(\.id).prefix(2)) == before)      // 前部不重排
        #expect(store.deck.count == 3)
        store.flushPersistence()
        #expect(storage.loadCards().count == 3)
    }

    /// P1-1 回归：「换一批」只跳**顶卡**（对齐 Android / CONTEXT.md 的 skip 语义）。
    /// 修复前实现把整个 deck 一次性写 `seenAt`/`skip`（实测 216 张 → 0，历史 +216，
    /// skipCount=216），今日目标、连续天数、7 天趋势被批量污染。
    @Test func refreshDeckSkipsOnlyTheTopCard() async throws {
        try await withStoreAsync { store, _ in
            store.cards = [card("甲"), card("乙"), card("丙"), card("丁")]
            let before = store.deck.map(\.id)

            await store.refreshDeck()

            // 只有顶卡进历史，其余三张原样留在卡堆（顺序不变）
            #expect(store.deck.map(\.id) == Array(before.dropFirst()))
            #expect(store.history.map(\.id) == [before[0]])
            #expect(store.cards.filter { $0.seenAt != nil }.map(\.id) == [before[0]])
            #expect(store.cards.first(where: { $0.id == before[0] })?.swiped == .skip)

            // 统计只 +1 且不表达喜好
            let stats = StatsCalculator.compute(from: store.cards)
            #expect(stats.seenCount == 1)
            #expect(stats.skipCount == 1)
            #expect(stats.likedCount == 0)

            // 未配置 AI 时不生成新卡
            #expect(store.cards.count == 4)
        }
    }

    /// 「换一批」在配置了 AI 时：跳顶卡 + 生成新卡（新卡进池、追加到卡堆尾部）。
    @Test func refreshDeckSkipsTopCardThenGenerates() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [CardGenerationStubProtocol.self]
        let store = AppStore(
            storage: Storage(baseDir: directory),
            aiService: AIService(session: URLSession(configuration: config), retryBaseDelay: 0.01)
        )
        defer { store.flushPersistence() }
        var settings = store.settings
        settings.baseURL = "http://localhost:9/v1"
        settings.apiKey = "test-key"
        settings.model = "test-model"
        settings.autoGenerate = true
        store.settings = settings
        store.cards = [card("甲"), card("乙"), card("丙"), card("丁")]
        let before = store.deck.map(\.id)

        await store.refreshDeck()

        #expect(store.lastError == nil)
        #expect(store.history.map(\.id) == [before[0]])              // 只跳顶卡
        #expect(Array(store.deck.map(\.id).prefix(3)) == Array(before.dropFirst()))
        #expect(store.deck.count == 4)                               // 3 张存量 + 1 张生成
        #expect(store.cards.count == 5)
        #expect(store.cards.last?.source == .ai)
    }

    /// 「换一批」不得改动收藏状态（skip 与收藏解耦）：对顶卡的收藏态既不写也不清。
    @Test func refreshDeckLeavesFavoritesUntouched() async throws {
        try await withStoreAsync { store, _ in
            store.cards = [card("甲"), card("乙")]
            store.toggleFavorite(try #require(store.topCard))

            await store.refreshDeck()

            #expect(store.favorites.count == 1)
            #expect(store.favorites.first?.swiped == .skip)
        }
    }

    /// 空卡堆上点「换一批」不得崩溃，也不得凭空写状态。
    @Test func refreshDeckOnEmptyDeckIsSafe() async throws {
        try await withStoreAsync { store, _ in
            store.cards = []

            await store.refreshDeck()

            #expect(store.deck.isEmpty)
            #expect(store.history.isEmpty)
            #expect(store.cards.isEmpty)
        }
    }
}

/// 生成路径替身：返回 1 张合法卡（delta.content 为「卡片 JSON 数组」的字符串形式）。
/// 标题与测试池内其他标题语义无关，避免被近重复抑制（bigram Jaccard > 0.35）丢弃。
private final class CardGenerationStubProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let payload: [String: Any] = [
            "category": "冷知识",
            "headline": "蜂巢为何是六边形",
            "summary": "摘要",
            "details": String(repeating: "这是生成内容的深入说明。", count: 12),
            "searchKeywords": ["蜂巢", "六边形"],
            "sources": []
        ]
        let arrayText = String(data: try! JSONSerialization.data(withJSONObject: [payload]), encoding: .utf8)!
        let event: [String: Any] = ["choices": [["delta": ["content": arrayText]]]]
        let text = String(data: try! JSONSerialization.data(withJSONObject: event), encoding: .utf8)!
        let body = Data("data: \(text)\n\ndata: [DONE]\n\n".utf8)
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
                                       headerFields: ["Content-Type": "text/event-stream"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
