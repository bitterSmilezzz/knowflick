import Foundation
import AVFoundation
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
    public static let shared = SpeechSynthesizerService()

    // MARK: - 观测状态

    public private(set) var state: SpeechPlaybackState = .idle
    public private(set) var currentWordRange: NSRange? = nil
    public private(set) var currentSpeakingText: String = ""
    public private(set) var isAmbientMode: Bool = false

    /// 播放速度倍率 (0.75x, 1.0x, 1.25x, 1.5x)
    public var speedMultiplier: Float = 1.0 {
        didSet {
            let clamped = min(max(speedMultiplier, 0.5), 2.0)
            if speedMultiplier != clamped {
                speedMultiplier = clamped
            }
        }
    }

    /// 用户首选声音标识符（"auto" 表示智能自动探测）
    public var preferredVoiceIdentifier: String = "auto"

    /// 磨耳朵模式下切换下一张卡片的停顿缓冲时间（秒）
    public var ambientGapSeconds: Double = 1.5

    // MARK: - 私有属性

    private let synthesizer = AVSpeechSynthesizer()
    private var currentCard: KnowledgeCard?
    private var currentUtterance: AVSpeechUtterance?
    private var totalCharactersCount: Int = 0

    // 磨耳朵回调
    public var onAmbientAdvanceRequest: (() -> KnowledgeCard?)?

    private var ambientTimer: Task<Void, Never>?

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

        speakRawText(textToRead, cardId: card.id, category: card.category)
    }

    /// 针对特定词汇进行独立发音（如点击重点单词、专有名词、音标）
    public func speakTerm(_ term: String, languageHint: String? = nil) {
        let trimmed = term.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        let utterance = AVSpeechUtterance(string: trimmed)
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.95
        utterance.pitchMultiplier = 1.0
        utterance.volume = 1.0

        if let hint = languageHint, let voice = AVSpeechSynthesisVoice(language: hint) {
            utterance.voice = voice
        } else {
            utterance.voice = detectBestVoice(for: trimmed, category: "")
        }

        if !synthesizer.isSpeaking {
            synthesizer.speak(utterance)
        } else {
            synthesizer.speak(utterance)
        }
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
        if synthesizer.isSpeaking {
            synthesizer.pauseSpeaking(at: .immediate)
            if case .playing(let cardId, let text, let progress) = state {
                state = .paused(cardId: cardId, text: text, progress: progress)
            }
        }
    }

    public func resume() {
        if synthesizer.isPaused {
            synthesizer.continueSpeaking()
            if case .paused(let cardId, let text, let progress) = state {
                state = .playing(cardId: cardId, text: text, progress: progress)
            }
        }
    }

    public func stop() {
        ambientTimer?.cancel()
        if synthesizer.isSpeaking || synthesizer.isPaused {
            synthesizer.stopSpeaking(at: .immediate)
        }
        state = .idle
        currentWordRange = nil
        currentSpeakingText = ""
        currentUtterance = nil
    }

    // MARK: - 磨耳朵连续模式 (Ambient Mode)

    /// 开启磨耳朵连续自动播报模式
    public func startAmbientMode(initialCard: KnowledgeCard?) {
        isAmbientMode = true
        if let card = initialCard {
            speak(card: card, part: .full)
        } else if let next = onAmbientAdvanceRequest?() {
            speak(card: next, part: .full)
        }
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
        let baseRate = AVSpeechUtteranceDefaultSpeechRate
        let adjustedRate = baseRate * speedMultiplier
        utterance.rate = min(max(adjustedRate, AVSpeechUtteranceMinimumSpeechRate), AVSpeechUtteranceMaximumSpeechRate)
        utterance.pitchMultiplier = 1.0
        utterance.volume = 1.0
        utterance.preUtteranceDelay = 0.15
        utterance.postUtteranceDelay = 0.2

        utterance.voice = detectBestVoice(for: trimmed, category: category)
        self.currentUtterance = utterance

        state = .playing(cardId: cardId, text: trimmed, progress: 0.0)
        synthesizer.speak(utterance)
    }

    /// 智能语种与音色探测
    private func detectBestVoice(for text: String, category: String) -> AVSpeechSynthesisVoice {
        // 用户指定了有效的声音
        if preferredVoiceIdentifier != "auto",
           let voice = AVSpeechSynthesisVoice(identifier: preferredVoiceIdentifier) {
            return voice
        }

        // 针对粤语/方言特色卡片
        if category == "冷知识" && (text.contains("粤语") || text.contains("白话")) {
            if let cantonese = AVSpeechSynthesisVoice(language: "zh-HK") ?? AVSpeechSynthesisVoice(language: "yue-CN") {
                return cantonese
            }
        }

        // 检测主要文本语种
        let latinCount = text.unicodeScalars.filter { $0.isASCII && CharacterSet.letters.contains($0) }.count
        let totalLetterCount = max(1, text.unicodeScalars.filter { CharacterSet.letters.contains($0) }.count)
        let latinRatio = Double(latinCount) / Double(totalLetterCount)

        // 英文为主的内容
        if latinRatio > 0.65 {
            if let enVoice = AVSpeechSynthesisVoice(language: "en-US") {
                return enVoice
            }
        }

        // 日文平假名/片假名检测
        let hasJapanese = text.unicodeScalars.contains { scalar in
            (scalar.value >= 0x3040 && scalar.value <= 0x309F) || (scalar.value >= 0x30A0 && scalar.value <= 0x30FF)
        }
        if hasJapanese && latinRatio < 0.3 {
            if let jaVoice = AVSpeechSynthesisVoice(language: "ja-JP") {
                return jaVoice
            }
        }

        // 默认优质中文声音 (zh-CN)
        if let zhVoice = AVSpeechSynthesisVoice(language: "zh-CN") {
            return zhVoice
        }

        return AVSpeechSynthesisVoice(language: Locale.current.identifier) ?? AVSpeechSynthesisVoice(language: "zh-CN")!
    }

    /// 获取系统中可用的全部高质量语音列表
    public static func availableVoices() -> [AVSpeechSynthesisVoice] {
        AVSpeechSynthesisVoice.speechVoices().sorted {
            if $0.language.starts(with: "zh") && !$1.language.starts(with: "zh") { return true }
            if !$0.language.starts(with: "zh") && $1.language.starts(with: "zh") { return false }
            return $0.name < $1.name
        }
    }
}

