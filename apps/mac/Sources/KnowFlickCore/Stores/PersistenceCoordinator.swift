import Foundation
import Observation

/// 持久化编排：卡片的「节流合并 + 串行队列落盘 + revision 门」与设置的轻量落盘通道。
///
/// 为什么单独成类型（拆分方案 B Step 1）：这些逻辑原先散在 `AppStore` 的 878 行里，
/// 但它们只关心三件事——**谁先写、谁覆盖谁、失败怎么告诉用户**，与卡片/设置的内容无关。
/// 抽出来后 revision 语义（旧快照不得覆盖新快照）与告警文案集中在一处，改任一条落盘路径
/// 都不必再回归整个 AppStore。
///
/// 线程纪律：本类型 @MainActor（与 AppStore 一致，读写共享状态无锁）；
/// 真正的文件 IO 全部丢给 `persistenceQueue`（串行），完成后跳回主线程提交结果。
@MainActor
@Observable
public final class PersistenceCoordinator {
    private let storage: Storage
    /// 串行持久化队列：保证卡片写入的先后顺序（后提交的快照一定后落盘）
    private let persistenceQueue: DispatchQueue

    private var persistTask: Task<Void, Never>?
    private var settingsPersistTask: Task<Void, Never>?
    private var persistenceRevision: UInt64 = 0
    private var settingsPersistRevision = 0

    /// 落盘失败时的用户可见告警（视图顶栏横幅）；成功后自动清除
    public private(set) var persistenceWarning: String?

    public init(
        storage: Storage,
        queue: DispatchQueue = DispatchQueue(label: "com.knowflick.persistence", qos: .utility)
    ) {
        self.storage = storage
        self.persistenceQueue = queue
    }

    // MARK: - 卡片落盘

    /// 合并连续变更，再通过串行队列写盘，防止旧快照覆盖新快照（350ms 节流）。
    /// - Parameters:
    ///   - cards: 调用时刻的卡片快照（每个变更都会取消上一次节流，因此最后一次调用携带的就是最新状态）
    ///   - skipCards: bootstrap 未完成等场景下传入 `true`：内存里的卡片池还不是用户数据，不得落盘
    public func persist(cards: [KnowledgeCard], skipCards: Bool) {
        guard !skipCards else { return }
        persistTask?.cancel()
        persistenceRevision &+= 1
        let revision = persistenceRevision
        persistTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(0.35)) }
            catch { return }
            guard let self, !Task.isCancelled else { return }
            let storage = self.storage
            self.persistenceQueue.async { [weak self] in
                let result = storage.saveCards(cards)
                Task { @MainActor [weak self] in
                    guard let self, self.persistenceRevision == revision else { return }
                    self.receiveSaveResult(result)
                }
            }
        }
    }

    /// 切后台等场景的即时保存：取消节流并立即在后台队列落盘，不阻塞主线程。
    /// 真正退出（willTerminate）请用 `flushPersistence`，其同步等待写入完成。
    public func persistImmediately(cards: [KnowledgeCard], settings: AISettings, skipCards: Bool) {
        persistTask?.cancel()
        persistTask = nil
        settingsPersistTask?.cancel()
        settingsPersistTask = nil
        persistenceRevision &+= 1
        let revision = persistenceRevision
        let storage = self.storage
        persistenceQueue.async { [weak self] in
            let result: CardSaveResult = skipCards ? .saved : storage.saveCards(cards)
            do {
                try storage.saveSettingsThrowing(settings)
            } catch {
                Task { @MainActor [weak self] in
                    guard let self, self.persistenceRevision == revision else { return }
                    self.persistenceWarning = "设置保存失败：\(error.localizedDescription)"
                }
            }
            Task { @MainActor [weak self] in
                guard let self, self.persistenceRevision == revision else { return }
                self.receiveSaveResult(result)
            }
        }
    }

    /// 应用退出前同步保存最后状态，并等待已提交的写入完成。
    public func flushPersistence(cards: [KnowledgeCard], settings: AISettings, skipCards: Bool) {
        persistTask?.cancel()
        persistTask = nil
        settingsPersistTask?.cancel()
        settingsPersistTask = nil
        persistenceRevision &+= 1
        let storage = self.storage
        let result: CardSaveResult = persistenceQueue.sync {
            try? storage.saveSettingsThrowing(settings)
            return skipCards ? .saved : storage.saveCards(cards)
        }
        receiveSaveResult(result)
    }

    /// 让已排队的异步写入跑完（测试用同步屏障：与写入共用同一条串行队列）
    func waitForPendingWrites() {
        persistenceQueue.sync {}
    }

    // MARK: - 设置落盘（非密钥类）

    /// 非密钥类设置的轻量变更（外观循环、磨耳朵语速等高频开关）：
    /// 内存即时生效，JSON 落盘经 350ms 节流 + 后台队列异步执行，**不触碰钥匙串**。
    /// 密钥类变更请走 `AppStore.saveSettings`（同步抛错 + 钥匙串回滚语义）。
    public func scheduleSettingsPersist(_ settings: AISettings) {
        settingsPersistTask?.cancel()
        settingsPersistRevision &+= 1
        let revision = settingsPersistRevision
        let storage = self.storage
        settingsPersistTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(0.35)) }
            catch { return }
            guard let self, !Task.isCancelled else { return }
            self.persistenceQueue.async { [weak self] in
                do {
                    try storage.saveSettingsThrowing(settings)
                    Task { @MainActor [weak self] in
                        guard let self, self.settingsPersistRevision == revision else { return }
                        // 仅清理本通道产生的告警，不掩盖卡片保存告警
                        if self.persistenceWarning?.hasPrefix("设置保存失败") == true {
                            self.persistenceWarning = nil
                        }
                    }
                } catch {
                    Task { @MainActor [weak self] in
                        guard let self, self.settingsPersistRevision == revision else { return }
                        self.persistenceWarning = "设置保存失败：\(error.localizedDescription)"
                    }
                }
            }
        }
    }

    /// 取消防抖任务（退出/关闭窗口时调用），避免窗口关闭后仍有待执行的写入
    public func cancelPendingThrottles() {
        persistTask?.cancel()
        persistTask = nil
        settingsPersistTask?.cancel()
        settingsPersistTask = nil
    }

    // MARK: - 结果反馈

    func receiveSaveResult(_ result: CardSaveResult) {
        switch result {
        case .saved:
            persistenceWarning = nil
        case .failed(let message):
            persistenceWarning = "最新卡片更改尚未保存，请保留应用并重试。\n\(message)"
        case .savedWithoutBackup(let message):
            persistenceWarning = "卡片已保存，但备份未能更新。\n\(message)"
        }
    }
}
