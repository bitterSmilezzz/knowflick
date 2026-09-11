import Testing
import Foundation
@testable import KnowFlickCore

@Suite("CardExportEngineTests")
struct CardExportEngineTests {

    private func makeSampleCards() -> [KnowledgeCard] {
        [
            KnowledgeCard(
                category: "物理",
                headline: "绝对零度永远无法真正达到",
                summary: "-273.15°C之下没有静止，粒子仍有零点能量。",
                details: "根据热力学第三定律与量子力学不确定性原理，绝对零度是不可达极限。\n\n即使在理论最低温，基态粒子依然存在量子零点振动。",
                links: [ScienceLink(title: "热力学第三定律", url: "https://zh.wikipedia.org/wiki/热力学第三定律")],
                source: .seed,
                masteryLevel: 2
            ),
            KnowledgeCard(
                category: "计算机",
                headline: "过拟合：模型把「背题」当成了「学会」",
                summary: "训练集上满分，新数据上失分。",
                details: "模型记住了训练样本的噪声而非泛化规律，如同学生死记题库。\n\n正则化是应对过拟合的关键手段。",
                links: [],
                source: .ai,
                masteryLevel: 1
            )
        ]
    }

    @Test("Markdown 单文件导出包含 Frontmatter、目录与正文")
    func testExportMarkdownSingleFile() {
        let cards = makeSampleCards()
        let md = CardExportEngine.exportMarkdownSingleFile(cards: cards, title: "测试智库")

        #expect(md.contains("title: \"测试智库\""))
        #expect(md.contains("total_cards: 2"))
        #expect(md.contains("## 📑 目录索引"))
        #expect(md.contains("物理 · 绝对零度永远无法真正达到"))
        #expect(md.contains("计算机 · 过拟合：模型把「背题」当成了「学会」"))
        #expect(md.contains("热力学第三定律"))
        #expect(md.contains("🌱 精选经典"))
        #expect(md.contains("🤖 AI 灵感探索"))
    }

    @Test("Obsidian 独立双链文件集合正确生成文件名、双链与标签")
    func testExportObsidianFiles() {
        let cards = makeSampleCards()
        let items = CardExportEngine.exportObsidianFiles(cards: cards)

        #expect(items.count == 2)
        let physItem = items.first { $0.filename.contains("物理") }
        #expect(physItem != nil)
        if let phys = physItem {
            #expect(phys.content.contains("[[物理]]"))
            #expect(phys.content.contains("tags:"))
            #expect(phys.content.contains("- knowflick"))
            #expect(phys.content.contains("- 物理"))
            #expect(phys.content.contains("热力学第三定律"))
        }

        let compItem = items.first { $0.filename.contains("计算机") }
        #expect(compItem != nil)
        if let comp = compItem {
            #expect(comp.content.contains("[[计算机]]"))
            #expect(comp.content.contains("过拟合"))
        }
    }

    @Test("Anki TSV 牌组导出规范与制表符字段校验")
    func testExportAnkiTSV() {
        let cards = makeSampleCards()
        let tsv = CardExportEngine.exportAnkiTSV(cards: cards)
        let lines = tsv.components(separatedBy: "\n")

        #expect(lines.count == 2)
        for line in lines {
            let fields = line.components(separatedBy: "\t")
            #expect(fields.count == 3)
            let front = fields[0]
            let back = fields[1]
            let tags = fields[2]

            #expect(front.contains("<span"))
            #expect(back.contains("<div"))
            #expect(tags.contains("knowflick"))
        }

        #expect(lines[0].contains("经典精选"))
        #expect(lines[0].contains("已掌握"))
        #expect(lines[1].contains("AI探索"))
    }

    @Test("JSON 导出失败必须抛出，调用方可识别失败而非收到静默的 []")
    func testExportToJSONThrowsInsteadOfSilentEmptyArchive() throws {
        // 缺陷形态：旧实现签名是 `([KnowledgeCard]) -> String`，用 try? 吞掉编码错误并返回 "[]"，
        // 调用方只能 toast「已成功导出」。修复后签名必须为 throws，失败才能走到失败分支。
        let isThrowingSignature = type(of: CardExportEngine.exportToJSON) == (([KnowledgeCard]) throws -> String).self
        #expect(isThrowingSignature)

        // 成功路径依然可用，且不会退化成空归档
        let cards = makeSampleCards()
        let json = try CardExportEngine.exportToJSON(cards: cards)
        #expect(json != "[]")

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decoded = try decoder.decode([KnowledgeCard].self, from: Data(json.utf8))
        #expect(decoded.count == cards.count)
        #expect(decoded[0].headline == cards[0].headline)
    }

    @Test("JSON 归档数据可反序列化还原")
    func testExportJSONArchiveRoundTrip() throws {
        let cards = makeSampleCards()
        let data = try CardExportEngine.exportJSONArchive(cards: cards)

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decoded = try decoder.decode([KnowledgeCard].self, from: data)

        #expect(decoded.count == 2)
        #expect(decoded[0].headline == cards[0].headline)
        #expect(decoded[1].category == cards[1].category)
    }
}
