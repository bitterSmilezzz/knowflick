import Foundation
import Testing
@testable import KnowFlickCore

/// SettingsEditBuffer round-trip 表征测试（Wave C1）。
///
/// 锁两件事：
/// 1. 字段清单完整性——`init(from:)` 拷入 / `applying(to:)` 拷出覆盖 AISettings 全部
///    可编辑字段，逐字段扰动后其余字段必须原样（含空白归一化、lastAutoTopUpAt 保留）；
/// 2. 默认值 round-trip 不变——未编辑的缓冲提交后与原设置逐字段相等。
///
/// AISettings 新增字段时：Mirror 计数断言会先红，提示把新字段纳入
/// SettingsEditBuffer 的拷入/拷出清单并补扰动用例。
struct SettingsEditBufferRoundTripTests {

    // MARK: - 基线：全部字段取非默认值

    /// 全字段非默认值的设置。categoryFilter 经 setPreferredCategories 归一化写入
    /// （保存路径会把偏好集合排序回写，非归一化格式不参与 round-trip 相等断言）。
    private func makeFullyPopulatedSettings() -> AISettings {
        var settings = AISettings(
            baseURL: "https://api.example.com/v9",
            model: "test-model-x",
            apiKey: "sk-test-abc123",
            autoGenerate: false,
            categoryFilter: "",
            enableSeed: false,
            enableAI: false,
            aiSources: "NASA, arXiv",
            showAIMark: false,
            appearance: .dark,
            paperTheme: .warmObsidian,
            customCategories: [
                CategoryConfig(name: "测试甲", description: "方向甲"),
                CategoryConfig(name: "测试乙", description: "方向乙")
            ],
            speechRate: 1.75,
            speechPitch: 0.6,
            speechVoiceIdentifier: "com.apple.voice.test",
            ambientGapSeconds: 3.0,
            autoSpeakOnDetailOpen: true
        )
        settings.setPreferredCategories(["冷知识", "测试甲", "测试乙"])
        settings.speech.selectedID = "siliconflow"
        settings.speech.fallbackToSystem = false
        settings.speech.profiles[0].voice = "tts-voice-a"
        settings.speech.profiles[0].apiKey = "tts-secret-1"
        settings.lastAutoTopUpAt = Date(timeIntervalSince1970: 1_700_000_000)
        return settings
    }

    // MARK: - 扰动用例表：单一字段清单的扰动 + 期望

    /// 每项只扰动一个 buffer 字段，并给出「应用后该字段应有的值」。
    /// 拷出时做空白归一化的字段，扰动值刻意带空白以锁住 trim 行为。
    private var perturbations: [(name: String, apply: (inout SettingsEditBuffer) -> Void, expect: (inout AISettings) -> Void)] {
        [
            ("baseURL", { $0.baseURL = "  https://p.example.com/v1  " }, { $0.baseURL = "https://p.example.com/v1" }),
            ("model", { $0.model = " p-model " }, { $0.model = "p-model" }),
            ("apiKey", { $0.apiKey = " sk-perturbed " }, { $0.apiKey = "sk-perturbed" }),
            ("autoGenerate", { $0.autoGenerate = true }, { $0.autoGenerate = true }),
            ("selectedCategories", { $0.selectedCategories = ["冷知识", "测试乙"] },
             { $0.setPreferredCategories(["冷知识", "测试乙"]) }),
            ("enableSeed", { $0.enableSeed = true }, { $0.enableSeed = true }),
            ("enableAI", { $0.enableAI = true }, { $0.enableAI = true }),
            ("aiSources", { $0.aiSources = "  NASA, arXiv  " }, { $0.aiSources = "NASA, arXiv" }),
            ("showAIMark", { $0.showAIMark = true }, { $0.showAIMark = true }),
            ("appearance", { $0.appearance = .light }, { $0.appearance = .light }),
            ("paperTheme", { $0.paperTheme = .parchment }, { $0.paperTheme = .parchment }),
            ("customCategories", { $0.customCategories.append(CategoryConfig(name: "测试丙", description: "方向丙")) },
             { $0.customCategories.append(CategoryConfig(name: "测试丙", description: "方向丙")) }),
            ("speech", { $0.speech.selectedID = "kokoro"; $0.speech.profiles[0].voice = "tts-voice-z" },
             { $0.speech.selectedID = "kokoro"; $0.speech.profiles[0].voice = "tts-voice-z" }),
            ("speechRate", { $0.speechRate = 0.75 }, { $0.speechRate = 0.75 }),
            ("speechPitch", { $0.speechPitch = 2.0 }, { $0.speechPitch = 2.0 }),
            ("speechVoiceIdentifier", { $0.speechVoiceIdentifier = "another.voice.id" }, { $0.speechVoiceIdentifier = "another.voice.id" }),
            ("ambientGapSeconds", { $0.ambientGapSeconds = 1.0 }, { $0.ambientGapSeconds = 1.0 }),
            ("autoSpeakOnDetailOpen", { $0.autoSpeakOnDetailOpen = false }, { $0.autoSpeakOnDetailOpen = false })
        ]
    }

