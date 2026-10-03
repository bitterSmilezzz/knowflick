import Foundation

/// 设置页的编辑缓冲：把「onAppear 逐字段拷入 + save() 逐字段拷出」的双份字段清单
/// 收敛成一个类型——`AISettings` 新增字段时只在 `init(from:)` 一处补齐，漏改不会静默丢配置
/// （旧实现漏掉 save() 那份即丢字段，且无编译期提示）。
///
/// 约定：
/// - 本类型持有**可编辑字段的编辑态**（未清洗的原始输入）；清洗口径集中在 `applying(to:)`。
/// - 非 UI 字段（如 `lastAutoTopUpAt` 自动补卡节流时间戳）不进 buffer，`applying(to:)`
///   从传入的 base settings 原样保留。
/// - 密钥字段（apiKey / TTS profile key）随 `applying(to:)` 一并拷出，落盘仍走
///   `AppStore.saveSettings` → `SettingsStore.commit`，密钥不入 JSON 的既有口径不变。
public struct SettingsEditBuffer: Equatable, Sendable {
    public var baseURL: String
    public var model: String
    public var apiKey: String
    public var autoGenerate: Bool
    /// 偏好分类（多选集合；拷出来源为 `AISettings.preferredCategories`，拷回经 `setPreferredCategories`）
    public var selectedCategories: Set<String>
    public var enableSeed: Bool
    public var enableAI: Bool
    public var aiSources: String
    public var showAIMark: Bool
    public var appearance: AppearanceMode
    public var paperTheme: PaperTheme
    public var customCategories: [CategoryConfig]
    public var speech: SpeechSettings
    public var speechRate: Float
    public var speechPitch: Float
    public var speechVoiceIdentifier: String
    public var ambientGapSeconds: Double
    public var autoSpeakOnDetailOpen: Bool

    /// 唯一拷入点：字段清单以此为准
    public init(from settings: AISettings) {
        baseURL = settings.baseURL
        model = settings.model
        apiKey = settings.apiKey
        autoGenerate = settings.autoGenerate
        selectedCategories = Set(settings.preferredCategories)
        enableSeed = settings.enableSeed
        enableAI = settings.enableAI
        aiSources = settings.aiSources
        showAIMark = settings.showAIMark
        appearance = settings.appearance
        paperTheme = settings.paperTheme
        customCategories = settings.customCategories
        speech = settings.speech
        speechRate = settings.speechRate
        speechPitch = settings.speechPitch
        speechVoiceIdentifier = settings.speechVoiceIdentifier
        ambientGapSeconds = settings.ambientGapSeconds
        autoSpeakOnDetailOpen = settings.autoSpeakOnDetailOpen
    }

    /// 唯一拷出点：清洗口径与原 SettingsView.save() 逐条一致——
    /// baseURL / model / apiKey / aiSources 去首尾空白；偏好分类先与「当前有效分类名」
    /// 求交集（编辑中已删除的分类自动清理）再回写；其余字段原样。
    public func applying(to settings: AISettings) -> AISettings {
        var updated = settings
        updated.baseURL = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        updated.model = model.trimmingCharacters(in: .whitespacesAndNewlines)
        updated.autoGenerate = autoGenerate
        updated.customCategories = customCategories
        let validNames = Set([CategoryRegistry.builtinCategory] + customCategories.map(\.name))
        updated.setPreferredCategories(Array(selectedCategories.intersection(validNames)))
        updated.enableSeed = enableSeed
        updated.enableAI = enableAI
        updated.aiSources = aiSources.trimmingCharacters(in: .whitespacesAndNewlines)
        updated.showAIMark = showAIMark
        updated.appearance = appearance
        updated.paperTheme = paperTheme
        updated.apiKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        updated.speech = speech
        updated.speechRate = speechRate
        updated.speechPitch = speechPitch
        updated.speechVoiceIdentifier = speechVoiceIdentifier
        updated.ambientGapSeconds = ambientGapSeconds
        updated.autoSpeakOnDetailOpen = autoSpeakOnDetailOpen
        return updated
    }
}
