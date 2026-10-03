import Foundation
import KnowFlickCore
import Testing
@testable import KnowFlick

/// app 层测试 target 的起步用例（Wave C2）：只覆盖不依赖窗口/渲染循环的纯逻辑，
/// 不引入任何需要等待 UI、窗口或时序的断言——这是 target 能稳定跑在 CI 上的前提。
///
/// 首个对象是 `ActiveSheet` 模态路由：它的 `id` 是 SwiftUI `.sheet(item:)` 的
/// 身份判据，同一张卡的不同用途（详情 / 海报 / 追问 / 编辑）必须给出互不相同的 id，
/// 否则会出现「打开追问却弹出编辑」这类路由覆盖故障，而这类 bug 无法靠编译发现。
struct ActiveSheetRoutingTests {
    private func card(_ headline: String) -> KnowledgeCard {
        KnowledgeCard(category: "冷知识", headline: headline, summary: "摘要", details: "详情", source: .imported)
    }

    /// 同一张卡的不同用途必须得到不同 id（sheet(item:) 靠它区分路由）。
    @Test func sameCardInDifferentRolesGetsDistinctIds() {
        let subject = card("同一张卡")
        let ids: Set<String> = [
            ActiveSheet.detail(subject).id,
            ActiveSheet.sharePoster(subject).id,
            ActiveSheet.chat(subject).id,
            ActiveSheet.editCard(subject).id
        ]
        #expect(ids.count == 4, "同卡不同用途的 sheet id 不得碰撞，实际 \(ids)")
    }

    /// 不同卡片在同一用途下 id 必须不同（否则第二张卡不会重新触发 sheet）。
    @Test func differentCardsNeverShareAnId() {
        let first = card("第一张"), second = card("第二张")
        #expect(ActiveSheet.detail(first).id != ActiveSheet.detail(second).id)
        #expect(ActiveSheet.chat(first).id != ActiveSheet.chat(second).id)
        #expect(ActiveSheet.sharePoster(first).id != ActiveSheet.sharePoster(second).id)
        #expect(ActiveSheet.editCard(first).id != ActiveSheet.editCard(second).id)
    }

    /// 无关联数据的路由 id 是稳定字面量（往返一致、不随调用变化）。
    @Test func plainRouteIdsAreStableLiterals() {
        let plain: [ActiveSheet] = [.settings, .help, .search, .importNotes, .webClip, .sync, .speechConsole, .favorites, .stats, .history, .graph]
        let first = plain.map(\.id)
        let second = plain.map(\.id)
        #expect(first == second, "同一路由的 id 必须可重复取得（往返一致）")
        #expect(Set(first).count == plain.count, "无关联数据的路由 id 不得互相碰撞：\(first)")
        // 参数化路由的 id 必须带上参数（分类 / 空分类两种形态也不得碰撞）
        #expect(ActiveSheet.quiz(category: nil).id != ActiveSheet.quiz(category: "AI").id)
        #expect(ActiveSheet.quiz(category: "AI").id == ActiveSheet.quiz(category: "AI").id)
        // 关联卡片的 id 必须带上卡 id，而不是只区分用途
        let subject = card("往返")
        #expect(ActiveSheet.detail(subject).id.contains(subject.id.uuidString))
    }
}
