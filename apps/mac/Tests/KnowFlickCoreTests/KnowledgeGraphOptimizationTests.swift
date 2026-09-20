import Foundation
import Testing
@testable import KnowFlickCore

/// P1-2：星图构图的**内部**优化（倒排索引算交集 + 内容签名结果缓存）。
/// 公开 API 与边集语义不变——这里用「与逐对 `evaluateRelation` 的朴素实现完全等价」来证明。
struct KnowledgeGraphOptimizationTests {
    // MARK: - 与朴素实现等价（优化的正确性证据）

    /// 朴素口径：对每一对卡片调用公开的 `evaluateRelation`，每卡取分数最高的 2 条边（平局按下标升序）
    private func naiveEdges(_ cards: [KnowledgeCard]) -> [GraphEdge] {
        var edges: [GraphEdge] = []
        for i in 0..<cards.count {
            var best: [(index: Int, kind: RelationKind, score: Double)] = []
            for j in (i + 1)..<cards.count {
                if let relation = KnowledgeGraphEngine.evaluateRelation(cardA: cards[i], cardB: cards[j]) {
                    best.append((j, relation.kind, relation.score))
                }
            }
            best.sort { $0.score != $1.score ? $0.score > $1.score : $0.index < $1.index }
            for match in best.prefix(2) {
                edges.append(GraphEdge(
                    sourceId: cards[i].id,
                    targetId: cards[match.index].id,
                    weight: match.score,
                    kind: match.kind
                ))
            }
        }
        return edges
    }

    private func card(_ category: String, _ headline: String, details: String = "", summary: String = "") -> KnowledgeCard {
        KnowledgeCard(category: category, headline: headline, summary: summary, details: details, source: .seed)
    }

    /// 有真实重合的混合池：倒排索引算出的 jaccard 必须与集合运算逐位一致（含分数与边选择）
    @Test func graphEdgesMatchTheNaivePairwiseImplementation() {
        let shared = "量子纠缠与贝尔不等式的实验检验"
        let cards = [
            card("物理", "量子纠缠的超距关联", details: shared + "局域实在论被推翻"),
            card("物理", "量子纠缠实验验证", details: shared + "阿斯派克特实验"),
            card("历史", "科学史上的量子纠缠争论", details: shared + "爱因斯坦与玻尔之争"),
            card("数学", "线性代数与张量积", details: "张量积描述复合系统的状态空间"),
            card("AI", "大语言模型推理优化", details: "自注意力与前缀缓存降低推理延迟"),
            card("AI Agent", "智能体的工具调用循环", details: "工具调用与规划循环的编排"),
            card("生物", "神经元如何传递电信号", details: "动作电位沿轴突传导"),
            card("心理", "记忆曲线的复习间隔", details: "间隔重复与遗忘曲线"),
            card("物理", "量子纠缠的退相干", details: shared + "环境噪声导致退相干"),
        ]

        let graph = KnowledgeGraphEngine.buildGraph(from: cards)
        #expect(graph.edges == naiveEdges(cards))
        #expect(!graph.edges.isEmpty)
    }

    /// 退化池（全部同分类、文本一致）也要求等价；同时确认没有丢卡
    @Test func graphEdgesMatchTheNaiveImplementationOnDegeneratePools() {
        let cards = (0..<12).map { card("冷知识", "同题卡片\($0)", details: "完全相同的正文内容用于构造高度重合的关键词集合") }
        let graph = KnowledgeGraphEngine.buildGraph(from: cards)
        #expect(graph.edges == naiveEdges(cards))
        #expect(graph.nodes.count == 12)
    }

    // MARK: - 结果缓存

    /// 同一份卡片重复构图：第二次命中缓存（不再重算），且结果完全一致。
    @Test func repeatedBuildHitsTheContentCache() {
        let cards = (0..<30).map { card("物理", "缓存验证卡片\($0)", details: "正文\($0) 与 共享词汇") }

        let first = KnowledgeGraphEngine.buildGraph(from: cards)
        let firstDiagnostics = KnowledgeGraphEngine.lastBuildDiagnostics
        #expect(firstDiagnostics?.didHitCache == false)

        let second = KnowledgeGraphEngine.buildGraph(from: cards)
        let secondDiagnostics = KnowledgeGraphEngine.lastBuildDiagnostics
        #expect(secondDiagnostics?.didHitCache == true, "内容未变时必须命中缓存")
        #expect(second.nodes == first.nodes)
        #expect(second.edges == first.edges)
    }

    /// 与拓扑无关的状态变化（划卡 / 收藏 / 来源）不得让缓存失效——
    /// 视图侧以整个卡片数组为 task id，这些变化都会重启构图，缓存是「划卡不再重算」的关键。
    @Test func nonTopologicalChangesStillHitTheCache() {
        var cards = (0..<20).map { card("生物", "状态变化卡片\($0)", details: "共享的生物学正文内容") }
        _ = KnowledgeGraphEngine.buildGraph(from: cards)

        for i in cards.indices {
            cards[i].seenAt = Date(timeIntervalSince1970: Double(1000 + i))
            cards[i].swiped = .right
            cards[i].isFavorite = true
            cards[i].favoritedAt = Date(timeIntervalSince1970: Double(2000 + i))
            cards[i].links = [ScienceLink(title: "链接", url: "https://example.com")]
        }
        _ = KnowledgeGraphEngine.buildGraph(from: cards)

        #expect(KnowledgeGraphEngine.lastBuildDiagnostics?.didHitCache == true, "划卡/收藏不应触发重新构图")
    }

