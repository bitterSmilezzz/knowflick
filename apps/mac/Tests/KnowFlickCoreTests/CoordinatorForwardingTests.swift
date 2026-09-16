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

    /// 设置通道的告警同样经协调器上报，且成功保存后能清除（回滚语义不变）。
    @Test func settingsWarningTravelsThroughTheCoordinator() async throws {
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
        while store.persistenceWarning == nil && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(25))
        }
        #expect(store.persistenceWarning?.hasPrefix("设置保存失败") == true)

        // 让位置可用后重试：告警应被清除
        try FileManager.default.removeItem(at: directory.appendingPathComponent("settings.json"))
        store.applySettingsChange { $0.appearance = .dark }
        let clearDeadline = ContinuousClock.now.advanced(by: .seconds(10))
        while store.persistenceWarning != nil && ContinuousClock.now < clearDeadline {
            try await Task.sleep(for: .milliseconds(25))
        }
        #expect(store.persistenceWarning == nil)
        #expect(Storage(baseDir: directory).loadSettings().appearance == .dark)
    }
}
