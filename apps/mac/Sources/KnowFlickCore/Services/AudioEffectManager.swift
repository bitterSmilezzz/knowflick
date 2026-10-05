import Foundation
import AVFoundation
import AppKit

/// 拟真物理机械与纸质多感官音效管理器 (macOS Procedural Mechanical Soundscapes & Audio FX)
///
/// 采用轻量程序化 16-bit PCM 波形合成技术，0 外部音频资源体积开销（0 KB 安装包增量），
/// 具备毫秒级瞬态响应与高保真物理质感，支持双声道交替防截断播放。
@MainActor
public final class AudioEffectManager {
    public static let shared = AudioEffectManager()

    private let sampleRate: Double = 44100.0

    /// 全局音效开关
    public var isEnabled: Bool = true

    /// 双声道交替通道，避免快速连击断音
    private final class PlayerChannel {
        var players: [AVAudioPlayer]
        var index: Int = 0

        init(data: Data, count: Int = 2) {
            var list: [AVAudioPlayer] = []
            for _ in 0..<count {
                if let p = try? AVAudioPlayer(data: data) {
                    p.prepareToPlay()
                    list.append(p)
                }
            }
            self.players = list
        }

        func play(volume: Float = 1.0) {
            guard !players.isEmpty else { return }
            let p = players[index]
            index = (index + 1) % players.count
            p.volume = volume
            p.currentTime = 0
            p.play()
        }
    }

    private var paperSlideChannel: PlayerChannel?
    private var cardFlipChannel: PlayerChannel?
    private var masteryChimeChannel: PlayerChannel?
    private var clickChannel: PlayerChannel?
    private var mechanicalSwitchChannel: PlayerChannel?
    private var magneticSnapChannel: PlayerChannel?
    private var swooshChannel: PlayerChannel?
    private var celestialStarChannel: PlayerChannel?
    private var ratchetTickChannel: PlayerChannel?

    private init() {
        // 在后台异步生成 PCM 与 WAV，再回到主线程装载播放器
        Task.detached(priority: .utility) {
            let slideData = Self.createWavData(pcm: Self.generatePaperSlidePcm(sampleRate: 44100.0), sampleRate: 44100.0)
            let flipData = Self.createWavData(pcm: Self.generateCardFlipPcm(sampleRate: 44100.0), sampleRate: 44100.0)
            let chimeData = Self.createWavData(pcm: Self.generateMasteryChimePcm(sampleRate: 44100.0), sampleRate: 44100.0)
            let clickData = Self.createWavData(pcm: Self.generateClickPcm(sampleRate: 44100.0), sampleRate: 44100.0)
            let switchData = Self.createWavData(pcm: Self.generateMechanicalSwitchPcm(sampleRate: 44100.0), sampleRate: 44100.0)
            let snapData = Self.createWavData(pcm: Self.generateMagneticSnapPcm(sampleRate: 44100.0), sampleRate: 44100.0)
            let swooshData = Self.createWavData(pcm: Self.generateSwooshPcm(sampleRate: 44100.0), sampleRate: 44100.0)
            let starData = Self.createWavData(pcm: Self.generateCelestialStarPcm(sampleRate: 44100.0), sampleRate: 44100.0)
            let tickData = Self.createWavData(pcm: Self.generateRatchetTickPcm(sampleRate: 44100.0), sampleRate: 44100.0)

            await MainActor.run {
                self.paperSlideChannel = PlayerChannel(data: slideData)
                self.cardFlipChannel = PlayerChannel(data: flipData)
                self.masteryChimeChannel = PlayerChannel(data: chimeData)
                self.clickChannel = PlayerChannel(data: clickData)
                self.mechanicalSwitchChannel = PlayerChannel(data: switchData)
                self.magneticSnapChannel = PlayerChannel(data: snapData)
                self.swooshChannel = PlayerChannel(data: swooshData)
                self.celestialStarChannel = PlayerChannel(data: starData)
                self.ratchetTickChannel = PlayerChannel(data: tickData)
            }
        }
    }

