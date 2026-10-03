import Foundation
import Observation
import Testing
@testable import KnowFlickCore

/// 拆分方案 B 的观察语义契约（Step 1 起逐层加码）：
/// 子系统持有状态、`AppStore` 只做转发后，视图读到的转发属性必须仍能触发重绘。
/// 这是本机唯一能自动化的证据（真机冒烟仍需 Xcode，见审计 §6）。
@MainActor
struct CoordinatorForwardingTests {
    private final class Probe: @unchecked Sendable {
        private let lock = NSLock()
        private var fired: Set<String> = []
        func record(_ name: String) { lock.lock(); fired.insert(name); lock.unlock() }
        func contains(_ name: String) -> Bool { lock.lock(); defer { lock.unlock() }; return fired.contains(name) }
    }

    private func card() -> KnowledgeCard {
        KnowledgeCard(category: "冷知识", headline: "转发观察", summary: "摘要", details: "详情", source: .imported)
    }

    /// `persistenceWarning` 现在由 `PersistenceCoordinator` 持有：AppStore 的转发属性变更后必须仍触发观察回调。
    @Test func forwardedPersistenceWarningNotifiesObservers() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let storage = Storage(baseDir: directory)
        let store = AppStore(storage: storage)
        defer {
            store.closeChat()
            store.flushPersistence()
            try? FileManager.default.removeItem(at: directory)
        }
        store.cards = [card()]
        // 把 cards.json 变成目录，制造一次真实的落盘失败
        let obstruction = directory.appendingPathComponent("cards.json")
        try FileManager.default.createDirectory(at: obstruction, withIntermediateDirectories: false)

        let probe = Probe()
        withObservationTracking {
            _ = store.persistenceWarning
        } onChange: {
            probe.record("warning")
        }
        store.flushPersistence()

