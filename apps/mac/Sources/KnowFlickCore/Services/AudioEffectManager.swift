import Foundation
import AVFoundation
import AppKit

/// 拟真物理纸质音效管理器 (macOS Procedural Soundscapes & Audio FX)
///
/// 采用轻量程序化 16-bit PCM 波形合成技术，0 外部音频资源体积开销（0 KB 安装包增量），
/// 具备毫秒级瞬态响应与高保真物理质感，与 Android 端 100% 对齐。
@MainActor
public final class AudioEffectManager {
    public static let shared = AudioEffectManager()

    private let sampleRate: Double = 44100.0

    /// 全局音效开关
    public var isEnabled: Bool = true

    // 内存中缓存的 AVAudioPlayer 实例（预先生成并加载，点击时即刻响应）
    private var paperSlidePlayer: AVAudioPlayer?
    private var cardFlipPlayer: AVAudioPlayer?
    private var masteryChimePlayer: AVAudioPlayer?
    private var clickPlayer: AVAudioPlayer?

    private init() {
        // 在后台异步生成 PCM 与 WAV，再回到主线程装载播放器
        Task.detached(priority: .utility) {
            let slideData = Self.createWavData(pcm: Self.generatePaperSlidePcm(sampleRate: 44100.0), sampleRate: 44100.0)
            let flipData = Self.createWavData(pcm: Self.generateCardFlipPcm(sampleRate: 44100.0), sampleRate: 44100.0)
            let chimeData = Self.createWavData(pcm: Self.generateMasteryChimePcm(sampleRate: 44100.0), sampleRate: 44100.0)
            let clickData = Self.createWavData(pcm: Self.generateClickPcm(sampleRate: 44100.0), sampleRate: 44100.0)

            await MainActor.run {
                self.paperSlidePlayer = try? AVAudioPlayer(data: slideData)
                self.paperSlidePlayer?.prepareToPlay()

                self.cardFlipPlayer = try? AVAudioPlayer(data: flipData)
                self.cardFlipPlayer?.prepareToPlay()

                self.masteryChimePlayer = try? AVAudioPlayer(data: chimeData)
                self.masteryChimePlayer?.prepareToPlay()

                self.clickPlayer = try? AVAudioPlayer(data: clickData)
                self.clickPlayer?.prepareToPlay()
            }
        }
    }

    public func playPaperSlide() {
        play(paperSlidePlayer)
    }

    public func playCardFlip() {
        play(cardFlipPlayer)
    }

    public func playMasteryChime() {
        play(masteryChimePlayer)
    }

    public func playClick() {
        play(clickPlayer)
    }

    private func play(_ player: AVAudioPlayer?) {
        guard isEnabled, let p = player else { return }
        if p.isPlaying {
            p.stop()
            p.currentTime = 0
        }
        p.play()
    }

    // MARK: - WAV 封装

    nonisolated private static func createWavData(pcm: [Int16], sampleRate: Double) -> Data {
        let dataSize = pcm.count * 2
        let totalSize = 36 + dataSize
        var header = Data()

        // RIFF chunk
        header.append(contentsOf: "RIFF".utf8)
        var chunkSize = UInt32(totalSize).littleEndian
        header.append(Data(bytes: &chunkSize, count: 4))
        header.append(contentsOf: "WAVE".utf8)

        // fmt chunk
        header.append(contentsOf: "fmt ".utf8)
        var subchunk1Size = UInt32(16).littleEndian
        header.append(Data(bytes: &subchunk1Size, count: 4))
        var audioFormat = UInt16(1).littleEndian // PCM
        header.append(Data(bytes: &audioFormat, count: 2))
        var numChannels = UInt16(1).littleEndian // Mono
        header.append(Data(bytes: &numChannels, count: 2))
        var sampleRateUInt = UInt32(sampleRate).littleEndian
        header.append(Data(bytes: &sampleRateUInt, count: 4))
        var byteRate = UInt32(sampleRate * 2).littleEndian
        header.append(Data(bytes: &byteRate, count: 4))
        var blockAlign = UInt16(2).littleEndian
        header.append(Data(bytes: &blockAlign, count: 2))
        var bitsPerSample = UInt16(16).littleEndian
        header.append(Data(bytes: &bitsPerSample, count: 2))

        // data chunk
        header.append(contentsOf: "data".utf8)
        var subchunk2Size = UInt32(dataSize).littleEndian
        header.append(Data(bytes: &subchunk2Size, count: 4))

        // PCM 数据
        var pcmData = Data(capacity: dataSize)
        pcm.withUnsafeBufferPointer { buffer in
            pcmData.append(buffer)
        }

        return header + pcmData
    }

