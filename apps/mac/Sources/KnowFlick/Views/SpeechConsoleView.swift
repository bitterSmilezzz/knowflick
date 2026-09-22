import SwiftUI
import AppKit
import KnowFlickCore

/// 语音听书控制台（对齐 Android 端 AudioConsoleSheet）：
/// 1. 当前朗读卡片精粹看板与播放状态；
/// 2. 可拖拽进度条定位与时间显示；
/// 3. 播控按钮群：快退 5 秒、上一张、播放/暂停、下一张、快进 5 秒；
/// 4. 磨耳朵开关、听书档位、语速、音调、翻卡停顿间隔与睡眠定时器；
/// 5. 语速/音调/间隔改动即时写回设置并落盘；
/// 6. 睡眠定时结束前 30 秒音量与语速一起淡出（睡前档自动挂上）。
struct SpeechConsoleView: View {
    let store: AppStore
    var onPrevious: (() -> Void)? = nil
    var onNext: (() -> Void)? = nil
    let onClose: () -> Void

    @State private var isScrubbing = false
    @State private var scrubValue: Double = 0

    private var service: SpeechSynthesizerService { store.speechService }
    private var card: KnowledgeCard? { service.currentCard }
    private var isSpeaking: Bool { service.state.isPlaying }
    private var progress: Double { service.state.progress }
    private var sleepSeconds: Int? { service.sleepTimerRemainingSeconds }

