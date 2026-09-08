import Foundation

struct RemoteSpeechClient {
    var session = URLSession.shared

    static func request(text: String, profile: SpeechProfile, speed: Float) throws -> URLRequest {
        guard !text.isEmpty, !profile.model.isEmpty, !profile.voice.isEmpty else {
            throw AIError.badRequest("语音文本、模型和音色不能为空")
        }
        let base = profile.baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var components = URLComponents(string: base),
              ["http", "https"].contains(components.scheme ?? ""),
              let host = components.host, !host.isEmpty,
              components.query == nil, components.fragment == nil else {
            throw AIError.badRequest("语音 API 地址无效")
        }
        guard components.scheme == "https" || profile.isLocal else {
            throw AIError.badRequest("云端语音请使用 HTTPS；HTTP 仅用于本机服务")
        }
        let key = profile.apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard profile.isLocal || !key.isEmpty else { throw AIError.missingKey }
        var path = components.path
        while path.hasSuffix("/") { path.removeLast() }
        if !path.hasSuffix("/audio/speech") { path += path.isEmpty ? "/v1/audio/speech" : "/audio/speech" }
        components.path = path
        guard let url = components.url else { throw AIError.badRequest("语音 API 地址无效") }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 60
        if !key.isEmpty { request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization") }
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "model": profile.model, "voice": profile.voice, "input": text,
            "response_format": "mp3", "speed": speed.isFinite ? min(2, max(0.5, speed)) : 1
        ])
        return request
    }

    func audio(text: String, profile: SpeechProfile, speed: Float) async throws -> Data {
        let request = try Self.request(text: text, profile: profile, speed: speed)
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let response = response as? HTTPURLResponse else { throw AIError.network("语音服务无响应") }
        guard (200..<300).contains(response.statusCode) else { throw AIError.httpStatus(response.statusCode, "语音服务请求失败") }
        guard !data.isEmpty, !response.mimeType.orEmpty.contains("json") else { throw AIError.parse("语音服务未返回音频") }
        return data
    }
}

private extension Optional where Wrapped == String {
    var orEmpty: String { self ?? "" }
}
