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
            InsightColor.canvas
                .ignoresSafeArea()

            VStack(spacing: 0) {
                headerBar
                Divider().overlay(InsightColor.divider)

                ScrollView {
                    VStack(alignment: .leading, spacing: InsightSpacing.large) {
                        nowPlayingSection
                        progressSection
                        transportSection
                        tuningSection
                    }
                    .padding(InsightSpacing.large)
                }
            }
        }
        .frame(minWidth: 540, idealWidth: 580, minHeight: 520, idealHeight: 600)
    }

    // MARK: - 顶栏

    private var headerBar: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(InsightColor.accentSoft)
                    .frame(width: 36, height: 36)
                Image(systemName: "headphones")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(InsightColor.accent)
            }
            .overlay(Circle().strokeBorder(InsightColor.accent.opacity(0.3), lineWidth: 1))

            Text("语音听书控制台")
                .font(InsightFont.title)
                .foregroundStyle(InsightColor.textPrimary)
            Spacer()
            if let seconds = sleepSeconds {
                // 睡眠定时状态药丸（状态即语义：面板主色 accent）
                InsightPill(text: "睡眠 \(clock(seconds: seconds))", tone: .accent, icon: "moon.zzz.fill")
                    .transition(.opacity)
                    .animation(EditorialSpring.state, value: sleepSeconds == nil)
            }
            GlassIconButton(icon: "xmark", help: "关闭 (Esc)") {
                onClose()
            }
        }
        .padding(.horizontal, InsightSpacing.large)
        .padding(.vertical, InsightSpacing.default)
    }

    // MARK: - 正在朗读

    private var nowPlayingSection: some View {
        VStack(alignment: .leading, spacing: InsightSpacing.default) {
            if let card {
                // 分类徽章沿用 CategoryTheme 语义色（与测验卡 / 收藏缩略图同源）
                let theme = CategoryTheme.theme(for: card, cache: .shared)
                HStack {
                    Text(card.category)
                        .font(InsightFont.callout)
                        .foregroundStyle(theme.accent)
                        .padding(.horizontal, InsightSpacing.compact)
                        .padding(.vertical, 3)
                        .background(theme.accent.opacity(0.12), in: Capsule())
                        .overlay(Capsule().strokeBorder(theme.accent.opacity(0.3), lineWidth: 1))
                    Spacer()
                    HStack(spacing: InsightSpacing.small) {
                        AudioWaveformBars(isPlaying: isSpeaking)
                            .frame(width: 22, height: 16)
                        // 状态在「正在朗读/已暂停/正在合成语音…/已停止」间切换，长度各不相同：
                        // 隐藏 sizer 装最长文案、可见层铺在其宽度上，切换时右侧组不再抖动
                        //（ui-research 共识 29：换文案时容器的宽度要脱离文案）
                        Text("正在合成语音…")
                            .font(InsightFont.caption)
                            .hidden()
                            .overlay(alignment: .leading) {
                                Text(statusText)
                                    .font(InsightFont.caption)
                                    .foregroundStyle(isSpeaking ? InsightColor.success : InsightColor.textMuted)
                            }
                    }
                }

                Text(card.displayHeadline)
                    .font(InsightFont.headline)
                    .foregroundStyle(InsightColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                if !card.displaySummary.isEmpty {
                    Text(card.displaySummary)
                        .font(InsightFont.callout)
                        .foregroundStyle(InsightColor.textMuted)
                        .lineLimit(2)
                }
            } else {
                Text("尚未开始朗读")
                    .font(InsightFont.bodyStrong)
                    .foregroundStyle(InsightColor.textSecondary)
                Text("点下方播放键朗读当前卡片，或回到卡堆按 ⌘P 开始听书。")
                    .font(InsightFont.caption)
                    .foregroundStyle(InsightColor.textMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(InsightSpacing.large)
        .background(InsightColor.surface, in: sectionShape)
        .overlay(sectionShape.strokeBorder(InsightColor.border, lineWidth: 1))
        .shadow(color: Color.black.opacity(0.12), radius: 10, y: 3)
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

        return VStack(spacing: InsightSpacing.small) {
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
                    .font(InsightFont.mono)
                    .monospacedDigit()
                    .foregroundStyle(InsightColor.textSecondary)
                Spacer()
                Text(clock(ms: totalMs))
                    .font(InsightFont.mono)
                    .monospacedDigit()
                    .foregroundStyle(InsightColor.textMuted)
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
        VStack(alignment: .leading, spacing: InsightSpacing.medium) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: InsightSpacing.tiny) {
                    Text("磨耳朵连续听书")
                        .font(InsightFont.bodyStrong)
                        .foregroundStyle(InsightColor.textPrimary)
                    Text("单张播完后自动朗读下一张卡片")
                        .font(InsightFont.caption)
                        .foregroundStyle(InsightColor.textMuted)
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
        .padding(InsightSpacing.large)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(InsightColor.surface, in: sectionShape)
        .overlay(sectionShape.strokeBorder(InsightColor.border, lineWidth: 1))
        .shadow(color: Color.black.opacity(0.12), radius: 10, y: 3)
    }

    private func tuningRow(
        title: String,
        detail: String,
        note: String,
        options: [(label: String, value: Double)],
        selected: Double,
        pick: @escaping (Double) -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: InsightSpacing.compact) {
            HStack {
                Text(title)
                    .font(InsightFont.bodyStrong)
                    .foregroundStyle(InsightColor.textPrimary)
                Spacer()
                Text(detail)
                    .font(InsightFont.caption)
                    .monospacedDigit()
                    .foregroundStyle(InsightColor.accent)
            }
            ConsolePillRow(options: options, selected: selected, pick: pick)
            Text(note)
                .font(InsightFont.captionSmall)
                .foregroundStyle(InsightColor.textMuted)
        }
    }

    /// Cutline 卡片签名：surface 底 + card 圆角 + 1pt 描边
    private var sectionShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: InsightRadius.card, style: .continuous)
    }

    private var hairline: some View {
        Rectangle()
            .fill(InsightColor.divider)
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

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundStyle(hovering ? InsightColor.textPrimary : InsightColor.textSecondary)
                .frame(width: size, height: size)
                .background(hovering ? InsightColor.surfaceRaised : InsightColor.surface, in: Circle())
                .overlay(Circle().strokeBorder(hovering ? InsightColor.borderStrong : InsightColor.border, lineWidth: 1))
                .animation(InsightMotion.tactile, value: hovering)
        }
        .buttonStyle(PressableButtonStyle(scale: 0.92, playAudio: false))
        .onHover { hovering = $0 }
        .help(help)
        .accessibilityLabel(help)
    }
}

