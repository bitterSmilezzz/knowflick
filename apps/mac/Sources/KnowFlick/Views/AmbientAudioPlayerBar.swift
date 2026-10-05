import SwiftUI
import AppKit
import KnowFlickCore

/// 磨耳朵模式悬浮灵动播放条 (Ambient Audio Player Bar)
/// 悬浮在卡堆底部或顶部，提供实时声浪、播放进度、切歌、倍速与退出控制
struct AmbientAudioPlayerBar: View {
    let store: AppStore
    /// 卡片是否正在飞出（切卡动画中）。由调用方传入 `swipingCard != nil`；
    /// 缺省 false 以保持既有调用点可编译，未接线时内部仍有连点守卫兜底。
    var isTransitioning: Bool = false
    let onPrevious: () -> Void
    let onNext: () -> Void
    let onClose: () -> Void
    /// 展开全功能语音听书控制台（进度定位、语速音调、睡眠定时）
    var onOpenConsole: () -> Void = {}

    /// 连点守卫：切卡动画窗口内的重复点击不应重播当前卡
    @State private var nextRequestInFlight = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

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
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(InsightColor.textSecondary)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(InsightColor.surfaceSunken, in: Capsule())
                    .overlay(Capsule().strokeBorder(InsightColor.border, lineWidth: 1))
            }

            // 2. 当前正在朗读的卡片标题与进度
            if let card = currentCard {
                HStack(spacing: 8) {
                    Text(card.category)
                        .font(InsightFont.callout)
                        .foregroundStyle(InsightColor.textSecondary)

                    Text(card.displayHeadline)
                        .font(.system(size: 13, weight: .semibold, design: .serif))
                        .foregroundStyle(InsightColor.textPrimary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .frame(maxWidth: 240, alignment: .leading)

                    Text("\(Int(progress * 100))%")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundStyle(InsightColor.textSecondary)
                        .frame(width: 32, alignment: .trailing)
                }
                .id(card.id)
                .transition(.opacity)
                // 切卡时标题交叉淡化，不再瞬换
                .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: card.id)
            } else {
                Text("暂无卡片")
                    .font(InsightFont.caption)
                    .foregroundStyle(InsightColor.textSecondary)
            }

            // 3. 控制按钮组 (上一张、播放/暂停、下一张、语速)
            HStack(spacing: 8) {
                // 上一张
                BarIconButton(icon: "backward.fill", help: "上一张 (⌘Z)", action: onPrevious)
                    .disabled(store.history.isEmpty)

                // 播放 / 暂停
                Button {
                    if let card = currentCard {
                        speechService.togglePlayPause(for: card)
                    }
                } label: {
                    Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Color.black)
                        .frame(width: 30, height: 30)
                        .background(Color.white, in: Circle())
                        .animation(InsightMotion.tactile, value: isPlaying)
                }
                .buttonStyle(PressableButtonStyle(scale: 0.94))
                .disabled(currentCard == nil)
                .help(Text(LocalizedStringKey(isPlaying ? "暂停朗读 (⌘P)" : "继续朗读 (⌘P)")))
                .accessibilityLabel(isPlaying ? "暂停朗读" : "继续朗读")

                // 下一张
                BarIconButton(icon: "forward.fill", help: "切到下一张", action: handleNext)
                    .disabled(store.deck.count <= 1 || isTransitioning || nextRequestInFlight)

                // 语速切换 (0.75x -> 1.0x -> 1.25x -> 1.5x)
                Button {
                    cycleSpeed()
                } label: {
                    Text(speedText)
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .foregroundStyle(InsightColor.textSecondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(InsightColor.surfaceSunken, in: Capsule())
                        .overlay(Capsule().strokeBorder(InsightColor.border, lineWidth: 1))
                }
                .buttonStyle(PressableButtonStyle())
                .help(String(localized: "切换朗读语速 (当前 \(speedText))"))
                .accessibilityLabel("切换朗读语速")
                .accessibilityValue(speedText)

                // 全功能语音控制台
                BarIconButton(icon: "slider.horizontal.3", help: "语音听书控制台 ⌥⌘P", action: onOpenConsole)
            }

            Divider()
                .frame(height: 18)
                .overlay(InsightColor.border)

            // 4. 睡眠定时剩余与退出磨耳朵模式
            if let seconds = speechService.sleepTimerRemainingSeconds {
                Text(clock(seconds: seconds))
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .monospacedDigit()
                    .foregroundStyle(InsightColor.warning)
                    .help("睡眠定时器剩余时间")
                    .accessibilityLabel("睡眠定时器剩余 \(clock(seconds: seconds))")
                    .transition(.opacity)
                    // 只在「出现/消失」时过渡；逐秒跳动不参与动画
                    .animation(reduceMotion ? nil : EditorialSpring.state,
                               value: speechService.sleepTimerRemainingSeconds == nil)
            }

            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(InsightColor.textSecondary)
                    .frame(width: 24, height: 24)
            }
            .buttonStyle(PressableButtonStyle())
            .help("退出磨耳朵模式")
            .accessibilityLabel("退出磨耳朵模式")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(InsightColor.surface.opacity(0.95))
        .clipShape(Capsule())
        .overlay(Capsule().strokeBorder(InsightColor.border, lineWidth: 1))
        .shadow(color: Color.black.opacity(0.12), radius: 14, y: 5)
    }

    private func clock(seconds: Int) -> String {
        String(format: "%02d:%02d", max(0, seconds) / 60, max(0, seconds) % 60)
    }

    private var speedText: String {
        let val = speechService.speedMultiplier
        if abs(val - 0.75) < 0.05 { return "0.75x" }
        if abs(val - 1.0) < 0.05 { return "1.0x" }
        if abs(val - 1.25) < 0.05 { return "1.25x" }
        if abs(val - 1.5) < 0.05 { return "1.5x" }
        if abs(val - 2.0) < 0.05 { return "2.0x" }
        return String(format: "%.1fx", val)
    }

    /// 下一张：连点守卫 + 切卡完成后才允许再次触发，避免动画窗口内重播同一张
    private func handleNext() {
        guard !nextRequestInFlight, !isTransitioning else { return }
        guard store.deck.count > 1 else { return }
        nextRequestInFlight = true
        onNext()
        // 飞出动画约 0.25s，等顶部卡片真正换掉再解除守卫
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(0.3))
            nextRequestInFlight = false
        }
    }

    private func cycleSpeed() {
        let speeds: [Float] = [0.75, 1.0, 1.25, 1.5, 2.0]
        let current = speechService.speedMultiplier
        if let idx = speeds.firstIndex(where: { abs($0 - current) < 0.05 }) {
            let next = speeds[(idx + 1) % speeds.count]
            speechService.speedMultiplier = next
            // 高频开关走轻量通道：内存即时生效，落盘异步节流
            store.applySettingsChange { $0.speechRate = next }
        } else {
            speechService.speedMultiplier = 1.0
        }
    }
}

/// 磨耳朵条内的圆底图标钮：悬停提亮底色，按压回缩（静默）
private struct BarIconButton: View {
    let icon: String
    var size: CGFloat = 28
    var iconSize: CGFloat = 11
    var help: String
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: iconSize, weight: .semibold))
                .foregroundStyle(hovering ? InsightColor.textPrimary : InsightColor.textSecondary)
                .frame(width: size, height: size)
                .background(hovering ? InsightColor.surfaceRaised : InsightColor.surfaceSunken, in: Circle())
                .overlay(Circle().strokeBorder(hovering ? InsightColor.borderStrong : .clear, lineWidth: 1))
                .animation(InsightMotion.tactile, value: hovering)
        }
        .buttonStyle(PressableButtonStyle(scale: 0.92, playAudio: false))
        .onHover { hovering = $0 }
        .help(Text(LocalizedStringKey(help)))
        .accessibilityLabel(help)
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
                        .fill(InsightColor.success)
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