    // MARK: - 程序化波形合成算法（与 Android AudioEffectHelper.kt 100% 对齐）

    /// 合成高品质纸张摩擦粉红噪声脉冲（约 85ms，模拟纸牌划过桌面的质感沙沙声）
    nonisolated private static func generatePaperSlidePcm(sampleRate: Double) -> [Int16] {
        let durationMs = 85
        let numSamples = Int(sampleRate * (Double(durationMs) / 1000.0))
        var pcm = [Int16](repeating: 0, count: numSamples)

        var b0 = 0.0
        var b1 = 0.0
        var b2 = 0.0

        for i in 0..<numSamples {
            let white = Double.random(in: -1.0...1.0)
            b0 = 0.99886 * b0 + white * 0.0555179
            b1 = 0.99332 * b1 + white * 0.0750759
            b2 = 0.96900 * b2 + white * 0.1538520
            let pink = b0 + b1 + b2 + white * 0.5362

            let t = Double(i) / Double(numSamples)
            let envelope = t < 0.15 ? (t / 0.15) : exp(-6.0 * (t - 0.15))
            let sampleVal = (pink * envelope * 9000.0).clamped(to: -32767.0...32767.0)
            pcm[i] = Int16(sampleVal)
        }
        return pcm
    }

    /// 合成瞬态轻脆翻卡微鸣（约 25ms，快速下行滑音 1300Hz -> 320Hz）
    nonisolated private static func generateCardFlipPcm(sampleRate: Double) -> [Int16] {
        let durationMs = 25
        let numSamples = Int(sampleRate * (Double(durationMs) / 1000.0))
        var pcm = [Int16](repeating: 0, count: numSamples)

        var phase = 0.0
        for i in 0..<numSamples {
            let t = Double(i) / Double(numSamples)
            let freq = 1300.0 - 980.0 * (t * t)
            phase += 2.0 * .pi * freq / sampleRate

            let envelope = t < 0.08 ? (t / 0.08) : exp(-9.0 * (t - 0.08))
            let sampleVal = (sin(phase) * envelope * 12000.0).clamped(to: -32767.0...32767.0)
            pcm[i] = Int16(sampleVal)
        }
        return pcm
    }

    /// 合成优雅双音和谐泛音（C5 523Hz + C6 1046Hz，自然指数尾音，约 180ms）
    nonisolated private static func generateMasteryChimePcm(sampleRate: Double) -> [Int16] {
        let durationMs = 180
        let numSamples = Int(sampleRate * (Double(durationMs) / 1000.0))
        var pcm = [Int16](repeating: 0, count: numSamples)

        let freq1 = 523.25 // C5
        let freq2 = 1046.50 // C6
        let freq3 = 1567.98 // G6

        for i in 0..<numSamples {
            let t = Double(i) / sampleRate
            let progress = Double(i) / Double(numSamples)

            let wave = 0.55 * sin(2.0 * .pi * freq1 * t) +
                0.35 * sin(2.0 * .pi * freq2 * t) +
                0.10 * sin(2.0 * .pi * freq3 * t)

            let envelope = progress < 0.04 ? (progress / 0.04) : exp(-5.5 * (progress - 0.04))
            let sampleVal = (wave * envelope * 14000.0).clamped(to: -32767.0...32767.0)
            pcm[i] = Int16(sampleVal)
        }
        return pcm
    }

    /// 合成短促微机械确认敲击音（约 15ms）
    nonisolated private static func generateClickPcm(sampleRate: Double) -> [Int16] {
        let durationMs = 15
        let numSamples = Int(sampleRate * (Double(durationMs) / 1000.0))
        var pcm = [Int16](repeating: 0, count: numSamples)

        var phase = 0.0
        let freq = 880.0

        for i in 0..<numSamples {
            let progress = Double(i) / Double(numSamples)
            phase += 2.0 * .pi * freq / sampleRate

            let envelope = progress < 0.1 ? (progress / 0.1) : exp(-12.0 * (progress - 0.1))
            let sampleVal = (sin(phase) * envelope * 11000.0).clamped(to: -32767.0...32767.0)
            pcm[i] = Int16(sampleVal)
        }
        return pcm
    }
}

private extension Comparable {
    func clamped(to limits: ClosedRange<Self>) -> Self {
        min(max(self, limits.lowerBound), limits.upperBound)
    }
}
