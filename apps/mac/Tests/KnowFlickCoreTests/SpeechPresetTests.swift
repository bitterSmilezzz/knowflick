import Foundation
import AVFoundation
import Testing

@testable import KnowFlickCore

/// 听书档位与睡前淡出。
///
/// 档位数值与 Android `speech/SpeechPresetTest.kt` 逐条相同：同一档在手机与桌面上必须
/// 给出同样的语速/音调/停顿，否则「双端一致」在耳朵层面就是假的。
@MainActor
struct SpeechPresetTests {

    // MARK: - 档位表

    @Test("四档数值与 Android 逐条一致")
    func presetValuesMatchAcrossPlatforms() {
        #expect(SpeechPreset.all.map { $0.id } == ["standard", "warm", "commute", "bedtime"])

        #expect(SpeechPreset.standard.speed == 1.00)
        #expect(SpeechPreset.standard.pitch == 1.00)
        #expect(SpeechPreset.standard.gapSeconds == 1.5)

        #expect(SpeechPreset.warm.speed == 0.92)
        #expect(SpeechPreset.warm.pitch == 0.95)
        #expect(SpeechPreset.warm.gapSeconds == 2.0)

        #expect(SpeechPreset.commute.speed == 1.18)
        #expect(SpeechPreset.commute.pitch == 1.00)
        #expect(SpeechPreset.commute.gapSeconds == 0.8)

        #expect(SpeechPreset.bedtime.speed == 0.85)
        #expect(SpeechPreset.bedtime.pitch == 0.90)
        #expect(SpeechPreset.bedtime.gapSeconds == 2.5)
        #expect(SpeechPreset.bedtime.sleepMinutes == 20)
        #expect(SpeechPreset.bedtime.fadesOut)
    }

    @Test("只有睡前档会动睡眠定时")
    func onlyBedtimeTouchesTimer() {
        #expect(SpeechPreset.standard.sleepMinutes == 0)
        #expect(SpeechPreset.warm.sleepMinutes == 0)
        #expect(SpeechPreset.commute.sleepMinutes == 0)
        #expect(SpeechPreset.bedtime.sleepMinutes == 20)
    }

    @Test("依赖真人音色的档位被标出来，UI 才好在系统音色下说实话")
    func realVoicePreferenceIsFlagged() {
        #expect(!SpeechPreset.standard.prefersRealVoice)
        #expect(!SpeechPreset.commute.prefersRealVoice)
        #expect(SpeechPreset.warm.prefersRealVoice)
        #expect(SpeechPreset.bedtime.prefersRealVoice)
    }

    // MARK: - 反推生效档

    @Test("用档位自己的数值能反推出该档")
    func matchRecoversPresetFromItsOwnValues() {
        for preset in SpeechPreset.all {
            #expect(SpeechPreset.match(speed: preset.speed, pitch: preset.pitch, gapSeconds: preset.gapSeconds) == preset)
        }
    }

    @Test("手调过任一滑块就回落到自定义")
    func handTunedValuesFallBackToCustom() {
        #expect(SpeechPreset.match(speed: 1.05, pitch: 1.00, gapSeconds: 1.5) == nil)
        #expect(SpeechPreset.match(speed: 1.00, pitch: 1.10, gapSeconds: 1.5) == nil)
        #expect(SpeechPreset.match(speed: 1.00, pitch: 1.00, gapSeconds: 3.0) == nil)
    }

    @Test("容差吃掉尾差但不吃掉真实改动")
    func toleranceIsNarrow() {
        #expect(SpeechPreset.match(speed: 0.920_001, pitch: 0.95, gapSeconds: 2.0) == SpeechPreset.warm)
        #expect(SpeechPreset.match(speed: 0.97, pitch: 0.95, gapSeconds: 2.0) == nil)
    }

    @Test("未知 id 解析为 nil")
    func byIDResolves() {
        #expect(SpeechPreset.byID("warm") == SpeechPreset.warm)
        #expect(SpeechPreset.byID("nope") == nil)
        #expect(SpeechPreset.byID(nil) == nil)
    }

    // MARK: - 应用档位（经 AppStore 单点回灌到语音服务）

