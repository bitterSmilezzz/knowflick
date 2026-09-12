import Foundation
import AVFoundation
import Testing
@testable import KnowFlickCore

struct SpeechTests {
    @Test @MainActor func emptyQueueDoesNotStartAmbientMode() {
        let service = SpeechSynthesizerService()
        service.startAmbientMode(initialCard: nil)
        defer { service.stopAmbientMode() }
        #expect(!service.isAmbientMode)
        #expect(service.state == .idle)
    }

    @Test @MainActor func ambientPlaybackFinishAdvancesAndStopsWhenQueueEmpty() async throws {
        let service = SpeechSynthesizerService()
        service.suppressesRealSynthesis = true   // 单测不驱动真实合成，避免系统 TextToSpeech 回调崩溃
        var advanceRequests = 0
        service.ambientGapSeconds = 0.05
        service.onAmbientAdvanceRequest = {
            advanceRequests += 1
            return nil   // 空队列：磨耳朵应自动收束
        }
        let subject = KnowledgeCard(category: "学习", headline: "磨耳朵推进", summary: "摘要", details: "正文", source: .seed,
                                    createdAt: Date(timeIntervalSince1970: 1_000_000))
        service.startAmbientMode(initialCard: subject)
        #expect(service.isAmbientMode)

        // 模拟系统合成器的「播放完成」delegate 回调（须与 service 内部的 utterance 实例一致）
        let utterance = try #require(service.currentUtterance)
        service.speechSynthesizer(AVSpeechSynthesizer(), didFinish: utterance)

        let deadline = ContinuousClock.now.advanced(by: .seconds(3))
        while service.isAmbientMode && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(25))
        }
        #expect(!service.isAmbientMode)
        #expect(advanceRequests == 1)
    }

    @Test func pastedLocalAddressAcceptsSurroundingWhitespace() throws {
        var profile = SpeechSettings().profiles[1]
        profile.baseURL = "  http://127.0.0.1:8880/v1 \n"
        #expect(profile.isLocal)
        let request = try RemoteSpeechClient.request(text: "你好", profile: profile, speed: 1)
        #expect(request.url?.absoluteString == "http://127.0.0.1:8880/v1/audio/speech")
    }

    @Test func whitespaceModelIsRejectedBeforeSending() {
        var profile = SpeechSettings().profiles[1]
        profile.model = " \n "
        #expect(throws: (any Error).self) { try RemoteSpeechClient.request(text: "你好", profile: profile, speed: 1) }
    }

    @Test func modelAndVoiceAreTrimmed() throws {
        var profile = SpeechSettings().profiles[1]
        profile.model = " kokoro \n"
        profile.voice = " zf_xiaobei "
        let request = try RemoteSpeechClient.request(text: "你好", profile: profile, speed: 1)
        let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
        #expect(body["model"] as? String == "kokoro")
        #expect(body["voice"] as? String == "zf_xiaobei")
    }

    @Test @MainActor func pauseBeforeAudioArrivesAndResume() {
        let service = SpeechSynthesizerService()
        service.suppressesRealSynthesis = true   // 单测不驱动真实合成
        service.configuration.selectedID = "kokoro"
        let card = KnowledgeCard(category: "AI", headline: "测试", summary: "摘要", details: "正文", source: .seed)
        service.speak(card: card)
        defer { service.stop() }
        service.pause()
        #expect(service.state.isPaused)
        service.resume()
        #expect(service.state.isPlaying)
        service.stop()
        #expect(service.state == .idle)
        #expect(!service.isPreparing)
    }

    @Test func profileNeverPersistsKey() throws {
        var profile = SpeechSettings().profiles[0]
        profile.apiKey = "test-secret"
        let data = try JSONEncoder().encode(profile)
        #expect(!String(decoding: data, as: UTF8.self).contains("test-secret"))
        #expect(try JSONDecoder().decode(SpeechProfile.self, from: data).apiKey.isEmpty)
    }

    @Test func chunksPreserveUnicodeAndContent() {
        let text = String(repeating: "中文。Hello!👨‍👩‍👧‍👦咖啡☕️", count: 100)
        let chunks = SpeechText.chunks(text, maxCharacters: 37)
        #expect(chunks.joined() == text)
        #expect(chunks.allSatisfy { !$0.isEmpty && $0.count <= 37 })
    }

    @Test func localEndpointAndSpeed() throws {
        let profile = SpeechSettings().profiles[1]
        let request = try RemoteSpeechClient.request(text: "你好", profile: profile, speed: .nan)
        #expect(request.url?.path == "/v1/audio/speech")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
        #expect(body["speed"] as? Double == 1)
    }

    @Test func cloudRequiresKeyAndHTTPS() {
        var profile = SpeechSettings().profiles[0]
        #expect(throws: (any Error).self) { try RemoteSpeechClient.request(text: "你好", profile: profile, speed: 1) }
        profile.apiKey = "test-key"
        profile.baseURL = "http://example.com/v1"
        #expect(throws: (any Error).self) { try RemoteSpeechClient.request(text: "你好", profile: profile, speed: 1) }
    }
}
