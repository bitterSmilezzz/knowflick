import Foundation
import Testing
@testable import KnowFlickCore

struct ImportExportRegressionTests {
    @Test func repeatedExportNeverOverwritesExistingNotes() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let card = KnowledgeCard(category: "物理", headline: "笔记", summary: "摘要", details: "正文", source: .imported)
        let filename = try #require(CardExportEngine.exportObsidianFiles(cards: [card]).first?.filename)
        let existing = directory.appendingPathComponent(filename)
        try Data("原有手写笔记".utf8).write(to: existing)
        let first = try CardExportWriter.writeObsidian(cards: [card], into: directory)
        let second = try CardExportWriter.writeObsidian(cards: [card], into: directory)
        #expect(first != second)
        #expect(try String(contentsOf: existing, encoding: .utf8) == "原有手写笔记")
        #expect(FileManager.default.fileExists(atPath: first.appendingPathComponent(filename).path))
        #expect(FileManager.default.fileExists(atPath: second.appendingPathComponent(filename).path))
    }

    @Test func malformedWikiBracketsRemainReadable() throws {
        let text = "# 笔记\n> 摘要\n分类 ]] 意外出现在 [[ 之前"
        let card = try #require(CardImportEngine.parseMarkdown(text: text).first)
        #expect(card.details.contains("分类 ]] 意外出现在 [[ 之前"))
    }

    @Test @MainActor func importingArchivePreservesLearningHistory() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let storage = Storage(baseDir: directory)
        let store = AppStore(storage: storage)
        defer { store.flushPersistence(); try? FileManager.default.removeItem(at: directory) }
        let date = Date(timeIntervalSince1970: 1_700_000_000)
        let original = KnowledgeCard(category: "物理", headline: "已复习笔记", summary: "摘要", details: "正文",
            source: .imported, createdAt: date, seenAt: date, swiped: .right,
            reviewCount: 7, masteryLevel: 2, lastReviewedAt: date)
        let archive = try CardExportEngine.exportJSONArchive(cards: [original])
        store.importCards(try CardImportEngine.parseJSON(data: archive))
        store.flushPersistence()
        #expect(storage.loadCards().first == original)
        #expect(store.history.first?.id == original.id)
        #expect(store.deck.isEmpty)
    }

    @Test @MainActor func importPromotionRespectsDisabledSources() {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = AppStore(storage: Storage(baseDir: directory))
        defer { store.flushPersistence(); try? FileManager.default.removeItem(at: directory) }
        store.settings.enableSeed = false
        let card = KnowledgeCard(category: "物理", headline: "种子", summary: "摘要", details: "正文", source: .seed)
        store.importCards([card])
        #expect(store.cards.count == 1)
        #expect(store.deck.isEmpty)
    }

    @Test func markdownPreservesCodeAndInlineLinkParagraph() throws {
        let code = "```swift\n# not a card\n---\nlet answer = 42\n```"
        let paragraph = "请阅读 [解释](https://example.com) 并保留本段的重要结论。"
        let cards = CardImportEngine.parseMarkdown(text: "# 笔记\n> 摘要\n\(code)\n\(paragraph)")
        #expect(cards.count == 1)
        let card = try #require(cards.first)
        #expect(card.details.contains(code))
        #expect(card.details.contains(paragraph))
        #expect(card.links.count == 1)
    }

    @Test func markdownDoesNotTruncateLongHeadline() throws {
        let headline = String(repeating: "有意义的标题", count: 20)
        let card = try #require(CardImportEngine.parseMarkdown(text: "# \(headline)\n> 摘要\n正文").first)
        #expect(card.headline == headline)
    }

    @Test func obsidianNamesAreSafeAndCaseInsensitiveUnique() {
        let cards = ["ABC", "abc"].map {
            KnowledgeCard(category: "编程/Swift", headline: $0, summary: "摘要", details: "正文", source: .imported)
        }
        let files = CardExportEngine.exportObsidianFiles(cards: cards)
        #expect(files.allSatisfy { !$0.filename.contains("/") && !$0.filename.contains(":") })
        #expect(Set(files.map { $0.filename.lowercased() }).count == 2)
    }

    @Test func markdownContentsLinksHaveMatchingAnchors() {
        let card = KnowledgeCard(category: "物理", headline: "带标点：标题？", summary: "摘要", details: "正文", source: .seed)
        let md = CardExportEngine.exportMarkdownSingleFile(cards: [card])
        #expect(md.contains("](#card-1)"))
        #expect(md.contains("<a id=\"card-1\"></a>"))
    }
}
