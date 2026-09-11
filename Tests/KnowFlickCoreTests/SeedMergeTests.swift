import Foundation
import Testing
@testable import KnowFlickCore

/// 种子库增量合并回归：README 承诺「新版本内置扩充的卡片自动合并，老用户内容无缝升级」。
struct SeedMergeTests {
    private func card(_ category: String, _ headline: String) -> KnowledgeCard {
        KnowledgeCard(category: category, headline: headline, summary: "摘要", details: "正文", source: .seed,
                      createdAt: Date(timeIntervalSince1970: 1_000_000))
    }

    /// 真实种子库的第一条 headline，用于模拟「老用户手里的旧种子卡」
    private let knownSeedHeadline = "开着冰箱门，房间并不会变凉，反而会变热"

    @Test @MainActor func bootstrapSeedsFreshLibraryFromBundle() async {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let storage = Storage(baseDir: directory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = AppStore(storage: storage)
        defer { store.flushPersistence() }

        await store.bootstrap()
        #expect(store.isLoadingSeed == false)
        #expect(store.cards.count == 214)
        #expect(store.cards.allSatisfy { $0.source == .seed && $0.seenAt == nil })
        #expect(Set(store.cards.map(\.headline)).count == store.cards.count)
    }

    @Test @MainActor func bootstrapAppendsNewSeedsAndPreservesUserData() async {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let storage = Storage(baseDir: directory)
        defer { try? FileManager.default.removeItem(at: directory) }

        // 老用户卡库：一张浏览过并收藏的旧种子卡 + 一张导入卡
        var oldSeed = card("冷知识", knownSeedHeadline)
        oldSeed.seenAt = Date(timeIntervalSince1970: 1_700_000_000)
        oldSeed.swiped = .right
        oldSeed.isFavorite = true
        oldSeed.favoritedAt = Date(timeIntervalSince1970: 1_700_000_100)
        oldSeed.reviewCount = 3
        var imported = card("学习方法", "用户自己导入的笔记卡片")
        imported.source = .imported
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        storage.saveCards([oldSeed, imported])

        let store = AppStore(storage: storage)
        defer { store.flushPersistence() }
        await store.bootstrap()

        // 1 张旧种子（保留学习数据）+ 1 张导入卡 + (214 - 1) 张新种子 = 215
        #expect(store.cards.count == 215)

        let preservedOld = store.cards.first { $0.headline == knownSeedHeadline }
        #expect(preservedOld != nil)
        #expect(preservedOld?.seenAt != nil)
        #expect(preservedOld?.isFavorite == true)
        #expect(preservedOld?.reviewCount == 3)

        let preservedImported = store.cards.first { $0.id == imported.id }
        #expect(preservedImported != nil)
        #expect(preservedImported?.source == .imported)

        let freshSeeds = store.cards.filter { $0.headline != knownSeedHeadline && $0.source == .seed }
        #expect(freshSeeds.count == 213)
        #expect(freshSeeds.allSatisfy { $0.seenAt == nil })
    }
}