    var body: some View {
        ZStack {
            EditorialColor.dynamic(
                light: NSColor.windowBackgroundColor.withAlphaComponent(0.97),
                dark: NSColor(white: 0.12, alpha: 0.97)
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                headerBar
                Divider().overlay(EditorialColor.glassDivider)

                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        nowPlayingSection
                        progressSection
                        transportSection
                        tuningSection
                    }
                    .padding(20)
                }
            }
        }
        .frame(minWidth: 540, idealWidth: 580, minHeight: 520, idealHeight: 600)
    }

    // MARK: - 顶栏

    private var headerBar: some View {
        HStack {
            Image(systemName: "headphones")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(EditorialColor.aiAmber)
            Text("语音听书控制台")
                .font(EditorialFont.modalTitle)
                .foregroundStyle(EditorialColor.textPrimary)
            Spacer()
            if let seconds = sleepSeconds {
                Label("睡眠 \(clock(seconds: seconds))", systemImage: "moon.zzz.fill")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(EditorialColor.aiAmber)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(EditorialColor.aiAmberBg, in: Capsule())
                    .overlay(Capsule().strokeBorder(EditorialColor.aiAmberBorder, lineWidth: 1))
            }
            GlassIconButton(icon: "xmark", help: "关闭 (Esc)") {
                onClose()
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }

    // MARK: - 正在朗读

    private var nowPlayingSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let card {
                HStack {
                    Text(card.category)
                        .font(EditorialFont.badge)
                        .foregroundStyle(EditorialColor.aiAmber)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(EditorialColor.aiAmberBg, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .strokeBorder(EditorialColor.aiAmberBorder, lineWidth: 1)
                        )
                    Spacer()
                    HStack(spacing: 6) {
                        AudioWaveformBars(isPlaying: isSpeaking)
                            .frame(width: 22, height: 16)
                        Text(statusText)
                            .font(EditorialFont.caption)
                            .foregroundStyle(isSpeaking ? EditorialColor.likeGreen : EditorialColor.textMuted)
                    }
                }

                Text(card.headline)
                    .font(EditorialFont.sectionTitle)
                    .foregroundStyle(EditorialColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                if !card.summary.isEmpty {
                    Text(card.summary)
                        .font(EditorialFont.labelSmall)
                        .foregroundStyle(EditorialColor.textMuted)
                        .lineLimit(2)
                }
            } else {
                Text("尚未开始朗读")
                    .font(EditorialFont.label)
                    .foregroundStyle(EditorialColor.textSecondary)
                Text("点下方播放键朗读当前卡片，或回到卡堆按 ⌘P 开始听书。")
                    .font(EditorialFont.caption)
                    .foregroundStyle(EditorialColor.textMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(sectionBackground)
    }

    private var statusText: String {
        if isSpeaking { return "正在朗读" }
        if service.state.isPaused { return "已暂停" }
        if service.isPreparing { return "正在合成语音…" }
        return "已停止"
    }

    // MARK: - 进度与时间

    private var progressSection: some View {
        let totalMs = max(1, service.durationMs)
        let shown = isScrubbing ? scrubValue : progress

        return VStack(spacing: 6) {
            Slider(
                value: Binding(get: { shown }, set: { scrubValue = $0 }),
                in: 0...1,
                onEditingChanged: { editing in
                    if editing {
                        isScrubbing = true
                        scrubValue = progress
                    } else {
                        isScrubbing = false
                        service.seek(toProgress: scrubValue)
                    }
                }
            )
            .disabled(card == nil)
            .accessibilityLabel("朗读进度")
            .accessibilityValue("\(Int(shown * 100))%")

            HStack {
                Text(clock(ms: Int(shown * Double(totalMs))))
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(EditorialColor.textSecondary)
                Spacer()
                Text(clock(ms: totalMs))
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(EditorialColor.textMuted)
            }
            .padding(.horizontal, 2)
        }
    }

    // MARK: - 播控按钮群

    private var transportSection: some View {
        HStack {
            Spacer()
            ConsoleIconButton(icon: "gobackward.5", help: "快退 5 秒") {
                service.seekRelative(seconds: -5)
            }
            Spacer()
            ConsoleIconButton(icon: "backward.fill", help: "上一张") {
                onPrevious?()
            }
            .disabled(onPrevious == nil)
            Spacer()
            ConsolePlayButton(isPlaying: isSpeaking) {
                guard let target = card ?? store.topCard else { return }
                service.togglePlayPause(for: target)
            }
            Spacer()
            ConsoleIconButton(icon: "forward.fill", help: "下一张") {
                onNext?()
            }
            .disabled(onNext == nil)
            Spacer()
            ConsoleIconButton(icon: "goforward.5", help: "快进 5 秒") {
                service.seekRelative(seconds: 5)
            }
            Spacer()
        }
        .padding(.vertical, 6)
    }

    // MARK: - 听书调节

    private var tuningSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("磨耳朵连续听书")
                        .font(EditorialFont.label)
                        .foregroundStyle(EditorialColor.textPrimary)
                    Text("单张播完后自动朗读下一张卡片")
                        .font(EditorialFont.caption)
                        .foregroundStyle(EditorialColor.textMuted)
                }
                Spacer(minLength: 12)
                Toggle("磨耳朵连续听书", isOn: Binding(
                    get: { service.isAmbientMode },
                    set: { _ in service.toggleAmbientMode(currentCard: card ?? store.topCard) }
                ))
                .toggleStyle(.switch)
                .labelsHidden()
            }

            hairline

            tuningRow(
                title: "听书档位",
                detail: store.activeSpeechPreset?.label ?? "自定义",
                note: presetNote,
                options: [
                    ("精读标准", 0), ("温和真人", 1), ("通勤清醒", 2), ("睡前轻缓", 3),
                ],
                // -1 表示没有命中任何一档：手调过滑块后不该继续顶着某档的名字
                selected: Double(store.activeSpeechPreset.flatMap { SpeechPreset.all.firstIndex(of: $0) } ?? -1)
            ) { value in
                let index = Int(value)
                if index >= 0, index < SpeechPreset.all.count {
                    store.applySpeechPreset(SpeechPreset.all[index])
                }
            }

            hairline

            tuningRow(
                title: "朗读语速",
                detail: String(format: "%.2fx", service.speedMultiplier),
                note: "调整后从下一句朗读起生效",
                options: [
                    ("0.75x", 0.75), ("1.0x", 1.0), ("1.25x", 1.25), ("1.5x", 1.5), ("2.0x", 2.0),
                ],
                selected: Double(service.speedMultiplier)
            ) { value in
                store.applySettingsChange { $0.speechRate = Float(value) }
            }

            hairline

            tuningRow(
                title: "音调微调",
                detail: pitchDescription,
                note: "仅作用于系统声音；云端朗读的音调由所选音色决定",
                options: [
                    ("低沉 0.85x", 0.85), ("标准 1.0x", 1.0), ("清亮 1.15x", 1.15),
                ],
                selected: Double(service.pitchMultiplier)
            ) { value in
                store.applySettingsChange { $0.speechPitch = Float(value) }
            }

            hairline

            tuningRow(
                title: "翻卡停顿间隔",
                detail: String(format: "%.1f 秒", service.ambientGapSeconds),
                note: "磨耳朵模式下两张卡之间的缓冲",
                options: [
                    ("紧凑 0.8s", 0.8), ("适中 1.5s", 1.5), ("充裕 3.0s", 3.0),
                ],
                selected: service.ambientGapSeconds
            ) { value in
                store.applySettingsChange { $0.ambientGapSeconds = value }
            }

            hairline

            tuningRow(
                title: "睡眠定时",
                detail: sleepDescription,
                note: "到点自动停止朗读并退出磨耳朵",
                options: [
                    ("关闭", 0), ("15 分钟", 15), ("30 分钟", 30), ("60 分钟", 60),
                ],
                selected: Double(selectedSleepMinutes)
            ) { value in
                service.setSleepTimer(minutes: Int(value))
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(sectionBackground)
    }

    private func tuningRow(
        title: String,
        detail: String,
        note: String,
        options: [(label: String, value: Double)],
        selected: Double,
        pick: @escaping (Double) -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title)
                    .font(EditorialFont.label)
                    .foregroundStyle(EditorialColor.textPrimary)
                Spacer()
                Text(detail)
                    .font(EditorialFont.caption)
                    .foregroundStyle(EditorialColor.aiAmber)
            }
            ConsolePillRow(options: options, selected: selected, pick: pick)
            Text(note)
                .font(EditorialFont.captionSmall)
                .foregroundStyle(EditorialColor.textMuted)
        }
    }

    private var sectionBackground: Color {
        EditorialColor.glassSurface
    }

    private var hairline: some View {
        Rectangle()
            .fill(EditorialColor.glassDivider)
            .frame(height: 1)
    }

    private var pitchDescription: String {
        let pitch = Double(service.pitchMultiplier)
        if pitch < 0.95 { return "低沉" }
        if pitch > 1.05 { return "清亮" }
        return "自然"
    }

    /// 档位说明：命中档位时给场景描述；依赖真人音色却还在用系统音色时，把这句实话讲出来
    private var presetNote: String {
        guard let preset = store.activeSpeechPreset else { return "手调过语速或音调后的自定义组合" }
        if preset.prefersRealVoice && store.settings.speech.selectedID == "system" {
            return "当前是系统音色，这一档只能近似；在设置里接上云端真人语音（如 CosyVoice）才更像真人朗读"
        }
        return preset.scene
    }

    private var sleepDescription: String {
        guard let seconds = sleepSeconds, seconds > 0 else { return "未开启" }
        return "剩余 \(clock(seconds: seconds))"
    }

    /// 当前选中的睡眠档位：按剩余秒数就近归档（与 Android 端一致）
    private var selectedSleepMinutes: Int {
        guard let seconds = sleepSeconds else { return 0 }
        let minutes = Int((Double(seconds) / 60).rounded())
        return [15, 30, 60].contains(minutes) ? minutes : 0
    }

    private func clock(ms: Int) -> String {
        clock(seconds: max(0, ms / 1000))
    }

    private func clock(seconds: Int) -> String {
        String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }
}

