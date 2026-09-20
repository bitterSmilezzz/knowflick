import Testing
import Foundation
@testable import KnowFlickCore

@Suite("CardChatInsightDeriverTests")
struct CardChatInsightDeriverTests {

    private func makeParentCard() -> KnowledgeCard {
        KnowledgeCard(
            category: "物理学",
            headline: "量子纠缠与信息守恒",
            summary: "量子隐形传态并不违反相对论光速上限",
            details: "长文详情...",
            links: [ScienceLink(title: "量子纠缠", url: "https://zh.wikipedia.org/wiki/量子纠缠")],
            source: .ai
        )
    }

    @Test("deriveCard 从包含 Markdown 标题的追问回答中提取新卡片")
    func deriveCardExtractsFromMarkdownHeading() {
        let parent = makeParentCard()
        let assistantReply = """
        ## EPR 佯谬的世纪反转

        爱因斯坦曾质疑量子纠缠是「鬼魅般的超距作用」，认为量子力学是不完备的。

        贝尔不等式的提出与阿斯佩实验彻底证实了量子非定域性。现实中的量子通信正是基于这一原理保障绝对安全。
        """

        let derived = CardChatInsightDeriver.deriveCard(from: assistantReply, parentCard: parent)

        #expect(derived.headline == "EPR 佯谬的世纪反转")
        #expect(derived.category == "物理学")
        #expect(derived.summary.contains("爱因斯坦曾质疑量子纠缠"))
        #expect(derived.details == assistantReply.trimmingCharacters(in: .whitespacesAndNewlines))
        #expect(derived.source == .ai)
        #expect(!derived.links.isEmpty)
    }

    @Test("deriveCard 从首句断句中提取标题")
    func deriveCardExtractsFromFirstSentence() {
        let parent = makeParentCard()
        let reply = "量子隐形传态的本质是量子态传输。它并不传递经典物质，而是传递未知量子态的全部信息。"

        let derived = CardChatInsightDeriver.deriveCard(from: reply, parentCard: parent)

        #expect(derived.headline == "量子隐形传态的本质是量子态传输")
        #expect(derived.category == "物理学")
    }

    @Test("deriveCard 在无明显结构时以父卡片标题优雅兜底")
    func deriveCardFallbackToParentHeadline() {
        let parent = makeParentCard()
        let reply = "是。"

        let derived = CardChatInsightDeriver.deriveCard(from: reply, parentCard: parent)

        #expect(derived.headline.contains("量子纠缠与信息守恒"))
    }

    @Test("exportMarkdown 能够生成格式清晰完整的 Markdown 对话笔记")
    func exportMarkdownFormatsSession() {
        let parent = makeParentCard()
        let userMsg = CardChatMessage(sender: .user, content: "什么是贝尔不等式？")
        let assistantMsg = CardChatMessage(sender: .assistant, content: "贝尔不等式是由约翰·贝尔提出的数学定理...")
        let session = CardChatSession(
            cardId: parent.id,
            cardHeadline: parent.headline,
            messages: [userMsg, assistantMsg]
        )

        let md = CardChatInsightDeriver.exportMarkdown(session: session, parentCard: parent)

        #expect(md.contains("# 《量子纠缠与信息守恒》AI 伴学追问记录"))
        #expect(md.contains("- **所属分类**：物理学"))
        #expect(md.contains("### 🙋 你"))
        #expect(md.contains("什么是贝尔不等式？"))
        #expect(md.contains("### 🤖 KnowFlick 伴学导师"))
        #expect(md.contains("贝尔不等式是由约翰·贝尔提出的数学定理"))
    }

    @Test("suggestFollowUps 能够根据回答语境推演高质启发追问")
    func suggestFollowUpsContextual() {
        let parent = makeParentCard()

        let expReply = "1982 年阿兰·阿斯佩通过精确的光子偏振实验验证了贝尔不等式的破缺..."
        let expSuggestions = CardChatInsightDeriver.suggestFollowUps(for: expReply, parentCard: parent)
        #expect(expSuggestions.count == 3)
        #expect(expSuggestions.contains(where: { $0.contains("实验") || $0.contains("验证") }))

        let mechReply = "量子态叠加与波函数坍缩的数学算法机制如下..."
        let mechSuggestions = CardChatInsightDeriver.suggestFollowUps(for: mechReply, parentCard: parent)
        #expect(mechSuggestions.count == 3)
        #expect(mechSuggestions.contains(where: { $0.contains("机制") || $0.contains("比喻") }))
    }
}