    @Test("档位写回设置并即时同步到语音服务，且落盘")
    func applyPresetReachesServiceAndDisk() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let service = SpeechSynthesizerService()
        service.suppressesRealSynthesis = true
        let store = AppStore(storage: Storage(baseDir: directory), speechService: service)
        defer {
            store.flushPersistence()
            try? FileManager.default.removeItem(at: directory)
        }

        store.applySpeechPreset(.commute)
        #expect(abs(service.speedMultiplier - 1.18) < 0.001)
        #expect(abs(service.pitchMultiplier - 1.00) < 0.001)
        #expect(service.ambientGapSeconds == 0.8)
        #expect(store.activeSpeechPreset == SpeechPreset.commute)
        // 通勤档不该偷偷挂上睡眠定时
        #expect(service.sleepTimerRemainingSeconds == nil)

        store.flushPersistence()
        let reloaded = Storage(baseDir: directory).loadSettings()
        #expect(abs(reloaded.speechRate - 1.18) < 0.001)
        #expect(reloaded.ambientGapSeconds == 0.8)
    }

    @Test("睡前档挂上 20 分钟淡出定时")
    func bedtimePresetArmsFadingTimer() {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let service = SpeechSynthesizerService()
        service.suppressesRealSynthesis = true
        let store = AppStore(storage: Storage(baseDir: directory), speechService: service)
        defer {
            store.flushPersistence()
            try? FileManager.default.removeItem(at: directory)
        }

        store.applySpeechPreset(.bedtime)
        #expect(service.sleepTimerRemainingSeconds == 20 * 60)
        #expect(store.activeSpeechPreset == SpeechPreset.bedtime)
        // 定时刚挂上时不能已经是淡出状态
        #expect(service.volumeMultiplier == 1.0)
    }

    @Test("手动改语速后档位显示回落到自定义")
    func manualSpeedChangeClearsPreset() {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let service = SpeechSynthesizerService()
        service.suppressesRealSynthesis = true
        let store = AppStore(storage: Storage(baseDir: directory), speechService: service)
        defer {
            store.flushPersistence()
            try? FileManager.default.removeItem(at: directory)
        }

        store.applySpeechPreset(.warm)
        #expect(store.activeSpeechPreset == SpeechPreset.warm)
        store.applySettingsChange { $0.speechRate = 1.0 }
        #expect(store.activeSpeechPreset == nil)
    }
}

/// 淡出曲线本身（纯函数）+ 它作用到播放器状态上的结果。
struct SleepFadeTests {

    @Test("窗口外不变")
    func outsideWindowNothingChanges() {
        #expect(SleepFade.plan(remainingSeconds: 31) == SleepFade.full)
        #expect(SleepFade.plan(remainingSeconds: SleepFade.defaultWindowSeconds) == SleepFade.full)
    }

    @Test("音量与语速单调下降到地板")
    func rampsMonotonicallyToFloor() {
        var previousVolume = Float(1)
        var previousSpeed = Float(1)
        for remaining in stride(from: 29, through: 0, by: -1) {
            let plan = SleepFade.plan(remainingSeconds: remaining)
            #expect(plan.volume <= previousVolume + 0.000001, "音量必须单调下降 @\(remaining)s")
            #expect(plan.speedScale <= previousSpeed + 0.000001, "语速必须单调下降 @\(remaining)s")
            previousVolume = plan.volume
            previousSpeed = plan.speedScale
        }
        #expect(SleepFade.plan(remainingSeconds: 0).volume == SleepFade.minVolume)
        #expect(SleepFade.plan(remainingSeconds: 0).speedScale == SleepFade.minSpeedScale)
    }

    @Test("窗口中点是一半")
    func halfWayIsHalfWayDown() {
        let plan = SleepFade.plan(remainingSeconds: 15, windowSeconds: 30)
        #expect(abs(plan.volume - 0.575) < 0.001)
        #expect(abs(plan.speedScale - 0.95) < 0.001)
    }

    @Test("窗口为 0 表示到点硬停")
    func zeroWindowMeansHardStop() {
        #expect(SleepFade.plan(remainingSeconds: 1, windowSeconds: 0) == SleepFade.full)
    }

