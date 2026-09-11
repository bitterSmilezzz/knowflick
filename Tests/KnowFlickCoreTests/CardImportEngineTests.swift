import Testing
import Foundation
@testable import KnowFlickCore

@Suite("CardImportEngineTests")
struct CardImportEngineTests {

    @Test("JSON 导入能够解析标准卡片数组与单卡片")
    func testParseJSON() throws {
        let jsonStr = """
        [
          {
            "id": "11111111-2222-3333-4444-555555555555",
            "category": "经济学",
            "headline": "沉没成本不是成本",
            "summary": "已经发生的支出无法收回，不应作为未来决策的依据。",
            "details": "在经济学与商业决策中，理性的决策应当仅考虑边际成本与边际收益。",
            "source": "imported"
          }
        ]
        """
        let data = jsonStr.data(using: .utf8)!
        let cards = try CardImportEngine.parseJSON(data: data)

        #expect(cards.count == 1)
        #expect(cards[0].category == "经济学")
        #expect(cards[0].headline == "沉没成本不是成本")
        #expect(cards[0].source == .imported)
    }

    @Test("Markdown 规则解析能够根据分割线 --- 提取多张卡片与元数据")
    func testParseMarkdownWithDividers() {
        let md = """
        ---
        category: 心理学
        title: 峰终定律：大脑只记住高潮和结局
        ---
        > 过程的漫长被压缩，峰值与结束时刻决定整体体验。
        丹尼尔·卡尼曼提出的认知偏差。

        ---
        ## 幸存者偏差：看不见的弹孔最致命
        **领域**：[[统计学]]
        > 只统计幸存下来的样本，会得出完全颠倒的因果推论。
        沃德力排众议建议加强没有弹孔的机翼引擎。
        [沃德统计学故事](https://example.com/ward)
        """

        let cards = CardImportEngine.parseMarkdown(text: md)
        #expect(cards.count == 2)

        let first = cards[0]
        #expect(first.category == "心理学")
        #expect(first.headline.contains("峰终定律"))
        #expect(first.summary.contains("过程的漫长被压缩"))
        #expect(first.source == .imported)

        let second = cards[1]
        #expect(second.category == "统计学")
        #expect(second.headline.contains("幸存者偏差"))
        #expect(second.links.count == 1)
        #expect(second.links[0].title == "沃德统计学故事")
    }

    @Test("Markdown 纯文本单笔记兜底解析")
    func testParseSingleNoteFallback() {
        let text = """
        为什么飞机的窗户都是圆角的？
        方形窗户在机舱加压时四角会产生巨大应力集中。
        慧星客机空难后，工程师发现尖锐转角是金属疲劳断裂的温床。
        """

        let cards = CardImportEngine.parseMarkdown(text: text, defaultCategory: "工程学")
        #expect(cards.count == 1)
        #expect(cards[0].category == "工程学")
        #expect(cards[0].headline.contains("为什么飞机的窗户都是圆角的"))
        #expect(cards[0].details.contains("慧星客机空难"))
    }

    @Test("标题以数字开头的正文不会被误当序号削掉（3.14 是圆周率 / 2024. 年度总结）")
    func testHeadlineNumberPrefixNotStripped() {
        let cards = CardImportEngine.parseMarkdown(text: "# 3.14 是圆周率\n> 圆周率是无理数。\n祖冲之把它算到小数点后七位。")
        #expect(cards.count == 1)
        #expect(cards[0].headline == "3.14 是圆周率")

        let yearCards = CardImportEngine.parseMarkdown(text: "# 2024. 年度总结\n> 一年的关键结论。\n正文内容。")
        #expect(yearCards.count == 1)
        #expect(yearCards[0].headline == "2024. 年度总结")

        let decimalCards = CardImportEngine.parseMarkdown(text: "# 1.5 倍增长\n> 复利效应。\n正文内容。")
        #expect(decimalCards.count == 1)
        #expect(decimalCards[0].headline == "1.5 倍增长")
    }

    @Test("真正的行首序号前缀仍会被剥离")
    func testRealOrderingPrefixStillStripped() {
        let cards = CardImportEngine.parseMarkdown(text: "# 1. 沉没成本不是成本\n> 摘要。\n正文内容。")
        #expect(cards.count == 1)
        #expect(cards[0].headline == "沉没成本不是成本")
    }

    @Test("去重合并算法能够识别相同 ID 与标准化标题")
    func testDeduplicateAndMerge() {
        let card1 = KnowledgeCard(
            category: "物理",
            headline: "绝对零度永远无法真正达到！",
            summary: "summary 1",
            details: "details 1",
            source: .seed
        )
        let existing = [card1]

        let incomingDuplicate1 = KnowledgeCard(
            id: card1.id,
            category: "物理",
            headline: "完全不同的标题但 ID 相同",
            summary: "summary",
            details: "details",
            source: .imported
        )

        let incomingDuplicate2 = KnowledgeCard(
            category: "物理",
            headline: "绝对零度永远无法真正达到", // 仅标点差异
            summary: "summary",
            details: "details",
            source: .imported
        )

        let incomingNew = KnowledgeCard(
            category: "生物",
            headline: "线粒体是远古细菌的寄生演化",
            summary: "内共生学说",
            details: "真核生物的能量工厂曾经是独立的原核生物。",
            source: .imported
        )

        let (toAdd, dupCount) = CardImportEngine.deduplicateAndMerge(
            existing: existing,
            incoming: [incomingDuplicate1, incomingDuplicate2, incomingNew]
        )

        #expect(toAdd.count == 1)
        #expect(toAdd[0].headline == incomingNew.headline)
        #expect(dupCount == 2)
    }

    @Test("AppStore importCards 能将新导入卡片置顶到待刷卡堆并落盘")
    @MainActor
    func testAppStoreImportAndPromote() async {
        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("KnowFlickTest_\(UUID().uuidString)")
        let storage = Storage(baseDir: tempDir)
        let store = AppStore(storage: storage)

        let initialTop = store.topCard
        let newCard = KnowledgeCard(
            category: "科技",
            headline: "量子纠缠的非局域性验证",
            summary: "爱因斯坦称之为幽灵般的超距作用",
            details: "贝尔不等式的实验验证彻底颠覆了局域实在论。",
            source: .imported
        )

        let result = store.importCards([newCard], insertAtTop: true)
        #expect(result.parsedCards.count == 1)
        #expect(result.duplicateCount == 0)

        // 置顶生效：当前卡堆顶卡即为新导入的卡片
        #expect(store.topCard?.id == newCard.id)
        #expect(store.topCard?.id != initialTop?.id)

        // 验证持久化生效：立即写入并在重载后可读到该卡片
        store.flushPersistence()
        let loaded = storage.loadCards()
        #expect(loaded.contains(where: { $0.id == newCard.id }))

        let reloadedStore = AppStore(storage: storage)
        await reloadedStore.bootstrap()
        #expect(reloadedStore.cards.contains(where: { $0.id == newCard.id }))

        try? FileManager.default.removeItem(at: tempDir)
    }
}