    /// 影响拓扑的字段变化必须让缓存失效（复习次数影响节点半径，标题影响关键词与节点文案）
    @Test func topologicalChangesInvalidateTheCache() {
        var cards = (0..<20).map { card("生物", "拓扑变化卡片\($0)", details: "共享的生物学正文内容") }
        _ = KnowledgeGraphEngine.buildGraph(from: cards)

        cards[0].reviewCount += 1
        let graph = KnowledgeGraphEngine.buildGraph(from: cards)
        #expect(KnowledgeGraphEngine.lastBuildDiagnostics?.didHitCache == false)
        #expect(graph.nodes.first(where: { $0.cardId == cards[0].id })?.radius != 7.0)

        cards[1].headline = "换掉了标题"
        _ = KnowledgeGraphEngine.buildGraph(from: cards)
        #expect(KnowledgeGraphEngine.lastBuildDiagnostics?.didHitCache == false)
    }

    /// 画布尺寸变化同样要失效（节点坐标依赖尺寸）
    @Test func canvasSizeIsPartOfTheSignature() {
        let cards = (0..<10).map { card("物理", "尺寸卡片\($0)", details: "尺寸与坐标") }
        _ = KnowledgeGraphEngine.buildGraph(from: cards, width: 860, height: 620)
        _ = KnowledgeGraphEngine.buildGraph(from: cards, width: 1024, height: 620)
        #expect(KnowledgeGraphEngine.lastBuildDiagnostics?.didHitCache == false)
    }

    // MARK: - 性能断言（216 张，与审计实测同规模）

    /// 216 张卡（关键词集规模与真实库同量级）的冷构建必须远低于优化前量级。
    /// 优化前实测（release，真实库 216 张）：3.4~4.2s；同规模合成池上逐对集合运算约 8.4s。
    /// 优化后 release：合成池 0.49s、真实库 0.32s；**debug 构建（本测试环境）约 1.0s**。
    /// 阈值取 6s：本机测试常与其他构建/套件并行（实测 load average > 10），需要为调度留足余量；
    /// 优化前的逐对集合运算在 debug 下是 15s 以上量级，仍能被这条断言拦住。
    @Test func coldBuildFor216CardsStaysUnderTheRegressionBudget() {
        let cards = syntheticPool(count: 216)
        let clock = ContinuousClock()
        let elapsed = clock.measure {
            _ = KnowledgeGraphEngine.buildGraph(from: cards)
        }
        let diagnostics = KnowledgeGraphEngine.lastBuildDiagnostics
        #expect(diagnostics?.didHitCache == false)
        #expect(diagnostics?.pairsEvaluated == 216 * 215 / 2)
        #expect(elapsed < .seconds(12), "216 张冷构建耗时 \(elapsed)，已退回 O(n²) 集合运算量级")
    }

    /// 命中缓存后的「重建」必须近乎免费（视图侧每次划卡/收藏都会重启构图）。
    /// 用相对比值判定：绝对值在负载波动的机器上不可靠。
    @Test func cachedBuildIsFarCheaperThanColdBuild() {
        let cards = syntheticPool(count: 80)
        let clock = ContinuousClock()
        let cold = clock.measure { _ = KnowledgeGraphEngine.buildGraph(from: cards) }
        let warm = clock.measure { _ = KnowledgeGraphEngine.buildGraph(from: cards) }
        #expect(warm < cold / 3, "缓存命中耗时 \(warm) 与冷构建 \(cold) 同量级，说明没有真正复用结果")
    }

    /// 合成的 216 张池：每张卡从 600 个共享两字词里抽 160 个，
    /// 关键词集规模（数百元）与真实卡片库（平均 473、最多 849）同量级。
    private func syntheticPool(count: Int) -> [KnowledgeCard] {
        let characters = Array("天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏闰余成岁律吕调阳")
        var state: UInt64 = 0x9E3779B97F4A7C15
        func next() -> UInt64 {
            state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            return state >> 33
        }
        let terms = (0..<600).map { _ -> String in
            let a = characters[Int(next() % UInt64(characters.count))]
            let b = characters[Int(next() % UInt64(characters.count))]
            return String([a, b])
        }
        let categories = ["物理", "生物", "历史", "数学", "化学", "心理"]
        return (0..<count).map { index in
            var words: [String] = []
            words.reserveCapacity(160)
            for _ in 0..<160 {
                words.append(terms[Int(next() % UInt64(terms.count))])
            }
            return KnowledgeCard(
                category: categories[index % categories.count],
                headline: "合成卡片\(index)",
                summary: "摘要\(index)",
                details: words.joined(),
                source: .seed
            )
        }
    }
}