    @Test("负数剩余不会跌破地板")
    func negativeRemainingStaysOnFloor() {
        let plan = SleepFade.plan(remainingSeconds: -5)
        #expect(plan.volume == SleepFade.minVolume)
        #expect(plan.speedScale == SleepFade.minSpeedScale)
    }

    @Test("双端曲线一致：与 Android 断言同一组采样点")
    func curveMatchesAndroidSamples() {
        // Android SleepFadeTest 里 halfWayIsHalfWayDown 的同一组数字
        let at20 = SleepFade.plan(remainingSeconds: 20, windowSeconds: 30)
        #expect(abs(at20.volume - (0.15 + 0.85 * (20.0 / 30.0))) < 0.001)
        #expect(abs(at20.speedScale - (1 - 0.10 * (10.0 / 30.0))) < 0.001)
    }
}

/// 淡出是否真的搬到了播放器状态上（音量倍率 + 下一句语速）。
@MainActor
struct SleepFadeApplicationTests {

    private func makeService() -> SpeechSynthesizerService {
        let service = SpeechSynthesizerService()
        service.suppressesRealSynthesis = true
        return service
    }

    @Test("定时逐格推进时音量按计划下降")
    func timerTickDrivesVolume() throws {
        let service = makeService()
        service.setSleepTimer(minutes: 1, fadeSeconds: 30)
        #expect(service.sleepTimerRemainingSeconds == 60)
        #expect(service.volumeMultiplier == 1.0)

        // 走到窗口内第一格（剩余 30 秒时仍满音量，29 秒开始淡）
        for _ in 0..<(60 - 30) {
            _ = service.tickSleepTimer()
        }
        #expect(service.sleepTimerRemainingSeconds == 30)
        #expect(service.volumeMultiplier == 1.0)

        _ = service.tickSleepTimer()
        #expect(service.sleepTimerRemainingSeconds == 29)
        #expect(abs(service.volumeMultiplier - SleepFade.plan(remainingSeconds: 29).volume) < 0.0001)
    }

    @Test("窗口外的定时不改变音量")
    func timerOutsideWindowKeepsFullVolume() throws {
        let service = makeService()
        service.setSleepTimer(minutes: 1, fadeSeconds: 30)
        _ = service.tickSleepTimer()
        #expect(service.volumeMultiplier == 1.0)
    }

    @Test("关掉定时会把音量恢复到满")
    func cancellingTimerRestoresVolume() throws {
        let service = makeService()
        service.applyFadePlan(SleepFade.plan(remainingSeconds: 3))
        #expect(service.volumeMultiplier < 0.3)
        service.setSleepTimer(minutes: 0)
        #expect(service.volumeMultiplier == 1.0)
        #expect(service.sleepTimerRemainingSeconds == nil)
    }

    @Test("淡出中的语速系数作用到下一句，当前句不硬掰")
    func fadeScalesNextUtteranceOnly() throws {
        let service = makeService()
        service.speedMultiplier = 1.0
        let deepest = SleepFade.plan(remainingSeconds: 0)   // 最深处：语速 0.9 倍、音量 0.15
        service.applyFadePlan(deepest)
        let card = KnowledgeCard(
            category: "学习", headline: "主动回忆", summary: "摘要",
            details: String(repeating: "字", count: 40), source: .seed
        )
        service.speak(card: card)
        let utterance = try #require(service.currentUtterance)
        let expected = AVSpeechUtteranceDefaultSpeechRate * 0.88 * 1.0 * deepest.speedScale
        #expect(abs(utterance.rate - expected) < 0.001)
        #expect(abs(utterance.volume - SleepFade.minVolume) < 0.001)

        // 关掉淡出后重新朗读，语速要回到用户设定值
        service.applyFadePlan(SleepFade.full)
        service.speak(card: card)
        let restored = try #require(service.currentUtterance)
        #expect(abs(restored.rate - AVSpeechUtteranceDefaultSpeechRate * 0.88) < 0.001)
        #expect(restored.volume == 1.0)
    }
}
