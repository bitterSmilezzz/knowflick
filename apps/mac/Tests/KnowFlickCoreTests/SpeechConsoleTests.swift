import Foundation
import AVFoundation
import Testing
@testable import KnowFlickCore

/// 语音听书控制台所依赖的 Core 能力：音调、时间轴与进度定位、睡眠定时器、设置回灌。
/// 全部用例置 `suppressesRealSynthesis`，只驱动状态机，不触碰系统合成器。
@MainActor
struct SpeechConsoleTests {
    private func makeService() -> SpeechSynthesizerService {
        let service = SpeechSynthesizerService()
        service.suppressesRealSynthesis = true
        return service
    }

    private func card(_ headline: String = "主动回忆", details: String) -> KnowledgeCard {
        KnowledgeCard(category: "学习", headline: headline, summary: "摘要", details: details, source: .seed)
    }

    /// 服务内部的合成器回调经 `Task { @MainActor }` 转发，测试里让出若干轮主线程队列再断言
    private func settle() async {
        for _ in 0..<8 {
            try? await Task.sleep(for: .milliseconds(20))
        }
    }

    // MARK: - 音调

    @Test func pitchIsClampedAndAppliedToEveryUtterance() throws {
        let service = makeService()
        service.pitchMultiplier = 9
        #expect(service.pitchMultiplier == 2.0)
        service.pitchMultiplier = -5
        #expect(service.pitchMultiplier == 0.5)
        service.pitchMultiplier = .nan
        #expect(service.pitchMultiplier == 1.0)

        service.pitchMultiplier = 1.15
        service.speak(card: card(details: String(repeating: "字", count: 40)))
        let utterance = try #require(service.currentUtterance)
        #expect(abs(utterance.pitchMultiplier - 1.15) < 0.001)
    }

    @Test func settingsPitchReachesSpeechServiceThroughAppStore() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = AppStore(storage: Storage(baseDir: directory), speechService: makeService())
        defer {
            store.flushPersistence()
            try? FileManager.default.removeItem(at: directory)
        }

        store.applySettingsChange { $0.speechPitch = 0.85 }
        #expect(store.speechService.pitchMultiplier == 0.85)