/// 中央播放 / 暂停大按键（主操作：accent 白字实底 + 呼吸光晕）
private struct ConsolePlayButton: View {
    let isPlaying: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(Color.white)
                .frame(width: 56, height: 56)
                .background(InsightColor.accent, in: Circle())
                .overlay(Circle().strokeBorder(InsightColor.borderStrong, lineWidth: 1))
                .shadow(color: Color.black.opacity(0.18), radius: 10, y: 4)
                .animation(InsightMotion.tactile, value: isPlaying)
        }
        .buttonStyle(PressableButtonStyle(scale: 0.94))
        .help(isPlaying ? "暂停朗读 (⌘P)" : "继续朗读 (⌘P)")
        .accessibilityLabel(isPlaying ? "暂停朗读" : "继续朗读")
    }
}

/// 单选胶囊组（参照 InsightSegmented 形态：surfaceSunken 槽 + 选中项 surfaceRaised 实底 + border 描边）
private struct ConsolePillRow: View {
    let options: [(label: String, value: Double)]
    let selected: Double
    let pick: (Double) -> Void

    @State private var hovered: Double? = nil

    var body: some View {
        HStack(spacing: InsightSpacing.hair) {
            ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                let isSelected = abs(option.value - selected) < 0.06
                let isHovered = abs(option.value - (hovered ?? -99)) < 0.06
                Button {
                    pick(option.value)
                } label: {
                    Text(option.label)
                        .font(InsightFont.bodyStrong)
                        .foregroundStyle(isSelected ? InsightColor.textPrimary : (isHovered ? InsightColor.textSecondary : InsightColor.textTertiary))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, InsightSpacing.small)
                        .background {
                            ZStack {
                                if isSelected {
                                    Capsule()
                                        .fill(InsightColor.surfaceRaised)
                                        .overlay(Capsule().strokeBorder(InsightColor.border, lineWidth: 1))
                                } else if isHovered {
                                    Capsule().fill(InsightColor.neutralSoft.opacity(0.6))
                                }
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(PressableButtonStyle(playAudio: false))
                .onHover { hovering in
                    hovered = hovering ? option.value : nil
                }
                .accessibilityLabel(option.label)
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
        }
        .padding(3)
        .background(InsightColor.surfaceSunken, in: Capsule())
        .overlay(Capsule().strokeBorder(InsightColor.border, lineWidth: 1))
        // 选中胶囊的吸边与悬停底色都有过渡
        .animation(InsightMotion.tactile, value: selected)
        .animation(InsightMotion.tactile, value: hovered)
    }
}
