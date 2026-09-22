import Foundation
@preconcurrency import AVFoundation
import Observation

/// 朗读内容范围
public enum SpeechPart: String, CaseIterable, Identifiable, Sendable {
    case full = "全文导读"
    case headline = "仅标题观点"
    case details = "正文详情"

    public var id: String { rawValue }
}

/// 播放器状态
public enum SpeechPlaybackState: Equatable, Sendable {
    case idle
    case playing(cardId: UUID, text: String, progress: Double)
    case paused(cardId: UUID, text: String, progress: Double)

    public var isPlaying: Bool {
        if case .playing = self { return true }
        return false
    }

    public var isPaused: Bool {
        if case .paused = self { return true }
        return false
    }

    public var activeCardId: UUID? {
        switch self {
        case .idle: return nil
        case .playing(let cardId, _, _): return cardId
        case .paused(let cardId, _, _): return cardId
        }
    }

    public var progress: Double {
        switch self {
        case .idle: return 0.0
        case .playing(_, _, let p): return p
        case .paused(_, _, let p): return p
        }
    }
}

/// 语音合成与磨耳朵播报核心服务
@MainActor
@Observable
public final class SpeechSynthesizerService: NSObject, @unchecked Sendable {

    // MARK: - 观测状态

    public var configuration = SpeechSettings()
    public private(set) var isPreparing = false
    public private(set) var lastError: String?
    private var remoteTask: Task<Void, Never>?
    private var remotePlayer: AVAudioPlayer?
    private var playbackID = UUID()

    public private(set) var state: SpeechPlaybackState = .idle
    public private(set) var currentWordRange: NSRange? = nil
    public private(set) var currentSpeakingText: String = ""
    public private(set) var isAmbientMode: Bool = false

    /// 播放速度倍率 (0.75x, 1.0x, 1.25x, 1.5x)
    public var speedMultiplier: Float = 1.0 {
        didSet {
            let clamped: Float = speedMultiplier.isFinite ? min(max(speedMultiplier, 0.5), 2.0) : 1
            if speedMultiplier != clamped {
                speedMultiplier = clamped
            }
        }
    }

    /// 用户首选声音标识符（"auto" 表示智能自动探测）
    public var preferredVoiceIdentifier: String = "auto"

    /// 磨耳朵模式下切换下一张卡片的停顿缓冲时间（秒）
    public var ambientGapSeconds: Double = 1.5

    /// 朗读音调倍率 (0.5x ~ 2.0x)，作用于系统合成器；云端朗读的音调由所选音色决定。
    public var pitchMultiplier: Float = 1.0 {
        didSet {
            let clamped: Float = pitchMultiplier.isFinite ? min(max(pitchMultiplier, 0.5), 2.0) : 1
            if pitchMultiplier != clamped {
                pitchMultiplier = clamped
            }
        }
    }

    /// 睡眠定时器剩余秒数；nil 表示未开启。到点后自动停止朗读并退出磨耳朵。
    public private(set) var sleepTimerRemainingSeconds: Int?

    /// 淡出音量倍率（0.15 ~ 1.0）：**只由睡眠定时的淡出窗口写入**，用户不直接调这个旋钮。
    public private(set) var volumeMultiplier: Float = 1.0

    /// 当前淡出计划。音量走 `volumeMultiplier`，语速系数叠加在 `speedMultiplier` 之上。
    private var sleepFadePlan = SleepFade.full

    /// 淡出窗口长度（秒）；0 表示到点硬停，不淡出。
    private var sleepFadeWindowSeconds = SleepFade.defaultWindowSeconds

    /// 实际下发给合成器的语速倍率 = 用户语速 × 淡出系数。
    /// 云端通道的语速是**请求时**烘进音频的，所以那一路只有音量在淡出——不假装做不到的事。
    private var effectiveSpeedMultiplier: Float { speedMultiplier * sleepFadePlan.speedScale }