    public func playPaperSlide() {
        guard isEnabled else { return }
        paperSlideChannel?.play(volume: 0.85)
    }

    public func playCardFlip() {
        guard isEnabled else { return }
        cardFlipChannel?.play(volume: 0.9)
    }

    public func playMasteryChime() {
        guard isEnabled else { return }
        masteryChimeChannel?.play(volume: 0.95)
    }

    public func playClick() {
        guard isEnabled else { return }
        clickChannel?.play(volume: 0.8)
    }

    /// 机械微动轻脆开关音（按钮按压、开关切换）
    public func playMechanicalSwitch() {
        guard isEnabled else { return }
        mechanicalSwitchChannel?.play(volume: 0.88)
    }

    /// 高级磁吸吸附闭合音（卡片复位、对齐吸附）
    public func playMagneticSnap() {
        guard isEnabled else { return }
        magneticSnapChannel?.play(volume: 0.92)
    }

    /// 空气动力破空风声（卡片飞出、高速甩动）
    public func playSwoosh() {
        guard isEnabled else { return }
        swooshChannel?.play(volume: 0.85)
    }

    /// 星尘水晶和弦微鸣（收藏、成就获得）
    public func playCelestialStar() {
        guard isEnabled else { return }
        celestialStarChannel?.play(volume: 0.95)
    }