// MARK: - 控制台子件

/// 圆形图标按键
private struct ConsoleIconButton: View {
    let icon: String
    var size: CGFloat = 40
    let help: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundStyle(EditorialColor.textSecondary)
                .frame(width: size, height: size)
                .background(EditorialColor.glassSurface, in: Circle())
                .overlay(Circle().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
        }
        .buttonStyle(PressableButtonStyle())
        .help(help)
        .accessibilityLabel(help)
    }
}

/// 中央播放 / 暂停大按键
private struct ConsolePlayButton: View {
    let isPlaying: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                .font(.system(size: 19, weight: .bold))
                .foregroundStyle(Color.white)
                .frame(width: 58, height: 58)
                .background(EditorialColor.likeGreen, in: Circle())
                .shadow(color: EditorialColor.likeGreen.opacity(0.35), radius: 10, y: 3)
        }
        .buttonStyle(PressableButtonStyle())
        .help(isPlaying ? "暂停朗读 (⌘P)" : "继续朗读 (⌘P)")
        .accessibilityLabel(isPlaying ? "暂停朗读" : "继续朗读")
    }
}

/// 单选胶囊组
private struct ConsolePillRow: View {
    let options: [(label: String, value: Double)]
    let selected: Double
    let pick: (Double) -> Void

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                let isSelected = abs(option.value - selected) < 0.06
                Button {
                    pick(option.value)
                } label: {
                    Text(option.label)
                        .font(EditorialFont.caption)
                        .fontWeight(isSelected ? .bold : .regular)
                        .foregroundStyle(isSelected ? Color.white : EditorialColor.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(
                            isSelected ? EditorialColor.aiAmber : EditorialColor.glassSurfaceHover,
                            in: RoundedRectangle(cornerRadius: EditorialRadius.pill, style: .continuous)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: EditorialRadius.pill, style: .continuous)
                                .strokeBorder(
                                    isSelected ? EditorialColor.aiAmber : EditorialColor.glassBorder,
                                    lineWidth: 1
                                )
                        )
                }
                .buttonStyle(PressableButtonStyle())
                .accessibilityLabel(option.label)
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
        }
    }
}