    /// 当前朗读会话总时长（毫秒）：系统合成通道按字符数与语速估算，云端通道同样取估算值，
    /// 因为云端是逐句合成、逐句播放的，真实总时长要到最后一句才可知。
    public private(set) var durationMs: Int = 0

    /// 当前朗读位置（毫秒），与 `state.progress` 同源换算，供控制台时间轴显示与快进快退。
    public private(set) var currentPositionMs: Int = 0

    /// 当前（或最近一次）朗读的卡片
    public private(set) var currentCard: KnowledgeCard?

    // MARK: - 私有属性

    private let synthesizer = AVSpeechSynthesizer()
/// internal 以便测试通过 delegate 回调注入「播放完成」事件（AVSpeechUtterance 为引用类型）
    var currentUtterance: AVSpeechUtterance?
    private var totalCharactersCount: Int = 0

    // MARK: - 会话时间轴（进度定位与睡眠定时共用）

    /// 本次朗读的完整文本（已去噪），seek 由此截取剩余部分重朗读
    private var sessionText: String = ""
    private var sessionCardId: UUID?
    private var sessionCategory: String = ""
    private var sessionUTF16Count: Int = 1
    /// 当前 utterance 在会话文本中的 utf16 起点（seek 重朗读后不为 0）
    private var utteranceStartCharacter: Int = 0
    private var remoteParts: [String] = []
    private var remoteActivePartStart: Int = 0
    private var remoteActivePartLength: Int = 0
    private var sleepTimerTask: Task<Void, Never>?

    // 磨耳朵回调
    public var onAmbientAdvanceRequest: (() -> KnowledgeCard?)?

    private var ambientTimer: Task<Void, Never>?

    /// 中文平均语速 4.2 字/秒（与 Android SpeechController 同口径），按语速倍率加权
    static func estimatedDurationMs(characters: Int, speed: Float) -> Int {
        let charsPerSecond = max(1.0, Double(4.2 * (speed.isFinite ? speed : 1)))
        return max(1500, Int(Double(max(1, characters)) / charsPerSecond * 1000.0))
    }

    public override init() {
        super.init()
        synthesizer.delegate = self
    }

    // MARK: - 朗读控制

    /// 朗读卡片
    public func speak(card: KnowledgeCard, part: SpeechPart = .full) {
        ambientTimer?.cancel()
        stop()

        self.currentCard = card

        let textToRead: String
        switch part {
        case .headline:
            textToRead = "\(card.headline)。\(card.summary)"
        case .details:
            textToRead = card.details
        case .full:
            textToRead = "\(card.headline)。\(card.summary)。\(card.details)"
        }

        speakText(textToRead, cardId: card.id, category: card.category)
    }

    /// 朗读追问回复，保持当前卡片及播放状态一致。
    public func speakResponse(_ text: String, for card: KnowledgeCard) {
        stopAmbientMode()
        currentCard = card
        speakText(text, cardId: card.id, category: card.category)
    }

    /// 切换当前卡片的朗读 / 暂停
    public func togglePlayPause(for card: KnowledgeCard) {
        switch state {
        case .playing(let cardId, _, _) where cardId == card.id:
            pause()
        case .paused(let cardId, _, _) where cardId == card.id:
            resume()
        default:
            speak(card: card)
        }
    }

    public func pause() {
        if remoteTask != nil {
            remotePlayer?.pause()
            if case .playing(let id, let text, let progress) = state { state = .paused(cardId: id, text: text, progress: progress) }
            return
        }
        if synthesizer.isSpeaking {
            synthesizer.pauseSpeaking(at: .immediate)
            if case .playing(let cardId, let text, let progress) = state {
                state = .paused(cardId: cardId, text: text, progress: progress)
            }
        }
    }

