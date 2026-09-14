import Foundation
import Testing
@testable import KnowFlickCore

/// 服务商预设一致性测试：README 的 16 档服务商大表靠这组护栏防止与代码漂移
struct AIProviderPresetTests {
    private let keylessPresets: Set<String> = ["ollama", "local_freellm", "custom"]

    @Test func presetsHaveConsistentIdentity() {
        #expect(AIProviderPreset.presets.count == 16)
        #expect(Set(AIProviderPreset.presets.map(\.id)).count == 16)
        for preset in AIProviderPreset.presets {
            #expect(!preset.name.isEmpty)
            #expect(!preset.group.isEmpty)
            #expect(!preset.helpText.isEmpty)
            // custom 预设由用户填写端点与模型，默认值为空属预期
            if preset.id == "custom" {
                #expect(preset.defaultBaseURL.isEmpty && preset.models.isEmpty)
                continue
            }
            #expect(!preset.defaultBaseURL.isEmpty)
            #expect(!preset.models.isEmpty)
            #expect(preset.models.contains(preset.defaultModel), "preset \(preset.id) 的 defaultModel 不在 models 内")
            #expect(preset.requiresKey == !keylessPresets.contains(preset.id), "preset \(preset.id) 的 requiresKey 与免密约定不符")
            #expect(preset.defaultBaseURL.hasPrefix("https://") || preset.defaultBaseURL.contains("127.0.0.1") || preset.defaultBaseURL.contains("localhost"),
                    "preset \(preset.id) 的 baseURL 应为 HTTPS 或本地回环")
        }
    }

    @Test func presetGroupsStayWithinThreeBuckets() {
        let groups = Set(AIProviderPreset.presets.map(\.group))
        #expect(groups == ["在线 API 服务", "本地部署运行", "自定义"])
    }

    @Test func matchResolvesEveryPresetBaseURLToItself() {
        for preset in AIProviderPreset.presets where preset.id != "custom" {
            let matched = AIProviderPreset.match(baseURL: preset.defaultBaseURL)
            #expect(matched.id == preset.id, "\(preset.defaultBaseURL) 应反查回 \(preset.id)，实际 \(matched.id)")
        }
    }

    @Test func matchFallsBackToCustomForUnknownURL() {
        #expect(AIProviderPreset.match(baseURL: "https://api.example-unlisted-gateway.net/v1").id == "custom")
        #expect(AIProviderPreset.match(baseURL: "   ").id == "deepseek")
    }

    @Test func matchDoesNotMisreadRemoteUrlsContainingLocalPortNumbers() {
        #expect(AIProviderPreset.match(baseURL: "https://api.gateway.example.com/tokens/31415").id == "custom")
        #expect(AIProviderPreset.match(baseURL: "https://mirror.example.com/11434/proxy").id == "custom")
        #expect(AIProviderPreset.match(baseURL: "http://127.0.0.1:31415/v1").id == "local_freellm")
        #expect(AIProviderPreset.match(baseURL: "http://localhost:11434/v1").id == "ollama")
    }
}