        store.flushPersistence()
        #expect(Storage(baseDir: directory).loadSettings().speechPitch == 0.85)
    }

    @Test func legacySettingsWithoutPitchStillDecodeToNaturalPitch() throws {
        let legacy = Data(#"{"baseURL":"","model":"","apiKey":"","autoGenerate":false,"categoryFilter":""}"#.utf8)
        #expect(try JSONDecoder().decode(AISettings.self, from: legacy).speechPitch == 1.0)

        var settings = AISettings.default
        settings.speechPitch = 1.15
        #expect(try JSONDecoder().decode(AISettings.self, from: JSONEncoder().encode(settings)).speechPitch == 1.15)
    }

    // MARK: - 时间轴与定位

    @Test func speechSessionEstablishesTimelineAtZero() throws {
        let service = makeService()
        service.speak(card: card(details: String(repeating: "知识", count: 60)))
        let spoken = service.currentSpeakingText
        #expect(service.durationMs == SpeechSynthesizerService.estimatedDurationMs(
            characters: spoken.utf16.count, speed: service.speedMultiplier))
        #expect(service.currentPositionMs == 0)
        #expect(service.state.progress == 0)
        #expect(service.currentCard?.headline == "主动回忆")
    }

    @Test func durationEstimateMatchesAndroidCharacterRate() {
        #expect(SpeechSynthesizerService.estimatedDurationMs(characters: 42, speed: 1) == 10_000)
        #expect(SpeechSynthesizerService.estimatedDurationMs(characters: 42, speed: 2) == 5_000)
        #expect(SpeechSynthesizerService.estimatedDurationMs(characters: 1, speed: 0.75) == 1_500)
        #expect(SpeechSynthesizerService.estimatedDurationMs(characters: 10, speed: .nan)
                == SpeechSynthesizerService.estimatedDurationMs(characters: 10, speed: 1))
    }

    @Test func utteranceRangeDrivesOverallProgressAndPosition() async throws {
        let service = makeService()
        service.speak(card: card(details: String(repeating: "字", count: 100)))
        let utterance = try #require(service.currentUtterance)
        let total = service.currentSpeakingText.utf16.count

        service.speechSynthesizer(AVSpeechSynthesizer(), willSpeakRangeOfSpeechString: NSRange(location: total / 2, length: 1), utterance: utterance)
        await settle()

        #expect(service.state.progress > 0.45 && service.state.progress < 0.55)
        #expect(service.currentPositionMs == Int(service.state.progress * Double(service.durationMs)))
    }

    @Test func seekRespeaksRemainingTailAndKeepsOverallTimeline() throws {
        let service = makeService()
        service.speak(card: card(details: String(repeating: "字", count: 100)))
        let before = service.currentSpeakingText

        service.seek(toProgress: 0.5)
        let after = service.currentSpeakingText

        #expect(after != before)
        #expect(before.hasSuffix(after))
        #expect(service.state.progress > 0.45 && service.state.progress < 0.55)
        #expect(service.currentPositionMs > 0)
        #expect(service.state.isPlaying)
    }

    @Test func seekRelativeClampsAtBothEndsOfTheTimeline() throws {
        let service = makeService()
        service.speak(card: card(details: String(repeating: "字", count: 100)))

        service.seekRelative(seconds: -600)
        #expect(service.state.progress < 0.01)

        service.seekRelative(seconds: 6_000)
        #expect(service.state.progress > 0.94)
        #expect(service.state.progress <= 0.95)

        // 定位点不会越界到文本末尾之外：仍能取到可朗读的剩余部分
        #expect(!service.currentSpeakingText.isEmpty)
    }

    @Test func restartReturnsTimelineToTheBeginning() throws {
        let service = makeService()
        service.speak(card: card(details: String(repeating: "字", count: 100)))
        service.seek(toProgress: 0.7)
        #expect(service.state.progress > 0.6)

        service.restart()
        #expect(service.state.progress < 0.01)
        #expect(service.currentPositionMs == 0)
    }

    @Test func seekOnAnIdleSessionDoesNothing() throws {
        let service = makeService()
        service.seek(toProgress: 0.5)
        service.seekRelative(seconds: 5)
        service.restart()
        #expect(service.state == .idle)
        #expect(service.durationMs == 0)
        #expect(service.currentPositionMs == 0)
    }

    // MARK: - 睡眠定时

    @Test func sleepTimerCountsDownAndStopsPlaybackAtZero() throws {
        let service = makeService()
        service.speak(card: card(details: String(repeating: "字", count: 60)))
        service.startAmbientMode(initialCard: card(details: String(repeating: "字", count: 60)))
        service.setSleepTimer(minutes: 1)
        #expect(service.sleepTimerRemainingSeconds == 60)
        #expect(service.state.isPlaying)

        var advanced = 0
        while !service.tickSleepTimer() {
            advanced += 1
        }
        #expect(advanced == 59)
        #expect(service.sleepTimerRemainingSeconds == nil)
        #expect(service.state == .idle)
        #expect(!service.isAmbientMode)
        service.stop()
    }

    @Test func sleepTimerCanBeReplacedAndCancelled() {
        let service = makeService()
        service.setSleepTimer(minutes: 15)
        #expect(service.sleepTimerRemainingSeconds == 900)

        service.setSleepTimer(minutes: 30)
        #expect(service.sleepTimerRemainingSeconds == 1_800)

        service.setSleepTimer(minutes: 0)
        #expect(service.sleepTimerRemainingSeconds == nil)
    }

    @Test func sleepTimerSurvivesPlaybackStop() {
        let service = makeService()
        service.setSleepTimer(minutes: 15)
        service.speak(card: card(details: "正文"))
        service.stop()
        #expect(service.state == .idle)
        #expect((service.sleepTimerRemainingSeconds ?? 0) > 800)
        service.setSleepTimer(minutes: 0)
    }
}