    public func resume() {
        if remoteTask != nil {
            remotePlayer?.play()
            if case .paused(let id, let text, let progress) = state { state = .playing(cardId: id, text: text, progress: progress) }
            return
        }
        if synthesizer.isPaused {
            synthesizer.continueSpeaking()
            if case .paused(let cardId, let text, let progress) = state {
                state = .playing(cardId: cardId, text: text, progress: progress)
            }
        }
    }

    public func stop() {
        playbackID = UUID()
        remoteTask?.cancel()
        remoteTask = nil
        remotePlayer?.stop()
        remotePlayer = nil
        isPreparing = false
        ambientTimer?.cancel()
        if synthesizer.isSpeaking || synthesizer.isPaused {
            synthesizer.stopSpeaking(at: .immediate)
        }
        state = .idle
        currentWordRange = nil
        currentSpeakingText = ""
        currentUtterance = nil
        sessionText = ""
        sessionCardId = nil
        utteranceStartCharacter = 0
        remoteParts = []
        durationMs = 0
        currentPositionMs = 0
    }

    // MARK: - 进度定位与睡眠定时

    /// 定位到本次朗读的进度百分比 (0.0 ~ 1.0)。
    /// 系统合成器与 Android 端 TextToSpeech 一样没有原生 seek，采用「截断到目标字符后重朗读」实现；
    /// 云端通道目标落在当前句内时直接驱动播放器，跨句则从该处重新起流。
    public func seek(toProgress target: Double) {
        guard state != .idle, !sessionText.isEmpty, let cardId = sessionCardId else { return }
        let ratio = min(max(target.isFinite ? target : 0, 0), 0.95)
        let offset = min(Int(ratio * Double(sessionUTF16Count)), max(0, sessionUTF16Count - 1))

        if remoteTask != nil {
            if let player = remotePlayer, player.duration > 0,
               offset >= remoteActivePartStart, offset < remoteActivePartStart + remoteActivePartLength {
                let local = Double(offset - remoteActivePartStart) / Double(max(1, remoteActivePartLength))
                player.currentTime = min(max(local, 0), 0.999) * player.duration
                applyRemoteProgress(partStart: remoteActivePartStart, partLength: remoteActivePartLength, fraction: local)
                return
            }
            playbackID = UUID()
            remoteTask?.cancel()
            remoteTask = nil
            remotePlayer?.stop()
            remotePlayer = nil
            startRemoteSession(fromCharacter: offset, resumeProgress: ratio)
            return
        }

        // 暂停态下同样直接发声定位：continueSpeaking 只会从旧位置续播，跨不过定位点
        synthesizer.stopSpeaking(at: .immediate)
        let remaining = suffix(of: sessionText, fromUTF16: offset)
        guard !remaining.isEmpty else {
            finishPlayback()
            return
        }
        utteranceStartCharacter = offset
        speakRawText(remaining, cardId: cardId, category: sessionCategory)
    }

    /// 相对快进 / 快退（单位秒，负数回退）
    public func seekRelative(seconds: Int) {
        guard durationMs > 0 else { return }
        seek(toProgress: Double(currentPositionMs + seconds * 1000) / Double(durationMs))
    }

    /// 从头重新朗读当前会话
    public func restart() {
        seek(toProgress: 0)
    }