    /// 机械刻度盘微棘轮齿声（张力越界、滚动步进）
    public func playRatchetTick() {
        guard isEnabled else { return }
        ratchetTickChannel?.play(volume: 0.72)
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

    // MARK: - 程序化波形合成算法（高保真物理与机械声学）

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

    /// 合成短促通用敲击音（约 15ms）
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

    /// 合成轻脆双脉冲机械微动开关音（约 18ms，簧片触发 + 轴心触底共鸣）
    nonisolated private static func generateMechanicalSwitchPcm(sampleRate: Double) -> [Int16] {
        let durationMs = 18
        let numSamples = Int(sampleRate * (Double(durationMs) / 1000.0))
        var pcm = [Int16](repeating: 0, count: numSamples)

        let leafFreq = 2650.0
        let bodyFreq = 780.0
        var leafPhase = 0.0
        var bodyPhase = 0.0

        for i in 0..<numSamples {
            let tSec = Double(i) / sampleRate
            let progress = Double(i) / Double(numSamples)

            // 脉冲 1: 簧片轻脆点击 (t = 0 ~ 5ms)
            leafPhase += 2.0 * .pi * leafFreq / sampleRate
            let leafEnv = progress < 0.05 ? (progress / 0.05) : exp(-20.0 * (progress - 0.05))
            let leafVal = sin(leafPhase) * leafEnv * 9500.0

            // 脉冲 2: 轴体底壳沉稳共鸣 (t = 2ms ~ 18ms)
            let bodyEnv: Double
            if tSec >= 0.002 {
                let bodyProg = (tSec - 0.002) / (Double(durationMs) / 1000.0 - 0.002)
                bodyPhase += 2.0 * .pi * bodyFreq / sampleRate
                bodyEnv = bodyProg < 0.08 ? (bodyProg / 0.08) : exp(-10.0 * (bodyProg - 0.08))
            } else {
                bodyEnv = 0.0
            }
            let bodyVal = sin(bodyPhase) * bodyEnv * 7500.0

            let combined = (leafVal + bodyVal).clamped(to: -32767.0...32767.0)
            pcm[i] = Int16(combined)
        }
        return pcm
    }

    /// 合成奢华磁吸吸附闭合音（约 38ms，低频磁性沉入 160Hz->90Hz + 陶瓷咔嗒）
    nonisolated private static func generateMagneticSnapPcm(sampleRate: Double) -> [Int16] {
        let durationMs = 38
        let numSamples = Int(sampleRate * (Double(durationMs) / 1000.0))
        var pcm = [Int16](repeating: 0, count: numSamples)

        var lowPhase = 0.0
        var snapPhase = 0.0

        for i in 0..<numSamples {
            let progress = Double(i) / Double(numSamples)

            // 磁吸低频低沉共鸣 (160Hz -> 90Hz 下潜)
            let lowFreq = 160.0 - 70.0 * progress
            lowPhase += 2.0 * .pi * lowFreq / sampleRate
            let lowEnv = progress < 0.06 ? (progress / 0.06) : exp(-6.5 * (progress - 0.06))
            let lowVal = sin(lowPhase) * lowEnv * 13000.0

            // 接触面硬质磁铁碰撞清脆咔嗒 (1950Hz)
            snapPhase += 2.0 * .pi * 1950.0 / sampleRate
            let snapEnv = progress < 0.03 ? (progress / 0.03) : exp(-16.0 * (progress - 0.03))
            let snapVal = sin(snapPhase) * snapEnv * 8500.0

            let sampleVal = (lowVal + snapVal).clamped(to: -32767.0...32767.0)
            pcm[i] = Int16(sampleVal)
        }
        return pcm
    }

    /// 合成卡片空气动力破空呼啸声（约 105ms，粉红噪声平滑凸包络）
    nonisolated private static func generateSwooshPcm(sampleRate: Double) -> [Int16] {
        let durationMs = 105
        let numSamples = Int(sampleRate * (Double(durationMs) / 1000.0))
        var pcm = [Int16](repeating: 0, count: numSamples)

        var b0 = 0.0
        var b1 = 0.0

        for i in 0..<numSamples {
            let t = Double(i) / Double(numSamples)
            let white = Double.random(in: -1.0...1.0)
            b0 = 0.94 * b0 + white * 0.06
            b1 = 0.88 * b1 + b0 * 0.12

            let bell = sin(.pi * t)
            let envelope = pow(bell, 1.8)
            let sampleVal = (b1 * envelope * 12000.0).clamped(to: -32767.0...32767.0)
            pcm[i] = Int16(sampleVal)
        }
        return pcm
    }

    /// 合成星尘水晶和弦和鸣（约 260ms，E6 + G#6 + B6 + E7 四音晶莹衰减）
    nonisolated private static func generateCelestialStarPcm(sampleRate: Double) -> [Int16] {
        let durationMs = 260
        let numSamples = Int(sampleRate * (Double(durationMs) / 1000.0))
        var pcm = [Int16](repeating: 0, count: numSamples)

        let f1 = 1318.51 // E6
        let f2 = 1661.22 // G#6
        let f3 = 1975.53 // B6
        let f4 = 2637.02 // E7

        for i in 0..<numSamples {
            let t = Double(i) / sampleRate
            let progress = Double(i) / Double(numSamples)

            let wave = 0.40 * sin(2.0 * .pi * f1 * t) +
                0.30 * sin(2.0 * .pi * f2 * t) +
                0.20 * sin(2.0 * .pi * f3 * t) +
                0.10 * sin(2.0 * .pi * f4 * t)

            let envelope = progress < 0.03 ? (progress / 0.03) : exp(-4.8 * (progress - 0.03))
            let sampleVal = (wave * envelope * 15000.0).clamped(to: -32767.0...32767.0)
            pcm[i] = Int16(sampleVal)
        }
        return pcm
    }

    /// 合成极短微机械棘轮刻度齿声（约 8ms，3400Hz 高频极速衰减）
    nonisolated private static func generateRatchetTickPcm(sampleRate: Double) -> [Int16] {
        let durationMs = 8
        let numSamples = Int(sampleRate * (Double(durationMs) / 1000.0))
        var pcm = [Int16](repeating: 0, count: numSamples)

        var phase = 0.0
        let freq = 3400.0

        for i in 0..<numSamples {
            let progress = Double(i) / Double(numSamples)
            phase += 2.0 * .pi * freq / sampleRate
            let envelope = progress < 0.1 ? (progress / 0.1) : exp(-18.0 * (progress - 0.1))
            let sampleVal = (sin(phase) * envelope * 9500.0).clamped(to: -32767.0...32767.0)
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
