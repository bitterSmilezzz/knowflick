import SwiftUI
import AppKit
import KnowFlickCore

/// 磨耳朵模式悬浮灵动播放条 (Ambient Audio Player Bar)
/// 悬浮在卡堆底部或顶部，提供实时声浪、播放进度、切歌、倍速与退出控制
struct AmbientAudioPlayerBar: View {
    let store: AppStore
    let onPrevious: () -> Void
    let onNext: () -> Void
    let onClose: () -> Void

    private var speechService: SpeechSynthesizerService {
        store.speechService
    }

    private var currentCard: KnowledgeCard? {
        store.topCard
    }

    private var isPlaying: Bool {
        speechService.state.isPlaying
    }

    private var progress: Double {
        speechService.state.progress
    }

    var body: some View {
        HStack(spacing: 14) {
            // 1. 声浪动画与磨耳朵状态标记
            HStack(spacing: 8) {
                AudioWaveformBars(isPlaying: isPlaying)
                    .frame(width: 22, height: 16)

                Text("磨耳朵")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(EditorialColor.aiAmber)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(EditorialColor.aiAmber.opacity(0.15), in: Capsule())
                    .overlay(Capsule().strokeBorder(EditorialColor.aiAmber.opacity(0.3), lineWidth: 1))
            }

            // 2. 当前正在朗读的卡片标题与进度
            if let card = currentCard {
                HStack(spacing: 8) {
                    Text(card.category)
                        .font(EditorialFont.badge)
                        .foregroundStyle(EditorialColor.textSecondary)

                    Text(card.headline)
                        .font(.system(size: 13, weight: .semibold, design: .serif))
                        .foregroundStyle(EditorialColor.textPrimary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .frame(maxWidth: 240, alignment: .leading)

                    Text("\(Int(progress * 100))%")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundStyle(EditorialColor.textSecondary)
                        .frame(width: 32, alignment: .trailing)
                }
            } else {
                Text("暂无卡片")
                    .font(EditorialFont.caption)
                    .foregroundStyle(EditorialColor.textSecondary)
            }

            // 3. 控制按钮组 (上一张、播放/暂停、下一张、语速)
            HStack(spacing: 8) {
                // 上一张
                Button(action: onPrevious) {
                    Image(systemName: "backward.fill")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(EditorialColor.textSecondary)
                        .frame(width: 28, height: 28)
                        .background(Color.white.opacity(0.06), in: Circle())
                }
                .buttonStyle(PressableButtonStyle())
                .disabled(store.history.isEmpty)
                .help("上一张 (⌘Z)")

                // 播放 / 暂停
                Button {
                    if let card = currentCard {
                        speechService.togglePlayPause(for: card)
                    }
                } label: {
                    Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Color.black)
                        .frame(width: 34, height: 34)
                        .background(EditorialColor.likeGreen, in: Circle())
                        .shadow(color: EditorialColor.likeGreen.opacity(0.4), radius: 6, y: 1)
                }
                .buttonStyle(PressableButtonStyle())
                .help(isPlaying ? "暂停朗读 (⌘P)" : "继续朗读 (⌘P)")

                // 下一张
                Button(action: onNext) {
                    Image(systemName: "forward.fill")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(EditorialColor.textSecondary)
                        .frame(width: 28, height: 28)
                        .background(Color.white.opacity(0.06), in: Circle())
                }
                .buttonStyle(PressableButtonStyle())
                .disabled(store.deck.count <= 1)
                .help("切到下一张")

                // 语速切换 (0.75x -> 1.0x -> 1.25x -> 1.5x)
                Button {
                    cycleSpeed()
                } label: {
                    Text(speedText)
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .foregroundStyle(EditorialColor.textSecondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(Color.white.opacity(0.06), in: Capsule())
                        .overlay(Capsule().strokeBorder(Color.white.opacity(0.1), lineWidth: 1))
                }
                .buttonStyle(PressableButtonStyle())
                .help("切换朗读语速 (当前 \(speedText))")
            }

            Divider()
                .frame(height: 18)
                .overlay(Color.white.opacity(0.15))

            // 4. 退出磨耳朵模式
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(EditorialColor.textSecondary)
                    .frame(width: 24, height: 24)
            }
            .buttonStyle(PressableButtonStyle())
            .help("退出磨耳朵模式 (Esc)")
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .background(EditorialColor.glassSurface, in: Capsule())
        .overlay(Capsule().strokeBorder(EditorialColor.glassBorder, lineWidth: 1.2))
        .shadow(
            color: EditorialColor.dynamic(
                light: NSColor.black.withAlphaComponent(0.14),
                dark: NSColor.black.withAlphaComponent(0.55)
            ),
            radius: 16,
            y: 8
        )
    }

    private var speedText: String {
        let val = speechService.speedMultiplier
        if abs(val - 0.75) < 0.05 { return "0.75x" }
        if abs(val - 1.0) < 0.05 { return "1.0x" }
        if abs(val - 1.25) < 0.05 { return "1.25x" }
        if abs(val - 1.5) < 0.05 { return "1.5x" }
        return String(format: "%.1fx", val)
    }

    private func cycleSpeed() {
        let speeds: [Float] = [0.75, 1.0, 1.25, 1.5]
        let current = speechService.speedMultiplier
        if let idx = speeds.firstIndex(where: { abs($0 - current) < 0.05 }) {
            let next = speeds[(idx + 1) % speeds.count]
            speechService.speedMultiplier = next
            store.settings.speechRate = next
            try? store.saveSettings(store.settings)
        } else {
            speechService.speedMultiplier = 1.0
        }
    }
}

/// 动效声浪条 (Audio Waveform Bars)
struct AudioWaveformBars: View {
    let isPlaying: Bool

    @State private var phase: CGFloat = 0.0

    var body: some View {
        TimelineView(.animation(minimumInterval: 0.12, paused: !isPlaying)) { timeline in
            HStack(spacing: 2.5) {
                ForEach(0..<5) { index in
                    let heightRatio: CGFloat = isPlaying ? barHeight(for: index, date: timeline.date) : 0.25
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(EditorialColor.likeGreen)
                        .frame(width: 2.5, height: max(3.5, 16.0 * heightRatio))
                }
            }
        }
    }

    private func barHeight(for index: Int, date: Date) -> CGFloat {
        let time = date.timeIntervalSinceReferenceDate * 4.5
        let offset = Double(index) * 0.9
        let wave = sin(time + offset) * 0.5 + 0.5
        return CGFloat(0.25 + wave * 0.75)
    }
}
