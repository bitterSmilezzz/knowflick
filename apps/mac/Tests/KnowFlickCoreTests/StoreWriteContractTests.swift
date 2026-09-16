import Foundation
import Testing
@testable import KnowFlickCore

/// P2-5 契约护栏：`cards` / `settings` 是 public var，可被外部直接赋值且**不落盘**。
///
/// 现状靠约定（视图只读）维持，但拆分 AppStore 后会出现多个子系统，约定容易被无声破坏：
/// `store.cards = x` 只重算卡堆，重启即丢；`store.settings = x` 还会绕开 `saveSettings` 的
/// Keychain 事务（`AISettings.encode` 有意不含 apiKey → 密钥被静默丢弃）。
/// 这里把约定变成两条可执行的护栏：
/// ① 源码级：视图层不得出现对 store 状态的直接赋值；
/// ② 行为级：所有**意图化方法**改完卡片必须落盘（磁盘上能读回同一结果）。
@MainActor
struct StoreWriteContractTests {
    private func card(_ name: String, category: String = "冷知识") -> KnowledgeCard {
        KnowledgeCard(category: category, headline: name, summary: "摘要-\(name)", details: "详情-\(name)", source: .imported)
    }

    private func makeStore() -> (AppStore, Storage, URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let storage = Storage(baseDir: directory)
        return (AppStore(storage: storage), storage, directory)
    }

    /// 意图化方法改完内存必须落盘：用**另一个** Storage 实例读同一目录，确保看到的是磁盘真相。
    @Test func everyCardIntentReachesDisk() throws {
        let (store, storage, directory) = makeStore()
        defer {
            store.closeChat()
            store.flushPersistence()
            try? FileManager.default.removeItem(at: directory)
        }
        let disk = Storage(baseDir: directory)
        func persisted(_ id: UUID) -> KnowledgeCard? {
            store.flushPersistence()
            return disk.loadCards().first { $0.id == id }
        }

        let subject = card("甲")
        store.cards = [subject]
        store.swipe(subject, direction: .right)
        #expect(persisted(subject.id)?.swiped == .right)
        #expect(persisted(subject.id)?.seenAt != nil)

        store.undoLastSwipe()
        #expect(persisted(subject.id)?.seenAt == nil)

        store.recordQuizResult(cardId: subject.id, rating: .mastered)
        #expect(persisted(subject.id)?.masteryLevel == 2)
        #expect(persisted(subject.id)?.reviewCount == 1)

        store.updateCardContent(id: subject.id, headline: "甲改", category: "冷知识", summary: "摘要-甲", details: "详情-甲")
        #expect(persisted(subject.id)?.headline == "甲改")

        store.completeReading(subject)
        #expect(persisted(subject.id)?.seenAt != nil)

        let favoriteBefore = store.cards.first { $0.id == subject.id }?.isFavorite
        store.toggleFavorite(subject)
        #expect(persisted(subject.id)?.isFavorite == !(favoriteBefore ?? false))

        store.clearHistory()
        #expect(persisted(subject.id)?.seenAt == nil)

        let imported = card("导入卡")
        store.importCards([imported], insertAtTop: true)
        #expect(persisted(imported.id) != nil)
    }

    /// 生成路径也必须落盘（AI 生成后重启不该丢新卡）。
    @Test func generatedCardsReachDisk() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StoreWriteStubProtocol.self]
        let store = AppStore(
            storage: Storage(baseDir: directory),
            aiService: AIService(session: URLSession(configuration: config), retryBaseDelay: 0.01)
        )
        defer { store.closeChat(); store.flushPersistence() }
        var settings = store.settings
        settings.baseURL = "http://localhost:9/v1"
        settings.apiKey = "test-key"
        settings.model = "test-model"
        settings.autoGenerate = false
        store.settings = settings
        store.cards = [card("甲")]

        await store.generateNewCards(count: 1)

        store.flushPersistence()
        #expect(Storage(baseDir: directory).loadCards().contains { $0.source == .ai })
    }

    /// 源码级护栏：`Sources/KnowFlick/` 下的视图不得直写 store 状态（应走 `swipe` / `saveSettings` /
    /// `applySettingsChange` 等意图化方法）。契约被破坏时这条会给出具体文件与代码片段。
    @Test func viewLayerOnlyCallsIntentMethods() throws {
        let viewsRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()   // Tests/KnowFlickCoreTests
            .deletingLastPathComponent()   // Tests
            .deletingLastPathComponent()   // apps/mac
            .appendingPathComponent("Sources/KnowFlick")
        guard FileManager.default.fileExists(atPath: viewsRoot.path) else { return }

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
        #expect(offenders.isEmpty, "视图层不得直写 store 状态：\(offenders)")
    }

    /// 源码级护栏（Core 侧）：除 AppStore 自身外，模块内不得存在对 store 的直写——
    /// 拆分出子系统后，「谁写卡片池」必须仍然唯一（写入 → 重算 → 落盘是一条链）。
    @Test func onlyTheStoreWritesItsOwnCardPool() throws {
        let coreRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/KnowFlickCore")
        guard FileManager.default.fileExists(atPath: coreRoot.path) else { return }

        let forbidden = try NSRegularExpression(pattern: #"store\.(cards|settings)\s*=(?!=)"#)
        var offenders: [String] = []
        let enumerator = FileManager.default.enumerator(at: coreRoot, includingPropertiesForKeys: nil)
        while let url = enumerator?.nextObject() as? URL, url.pathExtension == "swift" {
            guard url.lastPathComponent != "AppStore.swift" else { continue }
            let text = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
            let range = NSRange(text.startIndex..<text.endIndex, in: text)
            for match in forbidden.matches(in: text, range: range) {
                if let hit = Range(match.range, in: text) {
                    offenders.append("\(url.lastPathComponent): \(text[hit])")
                }
            }
        }
        #expect(offenders.isEmpty, "Core 内除 AppStore 外不得直写 store 状态：\(offenders)")
    }
}

/// 生成路径替身：1 张合法卡（标题语义独立，避免近重复抑制）
private final class StoreWriteStubProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let payload: [String: Any] = [
            "category": "冷知识",
            "headline": "章鱼有三颗心脏",
            "summary": "摘要",
            "details": String(repeating: "这是生成内容的深入说明。", count: 12),
            "searchKeywords": ["章鱼"],
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
