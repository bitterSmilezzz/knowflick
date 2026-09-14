import Foundation

/// 语音与知识生成独立配置；密钥只存在运行期和 Keychain。
public struct SpeechProfile: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var baseURL: String
    public var model: String
    public var voice: String
    public var apiKey: String = ""

    public init(id: String = UUID().uuidString, name: String, baseURL: String, model: String, voice: String) {
        self.id = id; self.name = name; self.baseURL = baseURL; self.model = model; self.voice = voice
    }
    enum CodingKeys: String, CodingKey { case id, name, baseURL, model, voice }
    public var isLocal: Bool {
        let host = URL(string: baseURL.trimmingCharacters(in: .whitespacesAndNewlines))?.host?.lowercased() ?? ""
        return ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host)
    }
}

public struct SpeechSettings: Codable, Equatable, Sendable {
    /// system 或某个 profile ID，多个配置中一次启用一个。
    public var selectedID = "system"
    public var fallbackToSystem = true
    public var profiles: [SpeechProfile] = [
        SpeechProfile(id: "siliconflow", name: "硅基流动 · CosyVoice", baseURL: "https://api.siliconflow.cn/v1", model: "FunAudioLLM/CosyVoice2-0.5B", voice: "FunAudioLLM/CosyVoice2-0.5B:anna"),
        SpeechProfile(id: "kokoro", name: "本地 · Kokoro 服务", baseURL: "http://127.0.0.1:8880/v1", model: "kokoro", voice: "zf_xiaobei")
    ]
    public init() {}
    public var selectedProfile: SpeechProfile? { profiles.first { $0.id == selectedID } }
}

public enum SpeechText {
    /// 去掉朗读噪音，同时保留中文、英文与数字正文。
    public static func prepare(_ raw: String) -> String {
        var text = raw.replacingOccurrences(of: #"```[^\n]*\n[\s\S]*?```"#, with: "代码示例请参阅卡片。", options: .regularExpression)
        text = text.replacingOccurrences(of: #"\[([^\]]+)\]\([^)]+\)"#, with: "$1", options: .regularExpression)
        text = text.replacingOccurrences(of: #"(?m)^\s{0,3}(#{1,6}\s+|[-*>]\s+)"#, with: "", options: .regularExpression)
        text = text.replacingOccurrences(of: #"[*_`]+"#, with: "", options: .regularExpression)
        text = text.replacingOccurrences(of: #"https?://\S+"#, with: "链接见原文", options: .regularExpression)
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public static func chunks(_ text: String, maxCharacters: Int = 400) -> [String] {
        guard maxCharacters > 0 else { return [] }
        var remaining = text[...]
        var result: [String] = []
        while !remaining.isEmpty {
            let end = remaining.index(remaining.startIndex, offsetBy: maxCharacters, limitedBy: remaining.endIndex) ?? remaining.endIndex
            var split = end
            if end != remaining.endIndex,
               let punctuation = remaining[..<end].lastIndex(where: { "。！？；\n.!?;".contains($0) }) {
                split = remaining.index(after: punctuation)
            }
            result.append(String(remaining[..<split]))
            remaining = remaining[split...]
        }
        return result
    }
}