        #expect(store.persistenceWarning?.contains("尚未保存") == true)
        #expect(probe.contains("warning"), "转发属性的变更必须穿透到观察者（视图靠它重绘横幅）")
    }

    /// 卡片库子系统（Step 5）：`cards` / `deck` / `favorites` 的状态所有权移入 `CardLibraryStore`
    /// 后，经 facade 转发的读取必须仍能触发观察回调——卡片域的每一次重绘都压在这条链上。
    @Test func forwardedCardLibraryNotifiesObservers() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let storage = Storage(baseDir: directory)
        let store = AppStore(storage: storage)
        defer {
            store.closeChat()
            store.flushPersistence()
            try? FileManager.default.removeItem(at: directory)
        }
        let probe = Probe()
        withObservationTracking {
            _ = store.cards
            _ = store.deck
            _ = store.favorites
            _ = store.topCard
        } onChange: {
            probe.record("library")
        }
        #expect(store.cards.isEmpty)

        let subject = card()
        store.cards = [subject]

        #expect(store.topCard?.id == subject.id)
        #expect(probe.contains("library"), "卡片库转发属性的变更必须穿透到观察者（刷卡区/收藏/统计靠它重绘）")
    }

    /// 设置通道的告警同样经协调器上报，且成功保存后能清除（回滚语义不变）。
    @Test(.timeLimit(.minutes(1))) func settingsWarningTravelsThroughTheCoordinator() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let storage = Storage(baseDir: directory)
        let store = AppStore(storage: storage)
        defer {
            store.closeChat()
            try? FileManager.default.removeItem(at: directory)
        }
        store.isLoadingSeed = false

        // 设置文件位置被目录占位 → 写入失败 → 告警
        try FileManager.default.createDirectory(
            at: directory.appendingPathComponent("settings.json"), withIntermediateDirectories: false
        )
        store.applySettingsChange { $0.appearance = .light }
        let deadline = ContinuousClock.now.advanced(by: .seconds(10))
        while store.persistenceWarning?.hasPrefix("设置保存失败") != true && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(25))
        }
        #expect(store.persistenceWarning?.hasPrefix("设置保存失败") == true)

        // 让位置可用后重试：告警应被清除
        try FileManager.default.removeItem(at: directory.appendingPathComponent("settings.json"))
        store.applySettingsChange { $0.appearance = .dark }
        let clearDeadline = ContinuousClock.now.advanced(by: .seconds(10))
        while (store.persistenceWarning != nil || Storage(baseDir: directory).loadSettings().appearance != .dark) && ContinuousClock.now < clearDeadline {
            try await Task.sleep(for: .milliseconds(25))
        }
        #expect(store.persistenceWarning == nil)
        #expect(Storage(baseDir: directory).loadSettings().appearance == .dark)
    }
    @Test func successfulCardSaveDoesNotHideSettingsFailure() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let storage = Storage(baseDir: directory)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory.appendingPathComponent("settings.json"), withIntermediateDirectories: false)
        let coordinator = PersistenceCoordinator(storage: storage)
        coordinator.flushPersistence(cards: [], settings: .default, skipCards: false)
        #expect(coordinator.persistenceWarning?.hasPrefix("设置保存失败") == true)
        coordinator.receiveSaveResult(.failed("card failure"))
        #expect(coordinator.persistenceWarning?.contains("尚未保存") == true)
        coordinator.receiveSaveResult(.saved)
        #expect(coordinator.persistenceWarning?.hasPrefix("设置保存失败") == true)
        try FileManager.default.removeItem(at: directory.appendingPathComponent("settings.json"))
        coordinator.flushPersistence(cards: [], settings: .default, skipCards: false)
        #expect(coordinator.persistenceWarning == nil)
    }

    // MARK: - Wave B B8：退出 flush 移后台 + 主线程有界等待

    /// 队列被长任务卡住时，flush 的有界等待必须生效：≈2s 返回、不再无限阻塞退出，
    /// 且不吞掉排在后面的写入（长任务仍在后台跑完）。
    /// 旧实现 `persistenceQueue.sync` 会等满 3s（≥ 长任务时长），本用例在旧实现下必然变红。
    @Test("B8 队列被卡住时退出 flush 有界等待（≤2s），不再无限阻塞")
    @MainActor
    func flushPersistenceWaitsBoundedWhenQueueIsStalled() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let storage = Storage(baseDir: directory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let stalledQueue = DispatchQueue(label: "test.knowflick.stalled-persistence", qos: .utility)
        let coordinator = PersistenceCoordinator(storage: storage, queue: stalledQueue)

        // 队列里塞一个 3s 的长任务（模拟超大盘库的编码+写盘）
        let finished = ThreadSafeFlag()
        stalledQueue.async {
            Thread.sleep(forTimeInterval: 3)
            finished.set()
        }
        Thread.sleep(forTimeInterval: 0.1)   // 确保长任务先于 flush 入队

        let start = Date()
        coordinator.flushPersistence(cards: [], settings: .default, skipCards: false)
        let elapsed = Date().timeIntervalSince(start)

        #expect(elapsed >= 1.5, "flush 应等到限值附近（≥1.5s，实际 \(elapsed)s）")
        #expect(elapsed < 2.9, "flush 必须在 ≤2s 有界等待后返回，不得等满长任务（实际 \(elapsed)s）")
        #expect(finished.isSet == false, "长任务尚未完成时 flush 已返回（不再阻塞）")
        // 收尾：等长任务跑完，避免泄漏到后续测试
        finished.waitUntilTrue(timeout: 5)
    }

    /// 屏障语义不变：flush 返回后，「退出前数据落盘」成立（含先于它提交的异步写入）。
    @Test("B8 flush 返回后数据已落盘（退出前落盘语义不变）")
    @MainActor
    func flushPersistenceStillLandsDataBeforeReturning() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let storage = Storage(baseDir: directory)
        let store = AppStore(storage: storage)
        defer { store.closeChat(); try? FileManager.default.removeItem(at: directory) }
        store.isLoadingSeed = false

        let card = KnowledgeCard(category: "冷知识", headline: "退出前的最后一张卡", summary: "摘要", details: "正文", source: .imported)
        store.cards = [card]
        store.flushPersistence()

        #expect(Storage(baseDir: directory).loadCards().contains { $0.id == card.id })
    }
}

/// 线程安全布尔旗标（B8 测试用）
private final class ThreadSafeFlag: @unchecked Sendable {
    private let condition = NSCondition()
    private var _value = false

    var isSet: Bool {
        condition.lock(); defer { condition.unlock() }
        return _value
    }

    func set() {
        condition.lock()
        _value = true
        condition.signal()
        condition.unlock()
    }

    func waitUntilTrue(timeout: TimeInterval) {
        condition.lock()
        let deadline = Date().addingTimeInterval(timeout)
        while !_value && Date() < deadline {
            _ = condition.wait(until: deadline)
        }
        condition.unlock()
    }
}
