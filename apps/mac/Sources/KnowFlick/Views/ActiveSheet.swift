import SwiftUI
import KnowFlickCore

// 模态弹窗路由（自 InsightMainView.swift 拆出）。

/// 模态弹窗类型（统一入口，彻底杜绝 macOS SwiftUI 多 sheet 链式挂载相互覆盖失效）
//
// 收藏 / 统计 / 历史已统一为侧栏目的地导航（InsightDestination）。
// `.favorites` / `.stats` / `.history` 三个 case 保留为**纯路由信号**：
// menubar（MacCommands.swift，按约定不改动）仍发送这三个 case，由 `route(_:)` 拦截
// 重定向到目的地导航，因此它们不会到达 sheetContent——favorites/stats 在 sheetContent
// 中只保留穷举所需的不可达空分支，HistoryView 只从统计页分类下钻以局部 sheet 打开。
enum ActiveSheet: Identifiable {
    case detail(KnowledgeCard)
    case sharePoster(KnowledgeCard)
    /// 路由信号：menubar「知识收藏阁」→ 重定向到收藏目的地
    case favorites
    case settings
    /// 路由信号：menubar「学习统计分析」→ 重定向到统计目的地
    case stats
    /// 路由信号：menubar「浏览历史足迹」→ 重定向到历史目的地
    case history
    case help
    case quiz(category: String?)
    case graph
    case chat(KnowledgeCard)
    case search
    case exportCards([KnowledgeCard]?)
    case importNotes
    case webClip
    case plannedReview([KnowledgeCard])
    case editCard(KnowledgeCard)
    case sync
    case speechConsole

    var id: String {
        switch self {
        case .detail(let card): return "detail_\(card.id.uuidString)"
        case .sharePoster(let card): return "poster_\(card.id.uuidString)"
        case .favorites: return "favorites"
        case .settings: return "settings"
        case .stats: return "stats"
        case .history: return "history"
        case .help: return "help"
        case .quiz(let cat): return "quiz_\(cat ?? "all")"
        case .graph: return "graph"
        case .chat(let card): return "chat_\(card.id.uuidString)"
        case .search: return "search"
        case .exportCards: return "exportCards"
        case .importNotes: return "importNotes"
        case .webClip: return "webClip"
        case .plannedReview: return "plannedReview"
        case .editCard(let card): return "edit_\(card.id)"
        case .sync: return "sync"
        case .speechConsole: return "speechConsole"
        }
    }
}

