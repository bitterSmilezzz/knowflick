import Foundation
import Testing
@testable import KnowFlickCore

@Suite("KnowledgeSearchEngineTests")
struct KnowledgeSearchEngineTests {
    let testCards: [KnowledgeCard] = [
        KnowledgeCard(
            category: "会计",
            headline: "新租赁准则下承租人不再区分经营融资租赁",
            summary: "表外租机队终于上了资产负债表，一律确认使用权资产和租赁负债。",
            details: "依据CAS 21准则要求承租人采用单一模型，除短期和低价值资产外，全部进入资产负债表核算。",
            links: [ScienceLink(title: "财政部会计司规范", url: "https://kjs.mof.gov.cn")],
            source: .seed,
            createdAt: Date(timeIntervalSince1970: 1000)
        ),
        KnowledgeCard(
            category: "物理",
            headline: "量子纠缠的非定域性挑战爱因斯坦定域实在论",
            summary: "幽灵般的超距作用在贝尔不等式实验检验中被反复确证。",
            details: "爱因斯坦波多尔斯基罗森佯谬（EPR悖论）试图论证量子力学不完备，但后来的Aspect实验否定了隐变量假设。",
            links: [ScienceLink(title: "物理学年鉴文献", url: "https://phys.org")],
            source: .ai,
            createdAt: Date(timeIntervalSince1970: 2000)
        ),
        KnowledgeCard(
            category: "计算机",
            headline: "时间复杂度O(1)的LRU缓存基于双向链表与哈希表",
            summary: "最近最少使用淘汰策略在操作系统页表和Redis中极其普遍。",
            details: "哈希表定位节点耗时O(1)，双向链表调整头尾指针耗时O(1)，两相配合实现极速存取与驱逐。",
            links: [],
            source: .seed,
            createdAt: Date(timeIntervalSince1970: 3000),
            swiped: .right,
            isFavorite: true
        )
    ]

    let engine = KnowledgeSearchEngine()

    @Test func testEmptyQueryReturnsNothingSoGuideIsReachable() {
        // 空查询返回空结果：视图据此渲染引导页与搜索建议按钮（此前返回 40 条导致引导页永久不可达）
        let results = engine.search(query: "", in: testCards)
        #expect(results.isEmpty)

        let blankResults = engine.search(query: "   \n ", in: testCards)
        #expect(blankResults.isEmpty)
    }

    @Test func testEmptyQueryStillHonoursCategoryAndSourceFilters() {
        // 过滤维度本身仍要正确：先按查询词命中，再验证过滤生效
        let categoryResults = engine.search(query: "O", category: "计算机", in: testCards)
        #expect(categoryResults.allSatisfy { $0.card.category == "计算机" })

        let seedResults = engine.search(query: "O", source: .seed, in: testCards)
        #expect(seedResults.allSatisfy { $0.card.source == .seed })

        let aiResults = engine.search(query: "量子", source: .ai, in: testCards)
        #expect(aiResults.count == 1)
        #expect(aiResults.first?.card.category == "物理")

        let favResults = engine.search(query: "LRU", source: .favorites, in: testCards)
        #expect(favResults.count == 1)
        #expect(favResults.first?.card.category == "计算机")
    }

    @Test func testCaseInsensitiveDetailsMatchDoesNotCrash() {
        // 大小写不敏感查找在原字符串上进行：小写化会改变长度的字符（İ）不应触发索引越界
        let card = KnowledgeCard(
            category: "语言",
            headline: "İstanbul 的拼写与土耳其语点式大写 I",
            summary: "土耳其语有带点与不带点两种 I，大小写转换规则与其他语言不同。",
            details: "在土耳其语中，İ 小写化后是 i，而 I 小写化后是 ı；跨 lowercased() 副本传递 String.Index 会因长度变化而崩溃。",
            links: [],
            source: .seed
        )
        let results = engine.search(query: "İ", in: [card])
        #expect(!results.isEmpty)
        #expect(results.first?.card.category == "语言")
    }

    @Test func testHeadlineDirectMatch() {
        let results = engine.search(query: "量子纠缠", in: testCards)
        #expect(!results.isEmpty)
        #expect(results.first?.card.category == "物理")
        #expect(results.first?.matchedField == .headline)
        #expect(results.first?.score ?? 0 >= 80)
    }

    @Test func testPinyinHeadlineMatch() {
        // "xzl" matches "新租赁"
        let results = engine.search(query: "xzl", in: testCards)
        #expect(!results.isEmpty)
        #expect(results.first?.card.category == "会计")
        #expect(results.first?.matchedField == .headline)
    }

    @Test func testPinyinFullWordMatch() {
        // "zulin" matches "租赁"
        let results = engine.search(query: "zulin", in: testCards)
        #expect(!results.isEmpty)
        #expect(results.first?.card.category == "会计")
    }

    @Test func testCategoryMatch() {
        let results = engine.search(query: "会计", in: testCards)
        #expect(!results.isEmpty)
        #expect(results.first?.card.category == "会计")
    }

    @Test func testDetailsSnippetExtraction() {
        // "EPR" only exists in details of card 2
        let results = engine.search(query: "EPR", in: testCards)
        #expect(!results.isEmpty)
        #expect(results.first?.card.category == "物理")
        #expect(results.first?.matchedField == .details)
        #expect(results.first?.matchedExcerpt.contains("EPR") == true)
    }

    @Test func testRankHeadlineHigherThanDetails() {
        // If a query appears in both cards or different fields, headline has higher score
        let cardWithWordInDetails = KnowledgeCard(
            category: "历史",
            headline: "古代罗马军团体制与后勤革新",
            summary: "道路网建设为军团迅速调动提供支撑。",
            details: "军团采用LRU方式管理仓库给养补给，优先消耗陈粮。",
            links: [],
            source: .seed
        )
        let combined = testCards + [cardWithWordInDetails]
        let results = engine.search(query: "LRU", in: combined)
        #expect(results.count == 2)
        #expect(results[0].card.category == "计算机") // headline contains LRU
        #expect(results[1].card.category == "历史")   // details contains LRU
        #expect(results[0].score > results[1].score)
    }
}
