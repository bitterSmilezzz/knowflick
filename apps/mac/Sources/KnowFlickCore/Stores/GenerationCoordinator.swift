import Foundation
import Observation

/// AI 生成编排（Wave C2）：并发守卫、等待计时、排除列表装配、自动补卡触发。
///
/// 为什么单独成类型：`AppStore` 原先把「生成域」的状态（`isGenerating` /
/// `generationStartedAt` / `lastError`）与流程（重入守卫、拼 exclude、调 AIService、
/// 追加卡片、落盘、24h 节流）全挤在两个方法里——生成是跨「卡片池 / 设置 / 网络」的
/// 一件事，却没有任何一个类型为它负责。搬到这里之后状态与流程集中在一处，
/// `AppStore` 只留同名薄转发（视图与测试零改动）。
///
/// 线程纪律：本类型 `@MainActor`；卡片池与设置的读写经 `Dependencies` 注入的回调，
/// 所有权与落盘纪律仍归 `AppStore` / `CardLibraryStore`——这里不直接碰磁盘。
///
/// 行为契约（Wave A 语义与既有测试逐条保持）：
/// - 生成中重入直接返回，不产生第二次请求，也不重复追加；
/// - exclude 列表 = 当前卡片池的**全部**标题（截断上限由 `AIService` 单点决定）；
/// - 成功后追加卡片并落盘、清空 `lastError`；失败只写 `lastError`，卡片池不动；
/// - 自动补卡 24h 节流：`lastAutoTopUpAt` 为 nil 或距上次 ≥ 24h 才放行；
///   成功失败都记入窗口（失败的请求也可能已产生费用，网络异常时不该每次启动都空打）。
@MainActor
@Observable
public final class GenerationCoordinator {
    /// 生成中标志：并发守卫的判据，视图也据此禁用生成/换一批按钮
    public var isGenerating = false
    /// 本轮生成开始的时间（`isGenerating` 置 false 时清空）：等待反馈要显示「已等多久」
    ///（ui-research 共识 9：≥2s 的等待需要可见进度），视图据此计算流逝秒数。
    public private(set) var generationStartedAt: Date?
    /// 最近一次生成失败的文案（成功后清空）
    public var lastError: String?

    private let aiService: AIService
    private var dependencies: Dependencies?

    /// 读写回调：构造期 `self` 尚未完整，由 `AppStore.init` 在全部存储属性就位后一次性
    /// 经 `attach` 注入（回调需要读 facade 的 cards / settings，无法在构造前捕获）。
    struct Dependencies {
        /// 排除标题列表（全量，截断由 AIService 负责）
        let existingHeadlines: () -> [String]
        /// 生成成功后的写入：追加到卡片池并落盘
        let appendGeneratedCards: ([KnowledgeCard]) -> Void
        /// 生成使用的设置快照
        let currentSettings: () -> AISettings
        /// 「换一批」跳顶卡（语义与状态归卡库，这里只调用意图化动作）
        let skipTopCard: () -> Void
        /// 当前待刷卡堆规模（自动补卡条件）
        let deckCount: () -> Int
        /// 自动补卡时间戳回写（settings.lastAutoTopUpAt）
        let recordAutoTopUp: (Date) -> Void
    }

    init(aiService: AIService) {
        self.aiService = aiService
    }

    /// 注入读写回调（仅 `AppStore.init` 调用一次；见 `Dependencies` 的说明）
    func attach(_ dependencies: Dependencies) {
        self.dependencies = dependencies
    }

    // MARK: - 手动生成

    /// 生成 count 张新卡片并追加到队列。
    /// - Parameter topic: 可选主题，非空时围绕该主题生成（全局搜索「围绕关键词生成」入口使用）
    public func generateNewCards(count: Int = 3, topic: String? = nil) async {
        guard let dependencies else { return }
        guard !isGenerating else { return }
        isGenerating = true
        generationStartedAt = Date()
        defer {
            isGenerating = false
            generationStartedAt = nil
        }

        do {
            // 排除标题传全量，截断上限由 AIService 单点决定
            let existing = dependencies.existingHeadlines()
            let newCards = try await aiService.generateCards(
                settings: dependencies.currentSettings(),
                count: count,
                excludeHeadlines: existing,
                topic: topic
            )
            dependencies.appendGeneratedCards(newCards)
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// 手动触发：换一批新知识——只跳过**当前顶卡**，再按设置条件生成新卡。
    ///
    /// 为什么不是「跳过整个卡堆」：`deck` 是全部未读卡（实测用户库 216 张），整堆写 `seenAt`/`skip`
    /// 会让待刷池一次归零、历史 +216、`skipCount` +216，直接污染今日目标与连续天数，
    /// 用户只能靠「重新探索全部卡片」回退（同时丢掉真实浏览进度）。
    /// 口径对齐 Android 端「换一批」只跳顶卡（`DeckScreen.kt:224`），也复用意图化方法 `swipe`，
    /// 保证 `skip` 语义（仅计已刷、不表达喜好、按 CONTEXT.md 不动收藏）与其它入口一致。
    public func refreshDeck() async {
        guard let dependencies else { return }
        dependencies.skipTopCard()
        let settings = dependencies.currentSettings()
        if settings.autoGenerate && settings.isAIConfigured && settings.enableAI {
            await generateNewCards(count: 6)
        }
    }

    // MARK: - 自动补卡

    /// 启动收尾：卡片不足时尝试自动生成（来源含 AI 且已配置才触发）。补卡是顺手行为而非
    /// 每次启动的固定开销：24h 内已自动补过卡则跳过，避免每次启动都消耗用户 API 额度。
    /// 失败同样记入节流窗口——失败的请求也可能已产生费用，且网络异常时不应每次启动都空打。
    public func autoTopUpIfNeeded(now: Date = Date()) async {
        guard let dependencies else { return }
        let settings = dependencies.currentSettings()
        guard dependencies.deckCount() < 5,
              settings.autoGenerate,
              settings.isAIConfigured,
              settings.enableAI,
              Self.autoTopUpAllowed(lastAutoTopUpAt: settings.lastAutoTopUpAt, now: now) else { return }
        await generateNewCards()
        dependencies.recordAutoTopUp(Date())
    }

    /// 自动补卡节流判定：距上次自动补卡不足 `interval` 则跳过（nil = 从未补过，放行）。
    /// 补卡是顺手行为，不应成为每次启动的固定开销。
    static func autoTopUpAllowed(lastAutoTopUpAt: Date?, now: Date, interval: TimeInterval = 24 * 60 * 60) -> Bool {
        guard let last = lastAutoTopUpAt else { return true }
        return now.timeIntervalSince(last) >= interval
    }
}