// MARK: - AVSpeechSynthesizerDelegate

extension SpeechSynthesizerService: AVSpeechSynthesizerDelegate {
    public nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        Task { @MainActor in
            if let card = self.currentCard {
                self.state = .playing(cardId: card.id, text: self.currentSpeakingText, progress: 0.0)
            }
        }
    }

    public nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString characterRange: NSRange, utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.currentWordRange = characterRange
            let progress = min(1.0, Double(characterRange.location + characterRange.length) / Double(self.totalCharactersCount))
            if let card = self.currentCard {
                self.state = .playing(cardId: card.id, text: self.currentSpeakingText, progress: progress)
            }
        }
    }

    public nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.currentWordRange = nil

            if self.isAmbientMode {
                // 磨耳朵模式：停顿指定秒数后自动进入下一张
                self.ambientTimer?.cancel()
                self.ambientTimer = Task {
                    try? await Task.sleep(nanoseconds: UInt64(self.ambientGapSeconds * 1_000_000_000))
                    guard !Task.isCancelled, self.isAmbientMode else { return }

                    if let nextCard = self.onAmbientAdvanceRequest?() {
                        self.speak(card: nextCard, part: .full)
                    } else {
                        self.stopAmbientMode()
                    }
                }
            } else {
                self.state = .idle
            }
        }
    }

    public nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.state = .idle
            self.currentWordRange = nil
        }
    }
}
