import Foundation
import Testing
@testable import KnowFlickCore

struct KnowledgeGraphTests {
    private func card(_ category: String, _ title: String) -> KnowledgeCard {
        KnowledgeCard(category: category, headline: title, summary: "", details: "", source: .seed)
    }

    @Test func disciplineAffinityIsSymmetric() throws {
        let a = card("生态", "森林"), b = card("生物", "细胞")
        let forward = try #require(KnowledgeGraphEngine.evaluateRelation(cardA: a, cardB: b))
        let reverse = try #require(KnowledgeGraphEngine.evaluateRelation(cardA: b, cardB: a))
        #expect(forward.kind == reverse.kind)
        #expect(forward.score == reverse.score)
    }

    @Test func graphUsesStableIdentitiesAndValidEdgeEndpoints() {
        let cards = [card("AI", "神经网络"), card("AI", "机器学习"), card("数学", "线性代数")]
        let first = KnowledgeGraphEngine.buildGraph(from: cards)
        let second = KnowledgeGraphEngine.buildGraph(from: cards)
        #expect(first.nodes == second.nodes)
        #expect(first.edges == second.edges)
        let ids = Set(first.nodes.map(\.id))
        #expect(ids == Set(cards.map(\.id)))
        for edge in first.edges {
            #expect(ids.contains(edge.sourceId) && ids.contains(edge.targetId))
            #expect(edge.sourceId != edge.targetId)
        }
        for node in first.nodes {
            #expect(node.connectionsCount == first.edges.filter { $0.sourceId == node.id || $0.targetId == node.id }.count)
        }
    }

    @Test func emptyAndSingleCardGraphsHaveNoEdges() {
        #expect(KnowledgeGraphEngine.buildGraph(from: []).nodes.isEmpty)
        #expect(KnowledgeGraphEngine.buildGraph(from: [card("AI", "单卡")]).edges.isEmpty)
    }

    @Test func relatedCardsRejectNonpositiveLimitsAndExcludeSelf() {
        let a = card("AI", "甲"), b = card("AI", "乙")
        #expect(KnowledgeGraphEngine.findRelatedCards(for: a, in: [a, b], limit: -1).isEmpty)
        #expect(KnowledgeGraphEngine.findRelatedCards(for: a, in: [a, b], limit: 1).map(\.id) == [b.id])
    }
}
