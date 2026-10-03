import Foundation
import Testing
@testable import KnowFlickCore

/// 设置编辑缓冲的护栏：round-trip 完整性 + 清洗口径 + **字段漂移守卫**。
/// 字段漂移守卫的意义：旧实现「onAppear 拷入 + save() 拷出」两份手工清单，
/// `AISettings` 新增字段漏改一处即静默丢配置且无任何提示；buffer 化后新增字段
/// 必须在 `init(from:)` 补齐，否则本文件的 `newSettingsFieldMustBeConsciouslyMapped`
/// 会先把测试打红，逼一次显式决定。
struct SettingsEditBufferTests {

    private func makeNonDefaultSettings() -> AISettings {
        var settings = AISettings.default
        settings.baseURL = "https://api.example.com/v1"
        settings.model = "example-model"
        settings.apiKey = "sk-test-key"
        settings.autoGenerate = false
        settings.setPreferredCategories(["AI", "投资理财"])
        settings.enableSeed = false
        settings.enableAI = false
        settings.aiSources = "zhihu.com, wikipedia.org"
        settings.showAIMark = false
        settings.appearance = .dark
        settings.paperTheme = .warmObsidian
        settings.customCategories = [CategoryConfig(name: "自建分类", description: "描述")]
        settings.speech = SpeechSettings()
        settings.speechRate = 1.25
        settings.speechPitch = 0.9
        settings.speechVoiceIdentifier = "com.apple.voice.test"
        settings.ambientGapSeconds = 2.5
        settings.autoSpeakOnDetailOpen = true
        return settings
    }

    /// 逐字段 round-trip：非默认设置经 buffer 拷入拷回后逐字段一致
    @Test func roundTripPreservesEveryEditableField() {
        let source = makeNonDefaultSettings()
        let applied = SettingsEditBuffer(from: source).applying(to: .default)

        #expect(applied.baseURL == source.baseURL)
        #expect(applied.model == source.model)
        #expect(applied.apiKey == source.apiKey)
        #expect(applied.autoGenerate == source.autoGenerate)
        #expect(applied.preferredCategories == source.preferredCategories)
        #expect(applied.enableSeed == source.enableSeed)
        #expect(applied.enableAI == source.enableAI)
        #expect(applied.aiSources == source.aiSources)
        #expect(applied.showAIMark == source.showAIMark)
        #expect(applied.appearance == source.appearance)
        #expect(applied.paperTheme == source.paperTheme)
        #expect(applied.customCategories == source.customCategories)
        #expect(applied.speech == source.speech)
        #expect(applied.speechRate == source.speechRate)
        #expect(applied.speechPitch == source.speechPitch)
        #expect(applied.speechVoiceIdentifier == source.speechVoiceIdentifier)
        #expect(applied.ambientGapSeconds == source.ambientGapSeconds)
        #expect(applied.autoSpeakOnDetailOpen == source.autoSpeakOnDetailOpen)
    }

    /// 非编辑字段（自动补卡节流时间戳）不被 buffer 触碰，随 base 保留
    @Test func nonEditableFieldsSurviveFromBase() {
        var base = AISettings.default
        let stamp = Date(timeIntervalSince1970: 1_727_900_000)
        base.lastAutoTopUpAt = stamp

        let applied = SettingsEditBuffer(from: makeNonDefaultSettings()).applying(to: base)
        #expect(applied.lastAutoTopUpAt == stamp, "节流时间戳不是 UI 字段，不得被编辑缓冲覆盖")

        // 反向：base 无值、buffer 来源有值也不会把它带进产物
        var source = makeNonDefaultSettings()
        source.lastAutoTopUpAt = stamp
        let applied2 = SettingsEditBuffer(from: source).applying(to: .default)
        #expect(applied2.lastAutoTopUpAt == nil, "buffer 不搬运非编辑字段")
    }

    /// 清洗口径与原 save() 一致：trim + 已删分类自动清理
    @Test func applyingTrimsAndPrunesDeletedCategories() {
        var source = makeNonDefaultSettings()
        source.baseURL = "  https://api.example.com/v1  "
        source.model = " example-model "
        source.aiSources = "  zhihu.com  "
        source.setPreferredCategories(["AI", "投资理财"])
        source.customCategories = [CategoryConfig(name: "投资理财", description: "")]
        // 原 save() 用 editingCategoryNames = 内置 + 自定义；"AI" 不在其中（真实自定义分类名里没有它）
        var base = AISettings.default
        base.customCategories = []

        let applied = SettingsEditBuffer(from: source).applying(to: base)
        #expect(applied.baseURL == "https://api.example.com/v1")
        #expect(applied.model == "example-model")
        #expect(applied.aiSources == "zhihu.com")
        #expect(applied.preferredCategories == ["投资理财"], "被删除的分类从偏好中清理")
    }

    /// 字段漂移守卫：`AISettings` 的每个存储字段必须显式分类——
    /// 要么进 buffer（可编辑），要么列在 excluded 并注明理由。新增字段若两处都没有，此测试打红。
    @Test func newSettingsFieldMustBeConsciouslyMapped() {
        let storedFields = Set(
            Mirror(reflecting: AISettings.default).children.compactMap(\.label)
        )
        // 有意不进 buffer 的字段（非 UI）：自动补卡节流时间戳（bootstrap 内部簿记）
        let excluded: Set<String> = ["lastAutoTopUpAt"]
        // buffer 覆盖的字段（categoryFilter 经 selectedCategories 映射，故在此清单内）
        let mapped: Set<String> = [
            "baseURL", "model", "apiKey", "autoGenerate", "categoryFilter",
            "enableSeed", "enableAI", "aiSources", "showAIMark", "appearance",
            "paperTheme", "customCategories", "speechRate", "speechPitch",
            "speechVoiceIdentifier", "ambientGapSeconds", "speech", "autoSpeakOnDetailOpen",
        ]

        let unmapped = storedFields.subtracting(mapped).subtracting(excluded)
        #expect(
            unmapped.isEmpty,
            "AISettings 新增字段必须显式决定：进 SettingsEditBuffer 或加入 excluded 清单——发现未映射字段 \(unmapped.sorted())"
        )
        // 反向守卫：清单里的字段若从 AISettings 消失（改名/删除），也要同步维护
        let stale = mapped.subtracting(storedFields)
        #expect(stale.isEmpty, "buffer 清单存在 AISettings 已不存在的字段（改名/删除后需同步）：\(stale.sorted())")
    }
}
