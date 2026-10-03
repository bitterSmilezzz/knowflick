import Foundation

/// 设置页编辑缓冲：`SettingsView` 全部可编辑字段的编辑态，一个 struct 收敛。
///
/// 为什么单独成类型（Wave C1）：设置页原先用「29 个 `@State` + onAppear 全量拷入 +
/// save() 手工逐字段拷出」的编辑缓冲模式——`AISettings` 每新增一个字段必须同步改两处，
/// 漏一处即**静默丢配置**（编译器无感、运行期无错、只有用户设置回读时才消失）。
/// 把字段清单下沉到 Core 后，「拷入 / 拷出」各只有一处实现，视图层不再出现字段名清单。
///
/// 字段清单的唯一性约定：
/// - `init(from:)`（拷入）与 `applying(to:)`（拷出）都是**显式逐字段赋值**——
///   `AISettings` 改名 / 删除 / 变更任一字段类型，编译器在这两处立刻报错；
///   新增字段时需要在此补一行（表征测试 `SettingsEditBufferRoundTripTests` 的
///   Mirror 字段计数断言会兜底提醒，漏补的测试必红）。
/// - `hasChanges(from:)` 复用 `init(from:)` + Equatable 比较，不出现第三份字段清单。
///
/// 密钥边界：`apiKey` 与 `speech.profiles[i].apiKey` 在本类型中只是**待编辑的字符串**，
/// 不做任何钥匙串语义；提交路径仍是 `SettingsStore.commit`（密钥进 Keychain、
/// 其余进 settings.json）。本类型不触碰凭据存储。
public struct SettingsEditBuffer: Equatable, Sendable {
    public var baseURL: String
    public var model: String
    public var apiKey: String
    public var autoGenerate: Bool
    /// 偏好分类（分类体系多选）。源头的 `categoryFilter` 是逗号分隔字符串，
    /// 这里以集合承载；拷出时经 `setPreferredCategories` 归一化回写。
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

    /// 空缓冲：视图首帧（onAppear 之前）的占位态，字段默认值与拆分前 SettingsView
    /// 各 `@State` 的初值逐一对应，onAppear 会被 `init(from:)` 整体覆盖。
    public init() {
        self.baseURL = ""
        self.model = ""
        self.apiKey = ""
        self.autoGenerate = true
        self.selectedCategories = []
        self.enableSeed = true
        self.enableAI = true
        self.aiSources = ""
        self.showAIMark = true
        self.appearance = .system
        self.paperTheme = .xuanzhiWhite
        self.customCategories = []
        self.speech = SpeechSettings()
        self.speechRate = 1.0
        self.speechPitch = 1.0
        self.speechVoiceIdentifier = "auto"
        self.ambientGapSeconds = 1.5
        self.autoSpeakOnDetailOpen = false
    }

    /// 拷入：从当前生效设置构造编辑态（设置页 onAppear 的单一入口）。
    ///
    /// 字段清单只出现在这里与 `applying(to:)` 两处显式赋值——这是刻意为之的冗余，
    /// 让「加字段漏拷」在编译期或测试期暴露，而不是在用户设置里静默消失。
    public init(from settings: AISettings) {
        self.baseURL = settings.baseURL
        self.model = settings.model
        self.apiKey = settings.apiKey
        self.autoGenerate = settings.autoGenerate
        self.selectedCategories = Set(settings.preferredCategories)
        self.enableSeed = settings.enableSeed
        self.enableAI = settings.enableAI
        self.aiSources = settings.aiSources
        self.showAIMark = settings.showAIMark
        self.appearance = settings.appearance
        self.paperTheme = settings.paperTheme
        self.customCategories = settings.customCategories
        self.speech = settings.speech
        self.speechRate = settings.speechRate
        self.speechPitch = settings.speechPitch
        self.speechVoiceIdentifier = settings.speechVoiceIdentifier
        self.ambientGapSeconds = settings.ambientGapSeconds
        self.autoSpeakOnDetailOpen = settings.autoSpeakOnDetailOpen
    }

    /// 拷出：把编辑态应用到当前生效设置上，返回待提交的新值（设置页 save 的单一出口）。
    ///
    /// - 以 `settings` 的副本为底：非编辑字段（如 `lastAutoTopUpAt` 引导节流时间戳）
    ///   原样保留，不会被缓冲意外清掉。
    /// - 文本字段拷出时做与既有 save() 相同的空白归一化；密钥的最终去空白仍由
    ///   `SettingsStore.normalized` 兜底。
    /// - 偏好分类先与「仍然存在的分类体系」（内置 + 当前自定义）求交集再回写：
    ///   已被删除的分类自动清理。
    public func applying(to settings: AISettings) -> AISettings {
        var updated = settings
        updated.baseURL = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        updated.model = model.trimmingCharacters(in: .whitespacesAndNewlines)
        updated.autoGenerate = autoGenerate
        updated.customCategories = customCategories
        // 偏好中已被删除的分类自动清理（与设置页 chip 的可选范围一致）
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

    /// 是否存在未保存的编辑：与「从当前生效设置 freshly 拷入的缓冲」逐字段比较。
    ///
    /// 用缓冲等价而非 `applying(to:) == settings` 判断，避免 `categoryFilter`
    /// 字符串格式（逗号间距、顺序）这类**语义等价的归一化差异**被误报为有改动。
    public func hasChanges(from settings: AISettings) -> Bool {
        self != SettingsEditBuffer(from: settings)
    }
}