    /// 设定睡眠定时器（分钟，<= 0 表示关闭）；到点后停止朗读并退出磨耳朵
    public func setSleepTimer(minutes: Int, fadeSeconds: Int = SleepFade.defaultWindowSeconds) {
        sleepTimerTask?.cancel()
        sleepTimerTask = nil
        guard minutes > 0 else {
            sleepTimerRemainingSeconds = nil
            sleepFadeWindowSeconds = 0
            applyFadePlan(SleepFade.full)
            return
        }
        sleepFadeWindowSeconds = fadeSeconds
        sleepTimerRemainingSeconds = minutes * 60
        applyFadePlan(SleepFade.full)
        sleepTimerTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(1)) } catch { return }
                guard let self, !Task.isCancelled else { return }
                if self.tickSleepTimer() { return }
            }
        }
    }

    /// 定时器前进一秒；走到终点时停播并返回 true。
    /// internal 供单测逐格驱动，避免测试里真等一分六十秒。
    @discardableResult
    func tickSleepTimer() -> Bool {
        guard let remaining = sleepTimerRemainingSeconds else { return true }
        guard remaining > 1 else {
            sleepTimerRemainingSeconds = nil
            applyFadePlan(SleepFade.full)
            stopAmbientMode()
            return true
        }
        sleepTimerRemainingSeconds = remaining - 1
        applyFadePlan(SleepFade.plan(remainingSeconds: remaining - 1, windowSeconds: sleepFadeWindowSeconds))
        return false
    }

    /// 把淡出计划搬到当前播放路径上：音量对系统合成与云端音频都实时生效（云端在下一句加载时跟上）。
    /// internal 供单测断言，不经它就没有任何可观测副作用。
    @discardableResult
    func applyFadePlan(_ plan: SleepFade.Plan) -> SleepFade.Plan {
        sleepFadePlan = plan
        volumeMultiplier = plan.volume
        remotePlayer?.volume = plan.volume
        return plan
    }

    /// 按会话文本取 utf16 后缀；起点落在代理对中间时回退一格，避免撕开 emoji
    private func suffix(of text: String, fromUTF16 offset: Int) -> String {
        let units = Array(text.utf16)
        guard offset < units.count else { return "" }
        var start = max(0, offset)
        if start > 0, start < units.count, (0xDC00...0xDFFF).contains(units[start]) {
            start -= 1
        }
        return String(decoding: units[start...], as: UTF16.self)
    }

    private func applyProgress(_ progress: Double) {
        let clamped = min(max(progress, 0), 1)
        currentPositionMs = Int(clamped * Double(durationMs))
        guard let cardId = sessionCardId else { return }
        state = state.isPaused
            ? .paused(cardId: cardId, text: sessionText, progress: clamped)
            : .playing(cardId: cardId, text: sessionText, progress: clamped)
    }

    private func applyRemoteProgress(partStart: Int, partLength: Int, fraction: Double) {
        let consumed = min(max(fraction, 0), 1) * Double(partLength)
        let progress = min(1.0, (Double(partStart) + consumed) / Double(max(1, sessionUTF16Count)))
        currentPositionMs = Int(progress * Double(durationMs))
        if case .playing(let cardId, let text, _) = state {
            state = .playing(cardId: cardId, text: text, progress: progress)
        }
    }

    /// utterance 内部进度 → 会话整体进度（seek 后从中间重朗读，起点不再为 0）
    private func overallProgress(forUtterance local: Double) -> Double {
        let start = min(utteranceStartCharacter, sessionUTF16Count)
        let remaining = max(0, sessionUTF16Count - start)
        let consumed = min(max(local, 0), 1) * Double(remaining)
        return min(1.0, (Double(start) + consumed) / Double(max(1, sessionUTF16Count)))
    }

    // MARK: - 磨耳朵连续模式 (Ambient Mode)

    /// 开启磨耳朵连续自动播报模式
    public func startAmbientMode(initialCard: KnowledgeCard?) {
        guard let card = initialCard ?? onAmbientAdvanceRequest?() else {
            stopAmbientMode()
            return
        }
        isAmbientMode = true
        speak(card: card, part: .full)
    }

    /// 关闭磨耳朵模式
    public func stopAmbientMode() {
        isAmbientMode = false
        ambientTimer?.cancel()
        stop()
    }

    /// 切换磨耳朵模式状态
    public func toggleAmbientMode(currentCard: KnowledgeCard?) {
        if isAmbientMode {
            stopAmbientMode()
        } else {
            startAmbientMode(initialCard: currentCard)
        }
    }

    /// 使用编辑中的配置试听，无需保存，也不改变全局默认设置。
    public func preview(configuration: SpeechSettings, voice: String, speed: Float, pitch: Float = 1.0) {
        let oldConfiguration = self.configuration
        let oldVoice = preferredVoiceIdentifier
        let oldSpeed = speedMultiplier
        let oldPitch = pitchMultiplier
        self.configuration = configuration
        preferredVoiceIdentifier = voice
        speedMultiplier = speed
        pitchMultiplier = pitch
        let card = KnowledgeCard(category: "冷知识", headline: "试听", summary: "", details: "", source: .seed)
        speakResponse("你好，欢迎来到 KnowFlick。放慢一点，在知识之间发现新的联系。人工智能 AI，让学习更有趣。", for: card)
        self.configuration = oldConfiguration
        preferredVoiceIdentifier = oldVoice
        speedMultiplier = oldSpeed
        pitchMultiplier = oldPitch
    }

    private func speakText(_ raw: String, cardId: UUID, category: String) {
        lastError = nil
        let text = SpeechText.prepare(raw)
        guard !text.isEmpty else { return }
        beginSession(text, cardId: cardId, category: category)
        if configuration.selectedProfile != nil {
            startRemoteSession(fromCharacter: 0)
        } else {
            speakRawText(text, cardId: cardId, category: category)
        }
    }

    /// 建立一次朗读会话的时间轴基准：文本、分句、时长估算与进度归零
    private func beginSession(_ text: String, cardId: UUID, category: String) {
        sessionText = text
        sessionCardId = cardId
        sessionCategory = category
        sessionUTF16Count = max(1, text.utf16.count)
        utteranceStartCharacter = 0
        remoteParts = SpeechText.chunks(text)
        remoteActivePartStart = 0
        remoteActivePartLength = 0
        durationMs = Self.estimatedDurationMs(characters: sessionUTF16Count, speed: speedMultiplier)
        currentPositionMs = 0
        currentSpeakingText = text
        state = .playing(cardId: cardId, text: text, progress: 0)
    }

    /// 从会话文本的 `fromCharacter`（utf16 偏移）起/续跑云端合成流。
    /// `resumeProgress` 只用于把时间轴立刻贴回定位点，避免重新合成期间进度条跳回 0。
    private func startRemoteSession(fromCharacter offset: Int, resumeProgress: Double = 0) {
        guard let profile = configuration.selectedProfile else { return }
        let token = playbackID
        let speed = speedMultiplier
        isPreparing = true
        applyProgress(resumeProgress)
        remoteTask = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await self.runRemoteSession(profile: profile, speed: speed, token: token, fromCharacter: offset)
                guard self.playbackID == token else { return }
                self.remotePlayer = nil
                self.remoteTask = nil
                self.isPreparing = false
                self.finishPlayback()
            } catch {
                guard !Task.isCancelled, self.playbackID == token else { return }
                self.isPreparing = false
                self.remotePlayer = nil
                self.remoteTask = nil
                guard self.configuration.fallbackToSystem else {
                    self.lastError = error.localizedDescription
                    self.state = .idle
                    self.isAmbientMode = false
                    return
                }
                self.lastError = "语音服务暂不可用，已切换系统声音：\(error.localizedDescription)"
                try? await self.waitWhilePaused(token: token)
                guard self.playbackID == token, let cardId = self.sessionCardId else { return }
                // 兜底接管时同样带上定位点，否则进度条会从 0 重来
                self.utteranceStartCharacter = offset
                self.speakRawText(self.suffix(of: self.sessionText, fromUTF16: offset),
                                  cardId: cardId, category: self.sessionCategory)
            }
        }
    }

    private func runRemoteSession(profile: SpeechProfile, speed: Float, token: UUID, fromCharacter: Int) async throws {
        var completedCharacters = 0
        for part in remoteParts {
            try Task.checkCancellation()
            let partStart = completedCharacters
            let partLength = max(1, part.utf16.count)
            completedCharacters += partLength
            // 定位点之前的句子直接跳过，不再请求合成
            guard partStart + partLength > fromCharacter else { continue }

            remoteActivePartStart = partStart
            remoteActivePartLength = partLength
            isPreparing = true
            let payload = suffix(of: part, fromUTF16: max(0, fromCharacter - partStart))
            let data = try await RemoteSpeechClient().audio(text: payload, profile: profile, speed: speed)
            guard playbackID == token else { return }
            try await waitWhilePaused(token: token)
            guard playbackID == token else { return }

            let player = try AVAudioPlayer(data: data)
            // 淡出进行中加载的分句要立刻跟上当前音量，否则每句开头都会跳回满音量
            player.volume = volumeMultiplier
            remotePlayer = player
            isPreparing = false
            guard player.prepareToPlay(), player.play() else { throw AIError.parse("无法播放语音音频") }
            while player.isPlaying || state.isPaused {
                try await Task.sleep(for: .milliseconds(100))
                guard playbackID == token else { return }
                if !state.isPaused {
                    applyRemoteProgress(partStart: partStart, partLength: partLength,
                                        fraction: player.duration > 0 ? player.currentTime / player.duration : 0)
                }
            }
            remotePlayer = nil
        }
    }

    private func waitWhilePaused(token: UUID) async throws {
        while state.isPaused {
            try await Task.sleep(for: .milliseconds(100))
            guard playbackID == token else { return }
        }
    }

    private func finishPlayback() {
        state = .idle
        currentWordRange = nil
        guard isAmbientMode else { return }
        ambientTimer?.cancel()
        ambientTimer = Task { [weak self] in
            guard let self else { return }
            let gap = self.ambientGapSeconds.isFinite ? min(60, max(0, self.ambientGapSeconds)) : 1.5
            do { try await Task.sleep(for: .seconds(gap)) } catch { return }
            guard !Task.isCancelled, self.isAmbientMode else { return }
            if let card = self.onAmbientAdvanceRequest?() { self.speak(card: card) }
            else { self.stopAmbientMode() }
        }
    }

    // MARK: - 内部底层合成

    private func speakRawText(_ text: String, cardId: UUID, category: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            state = .idle
            return
        }

        self.currentSpeakingText = trimmed
        self.totalCharactersCount = max(1, trimmed.utf16.count)

        let utterance = AVSpeechUtterance(string: trimmed)

        // 基础语速约 0.50，按 speedMultiplier 缩放
        let baseRate = AVSpeechUtteranceDefaultSpeechRate * 0.88
        let adjustedRate = baseRate * effectiveSpeedMultiplier
        utterance.rate = min(max(adjustedRate, AVSpeechUtteranceMinimumSpeechRate), AVSpeechUtteranceMaximumSpeechRate)
        utterance.pitchMultiplier = pitchMultiplier
        utterance.volume = volumeMultiplier
        utterance.preUtteranceDelay = 0.15
        utterance.postUtteranceDelay = 0.2

        utterance.voice = detectBestVoice(for: trimmed, category: category)
        self.currentUtterance = utterance

        let progress = overallProgress(forUtterance: 0)
        currentPositionMs = Int(progress * Double(durationMs))
        state = .playing(cardId: cardId, text: trimmed, progress: progress)
        // 测试替身：真实合成会让系统 TextToSpeech 引擎在进程内挂回调，
        // 测试拆解期触发悬空引用（objc_retain 崩溃），故单测抑制真实 speak
        if !suppressesRealSynthesis {
            synthesizer.speak(utterance)
        }
    }

    /// 测试专用：置位后只更新状态机与 utterance，不调用系统合成器
    var suppressesRealSynthesis = false

    /// 智能语种与音色探测
    private func detectBestVoice(for text: String, category: String) -> AVSpeechSynthesisVoice? {
        let preferredVoiceIdentifier = self.preferredVoiceIdentifier
        // 用户指定了有效的声音
        if preferredVoiceIdentifier != "auto",
           let voice = AVSpeechSynthesisVoice(identifier: preferredVoiceIdentifier) {
            return voice
        }

        // 检测主要文本语种
        let latinCount = text.unicodeScalars.filter { $0.isASCII && CharacterSet.letters.contains($0) }.count
        let totalLetterCount = max(1, text.unicodeScalars.filter { CharacterSet.letters.contains($0) }.count)
        let latinRatio = Double(latinCount) / Double(totalLetterCount)

        // 英文为主的内容
        if latinRatio > 0.65 {
            if let enVoice = bestVoice(language: "en-US") {
                return enVoice
            }
        }

        // 日文平假名/片假名检测
        let hasJapanese = text.unicodeScalars.contains { scalar in
            (scalar.value >= 0x3040 && scalar.value <= 0x309F) || (scalar.value >= 0x30A0 && scalar.value <= 0x30FF)
        }
        if hasJapanese && latinRatio < 0.3 {
            if let jaVoice = bestVoice(language: "ja-JP") {
                return jaVoice
            }
        }

        // 默认优质中文声音 (zh-CN)
        if let zhVoice = bestVoice(language: "zh-CN") {
            return zhVoice
        }

        return AVSpeechSynthesisVoice(language: Locale.current.identifier)
    }

    private func bestVoice(language: String) -> AVSpeechSynthesisVoice? {
        Self.availableVoices().first { $0.language == language } ?? AVSpeechSynthesisVoice(language: language)
    }

    /// 获取系统中可用的全部高质量语音列表
    public static func availableVoices() -> [AVSpeechSynthesisVoice] {
        AVSpeechSynthesisVoice.speechVoices().sorted {
            if $0.language.starts(with: "zh") && !$1.language.starts(with: "zh") { return true }
            if !$0.language.starts(with: "zh") && $1.language.starts(with: "zh") { return false }
            if $0.quality.rawValue != $1.quality.rawValue { return $0.quality.rawValue > $1.quality.rawValue }
            return $0.name < $1.name
        }
    }
}

