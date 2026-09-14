import Foundation
import Testing
@testable import KnowFlickCore

/// 卡堆「严格防重排布」算法与主题键解析的承诺级测试。
/// README / CONTEXT 对该算法做出强产品承诺（连续两张卡背景绝不同图），这里是唯一防线。
struct CardThemeResolverTests {
    private func card(_ category: String, _ headline: String) -> KnowledgeCard {
        KnowledgeCard(category: category, headline: headline, summary: "摘要", details: "正文", source: .seed,
                      createdAt: Date(timeIntervalSince1970: 1_000_000))
    }

    @Test func allKeysCoverExactlyFortyTwoThemes() {
        #expect(CardThemeResolver.allKeys.count == 42)
        #expect(Set(CardThemeResolver.allKeys).count == 42)
    }

    @Test func deterministicHashIsStableAcrossCalls() {
        // FNV-1a 64 位参考向量：任何实现变更都必须显式确认迁移成本
        #expect(CardThemeResolver.deterministicHash("knowflick") == 10_604_710_463_354_862_449)
        #expect(CardThemeResolver.deterministicHash("量子纠缠") == 18_303_554_525_994_447_684)
        #expect(CardThemeResolver.deterministicHash("") == 14_695_981_039_346_656_037)
    }

    @Test func resolveKeyIsDeterministicAndWithinAllKeys() {
        let inputs = [("物理", "量子纠缠的超距关联"), ("中级会计", "存货跌价准备"), ("AI Agent", "工具调用循环"), ("未知分类xyz", "完全陌生的标题")]
        for (category, headline) in inputs {
            let first = CardThemeResolver.resolveKey(category: category, headline: headline, summary: "")
            let second = CardThemeResolver.resolveKey(category: category, headline: headline, summary: "")
            #expect(first == second)
            #expect(CardThemeResolver.allKeys.contains(first))
        }
    }

    @Test func resolveKeyFollowsSemanticKeywords() {
        #expect(CardThemeResolver.resolveKey(category: "冷知识", headline: "神经元如何传递电信号", summary: "") == "neuroscience")
        // 会计分支的「折旧」关键词归入数理（math）池，这是既有口径
        #expect(CardThemeResolver.resolveKey(category: "中级会计", headline: "固定资产折旧方法", summary: "") == "math")
        #expect(CardThemeResolver.resolveKey(category: "中级会计", headline: "负债表的结构与骨架", summary: "") == "architecture")
        #expect(CardThemeResolver.resolveKey(category: "物理", headline: "量子力学", summary: "") == "quantum")
        #expect(CardThemeResolver.resolveKey(category: "冷知识", headline: "火山喷发与岩石循环", summary: "") == "geology")
        #expect(CardThemeResolver.resolveKey(category: "AI Agent", headline: "多智能体协作编排", summary: "") == "robotics")
    }

    @Test func arrangeKeepsSameKeyAtLeastMinDistanceApart() {
        // 六大学科 × 34 张混合池（标题无语义关键词 → 42 键哈希兜底，多样性充足）：
        // 核心承诺「同 key 间隔 >= 5」恒成立
        let subjects = ["物理", "生物", "历史", "心理", "数学", "化学"]
        var pool: [KnowledgeCard] = []
        for index in 0..<204 {
            pool.append(card(subjects[index % subjects.count], "混合池卡片标题\(index)"))
        }
        let arranged = CardThemeResolver.arrangeWithMinDistance(pool, minDistance: 5)
        #expect(arranged.count == pool.count)
        let keys = arranged.map { CardThemeResolver.resolveKey(for: $0) }
        var lastSeen: [String: Int] = [:]
        for (index, key) in keys.enumerated() {
            if let previous = lastSeen[key] {
                #expect(index - previous >= 5, "key \(key) 在 \(previous) 与 \(index) 间隔不足 5")
            }
            lastSeen[key] = index
        }
    }

    @Test func arrangeDegradesGracefullyWhenAllCardsShareOneKey() {
        // 全部标题含「量子纠缠」→ 同一 quantum key，minDistance=5 不可达，必须优雅降级
        let pool = (0..<40).map { card("冷知识", "量子纠缠退化输入\($0)") }
        #expect(CardThemeResolver.resolveKey(for: pool[0]) == "quantum")
        let arranged = CardThemeResolver.arrangeWithMinDistance(pool, minDistance: 5)
        #expect(arranged.count == pool.count)
        #expect(Set(arranged.map(\.id)).count == pool.count)
    }

    @Test func arrangeHandlesDegenerateInputs() {
        #expect(CardThemeResolver.arrangeWithMinDistance([], minDistance: 5).isEmpty)
        let single = [card("物理", "单卡输入")]
        #expect(CardThemeResolver.arrangeWithMinDistance(single, minDistance: 5).first?.id == single[0].id)
        // minDistance 为 0 或负数：不应崩溃，且完整保留卡池
        let pool = (0..<10).map { card("历史", "零距离输入\($0)") }
        #expect(CardThemeResolver.arrangeWithMinDistance(pool, minDistance: 0).count == pool.count)
        #expect(CardThemeResolver.arrangeWithMinDistance(pool, minDistance: -3).count == pool.count)
    }

    @Test func arrangeAvoidsTopKeyOnFirstCardWhenFeasible() {
        // 首张卡必须避开 avoidingTopKey：两个 key 差异明显的语义池验证
        let poolA = (0..<20).map { card("冷知识", "量子纠缠避开验证\($0)") }
        let poolB = (0..<20).map { card("冷知识", "火山喷发避开验证\($0)") }
        #expect(CardThemeResolver.resolveKey(for: poolA[0]) == "quantum")
        #expect(CardThemeResolver.resolveKey(for: poolB[0]) == "geology")
        let arranged = CardThemeResolver.arrangeWithMinDistance(poolA + poolB, minDistance: 5, avoidingTopKey: "quantum")
        #expect(CardThemeResolver.resolveKey(for: arranged[0]) == "geology")
    }

    @Test func arrangeWithZeroMinDistancePreservesAllCards() {
        let pool = (0..<12).map { card("心理", "零距离保序\($0)") }
        let arranged = CardThemeResolver.arrangeWithMinDistance(pool, minDistance: 0)
        #expect(Set(arranged.map(\.id)) == Set(pool.map(\.id)))
    }
}
