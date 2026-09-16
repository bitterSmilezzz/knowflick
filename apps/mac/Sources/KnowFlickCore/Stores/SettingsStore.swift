import Foundation
import Observation

/// 设置与凭据的提交事务。
///
/// 为什么单独成类型（拆分方案 B Step 4）：设置是**唯一**横跨两个存储介质的状态——
/// 密钥进 Keychain、其余进 settings.json——因此必须有一个地方统管「先写谁、失败怎么回滚」。
/// 这块逻辑原先夹在 AppStore 的 `saveSettings` / `rollbackCredentials` 里，
/// 改任何一处设置提交流程都要在 800 行里辨认可回滚的快照范围。
///
/// 边界：本类型**不持有** `settings` 状态（那是 AppStore 的观察状态，其 didSet 还要驱动
/// 语音配置与卡堆重算）。这里只做「校验归一化 → 钥匙串事务 → JSON 落盘 → 返回最终值」。
///
/// 提交顺序（不可调换）：钥匙串写入 → JSON 落盘 → 由调用方提交内存。
/// 任一步失败内存保持旧值、钥匙串尽力回滚，避免「新密钥配旧配置」跨启动错位。
@MainActor
@Observable
public final class SettingsStore {
    private let storage: Storage
    private let credentials: any CredentialStore
    private let aiService: AIService

    /// 最近一次连通性测试结果（设置面板消费；nil 表示尚未测试过）
    public private(set) var connectionResult: String?

    public init(storage: Storage, credentials: any CredentialStore, aiService: AIService) {
        self.storage = storage
        self.credentials = credentials
        self.aiService = aiService
    }

    /// 归一化：密钥两端空白一律剔除（避免「看起来配了、其实带了换行」导致 401）
    static func normalized(_ newSettings: AISettings) -> AISettings {
        var persisted = newSettings
        persisted.apiKey = newSettings.apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        for index in persisted.speech.profiles.indices {
            let key = persisted.speech.profiles[index].apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
            persisted.speech.profiles[index].apiKey = key
        }
        return persisted
    }

    /// 提交设置：key 单独进 Keychain，其余进 JSON；失败抛错并回滚钥匙串，不提交内存。
    /// - Parameters:
    ///   - newSettings: 待提交的设置
    ///   - current: 当前生效的设置（用于快照旧凭据、以及识别被移除的语音配置）
    /// - Returns: 归一化后的设置，调用方据此提交内存状态
    @discardableResult
    public func commit(_ newSettings: AISettings, replacing current: AISettings) throws -> AISettings {
        let persisted = Self.normalized(newSettings)

        // 快照旧凭据用于失败回滚（read 返回 nil 表示该账户本无密钥）——
        // 快照范围必须覆盖「当前生效的全部语音配置」，否则移除配置时的密钥无法回滚。
        let previousAPIKey = credentials.read(account: "apiKey")
        let previousProfileKeys = current.speech.profiles.map {
            (account: "tts." + $0.id, key: credentials.read(account: "tts." + $0.id))
        }

        do {
            // key 非空写钥匙串、为空则删除：清空后重启不会「复活」旧密钥
            if persisted.apiKey.isEmpty {
                try credentials.delete(account: "apiKey")
            } else {
                try credentials.save(persisted.apiKey, account: "apiKey")
            }
            for profile in persisted.speech.profiles {
                let account = "tts." + profile.id
                if profile.apiKey.isEmpty { try credentials.delete(account: account) }
                else { try credentials.save(profile.apiKey, account: account) }
            }
            // 被移除的语音配置：其密钥同样要清掉，否则会留在钥匙串里跟着用户走
            let retainedIDs = Set(persisted.speech.profiles.map(\.id))
            for profile in current.speech.profiles where !retainedIDs.contains(profile.id) {
                try credentials.delete(account: "tts." + profile.id)
            }
            try storage.saveSettingsThrowing(persisted)
        } catch {
            rollbackCredentials(previousAPIKey: previousAPIKey, previousProfileKeys: previousProfileKeys)
            throw error
        }
        return persisted
    }

    /// JSON 落盘或钥匙串写入失败后，尽力恢复到保存前的凭据状态
    private func rollbackCredentials(previousAPIKey: String?, previousProfileKeys: [(account: String, key: String?)]) {
        if let previousAPIKey {
            try? credentials.save(previousAPIKey, account: "apiKey")
        } else {
            try? credentials.delete(account: "apiKey")
        }
        for entry in previousProfileKeys {
            if let key = entry.key {
                try? credentials.save(key, account: entry.account)
            } else {
                try? credentials.delete(account: entry.account)
            }
        }
    }

    /// 连通性测试：轻量 ping 请求，不消耗额度。结果同时写入 `connectionResult` 供视图直接消费。
    @discardableResult
    public func testConnection(_ testSettings: AISettings) async -> String {
        let message: String
        do {
            try await aiService.ping(settings: testSettings)
            message = "连接成功，AI 服务可用"
        } catch {
            message = error.localizedDescription
        }
        connectionResult = message
        return message
    }
}