// MARK: - AVSpeechSynthesizerDelegate

extension SpeechSynthesizerService: AVSpeechSynthesizerDelegate {
    public nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        nonisolated(unsafe) let utteranceToken = utterance
        Task { @MainActor in
            guard self.currentUtterance === utteranceToken else { return }
            guard let card = self.currentCard else { return }
            let progress = self.overallProgress(forUtterance: 0)
            self.currentPositionMs = Int(progress * Double(self.durationMs))
            self.state = .playing(cardId: card.id, text: self.currentSpeakingText, progress: progress)
        }
    }

    public nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString characterRange: NSRange, utterance: AVSpeechUtterance) {
        nonisolated(unsafe) let utteranceToken = utterance
        Task { @MainActor in
            guard self.currentUtterance === utteranceToken else { return }
            self.currentWordRange = characterRange
            let local = min(1.0, Double(characterRange.location + characterRange.length) / Double(self.totalCharactersCount))
            let progress = self.overallProgress(forUtterance: local)
            self.currentPositionMs = Int(progress * Double(self.durationMs))
            if let card = self.currentCard {
                self.state = .playing(cardId: card.id, text: self.currentSpeakingText, progress: progress)
            }
        }
    }

    public nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        nonisolated(unsafe) let utteranceToken = utterance
        Task { @MainActor in
            guard self.currentUtterance === utteranceToken else { return }
            self.currentPositionMs = self.durationMs
            self.finishPlayback()
        }
    }

    public nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        nonisolated(unsafe) let utteranceToken = utterance
        Task { @MainActor in
            guard self.currentUtterance === utteranceToken else { return }
            self.state = .idle
            self.currentWordRange = nil
        }
    }
}