    // MARK: - 默认值 round-trip 不变

    @Test func defaultSettingsRoundTripUnchanged() {
        let settings = AISettings.default
        let buffer = SettingsEditBuffer(from: settings)
        #expect(!buffer.hasChanges(from: settings), "未编辑的缓冲不应报告有改动")
        let applied = buffer.applying(to: settings)
        #expect(applied == settings, "默认值设置经 buffer 拷入拷出后应逐字段相等")
    }

    @Test func fullyPopulatedSettingsRoundTripUnchanged() {
        let settings = makeFullyPopulatedSettings()
        let buffer = SettingsEditBuffer(from: settings)
        #expect(!buffer.hasChanges(from: settings), "未编辑的缓冲不应报告有改动")
        let applied = buffer.applying(to: settings)
        #expect(applied == settings, "全字段非默认值经 buffer 拷入拷出后应逐字段相等")
        #expect(applied.lastAutoTopUpAt == settings.lastAutoTopUpAt, "非编辑字段 lastAutoTopUpAt 必须原样保留")
    }

    // MARK: - 逐字段扰动：扰动生效且未扰动字段原样

    @Test func singleFieldPerturbationOnlyAffectsItsOwnField() {
        let settings = makeFullyPopulatedSettings()
        for perturbation in perturbations {
            var buffer = SettingsEditBuffer(from: settings)
            perturbation.apply(&buffer)
            let applied = buffer.applying(to: settings)

            var expected = settings
            perturbation.expect(&expected)
            #expect(
                applied == expected,
                "扰动字段「\(perturbation.name)」后：该字段应生效为期望值，且其余字段必须与原设置逐字段一致"
            )
        }
    }

    /// 随机扰动（固定种子可复现）：随机抽取扰动子集组合应用，锁定多字段同时编辑时
    /// 「互不串扰」的表征。SplitMix64 自带实现，避免依赖系统随机数的不可复现。
    @Test func randomSubsetPerturbationsCompose() {
        let settings = makeFullyPopulatedSettings()
        var state: UInt64 = 0x9E37_79B9_7F4A_7C15
        func nextRandom() -> UInt64 {
            state &+= 0x9E37_79B9_7F4A_7C15
            var z = state
            z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
            z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
            return z ^ (z >> 31)
        }

        let table = perturbations
        for _ in 0..<100 {
            var buffer = SettingsEditBuffer(from: settings)
            var expected = settings
            // 至少抽 1 项、至多全量，可重复命中（幂等）
            let count = Int(nextRandom() % UInt64(table.count)) + 1
            for _ in 0..<count {
                let index = Int(nextRandom() % UInt64(table.count))
                table[index].apply(&buffer)
                table[index].expect(&expected)
            }
            #expect(buffer.applying(to: settings) == expected, "随机扰动子集组合（seed=\(state)）未按预期生效")
        }
    }

    // MARK: - hasChanges 语义

    @Test func hasChangesDetectsEachFieldEdit() {
        let settings = makeFullyPopulatedSettings()
        for perturbation in perturbations {
            var buffer = SettingsEditBuffer(from: settings)
            perturbation.apply(&buffer)
            #expect(buffer.hasChanges(from: settings), "扰动字段「\(perturbation.name)」后应报告有未保存改动")
        }
    }

    @Test func hasChangesTreatsUntouchedWhitespaceOnlyInputAsEdit() {
        var settings = AISettings.default
        settings.baseURL = "https://api.example.com"
        var buffer = SettingsEditBuffer(from: settings)
        // 用户输入了「语义等价但未提交」的空白差异：仍是未保存编辑（提交时统一归一化）
        buffer.baseURL = "  https://api.example.com  "
        #expect(buffer.hasChanges(from: settings))
        // 归一化发生在拷出：提交后与原设置的 baseURL 相等
        #expect(buffer.applying(to: settings).baseURL == settings.baseURL)
    }

    // MARK: - 字段清单完备性守卫

    /// AISettings 存储字段计数 tripwire：新增字段而未纳入 SettingsEditBuffer 拷入/拷出
    /// 清单时先在这里红掉，防止「加字段漏一处」的静默丢配置回归。
    /// 当前 19 个存储字段：buffer 覆盖 18 个可编辑字段，lastAutoTopUpAt（引导节流
    /// 时间戳）刻意不在编辑范围、由 applying(to:) 以原设置为底保留。
    @Test func aiSettingsStoredFieldCountIsGuarded() {
        let count = Mirror(reflecting: AISettings.default).children.count
        #expect(
            count == 19,
            "AISettings 存储字段数变为 \(count)（原 19）：新增字段必须同步纳入 SettingsEditBuffer 的 init(from:)/applying(to:) 字段清单，并在 SettingsEditBufferRoundTripTests 补扰动用例"
        )
    }
}
