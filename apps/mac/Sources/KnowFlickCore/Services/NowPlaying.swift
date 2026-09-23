import Foundation
import MediaPlayer

/// 控制中心 / 媒体键要显示的元数据快照。
///
/// 做成纯数据是为了能单测断言：系统 API（`MPNowPlayingInfoCenter`）在测试进程里既不好断言、
/// 也不该被真的改动——本机 Core 测试跑在非 App 环境，注册命令中心会有副作用。
public struct NowPlayingSnapshot: Equatable, Sendable {
    public var title: String
    /// 用学科/分类充当"艺术家"：锁屏与控制中心一眼能看出在听哪一类
    public var artist: String
    public var album: String
    public var elapsedSeconds: Double
    public var durationSeconds: Double
    /// 播放倍率。系统靠它自行推算进度条推进，所以**不需要每 100 ms 回写一次**
    public var playbackRate: Double
    public var isPlaying: Bool

    public init(
        title: String, artist: String, album: String,
        elapsedSeconds: Double, durationSeconds: Double,
        playbackRate: Double, isPlaying: Bool
    ) {
        self.title = title
        self.artist = artist
        self.album = album
        self.elapsedSeconds = elapsedSeconds
        self.durationSeconds = durationSeconds
        self.playbackRate = playbackRate
        self.isPlaying = isPlaying
    }
}

/// 播放器状态 → 元数据。纯函数。
public enum NowPlayingMapper {
    public static func snapshot(
        card: KnowledgeCard?,
        state: SpeechPlaybackState,
        positionMs: Int,
        durationMs: Int,
        rate: Double
    ) -> NowPlayingSnapshot? {
        guard let card, state != .idle else { return nil }
        let duration = Double(max(0, durationMs)) / 1000
        // 时长未知（云端逐句合成时 durationMs 可能为 0）时把进度也归零：
        // 控制中心的进度条会按 rate 自行推进，喂一个没有分母的分子只会画出错的条
        let elapsed = duration > 0 ? min(Double(max(0, positionMs)) / 1000, duration) : 0
        return NowPlayingSnapshot(
            title: card.headline,
            artist: card.category,
            album: card.subject == nil ? "KnowFlick 知识卡" : "KnowFlick · \(card.subject!)",
            elapsedSeconds: elapsed.isFinite ? elapsed : 0,
            durationSeconds: duration,
            playbackRate: rate.isFinite && rate > 0 ? rate : 1,
            isPlaying: state.isPlaying
        )
    }
}

/// 媒体键 / 触控栏 / 控制中心的播控指令出口。
///
/// 由视图层注入，因为"下一张"要带动画并记划卡，那是卡堆的职责不是播放器的职责
/// （与 Android `SpeechController.onAdvanceRequest` 同一分工）。
@MainActor
public struct NowPlayingCommands {
    public var play: () -> Void
    public var pause: () -> Void
    public var togglePlayPause: () -> Void
    public var next: () -> Void
    public var previous: () -> Void
    /// 快退/快进给定秒数
    public var skip: (_ seconds: Int) -> Void

    public init(
        play: @escaping () -> Void,
        pause: @escaping () -> Void,
        togglePlayPause: @escaping () -> Void,
        next: @escaping () -> Void,
        previous: @escaping () -> Void,
        skip: @escaping (_ seconds: Int) -> Void
    ) {
        self.play = play
        self.pause = pause
        self.togglePlayPause = togglePlayPause
        self.next = next
        self.previous = previous
        self.skip = skip
    }
}

/// 把快照写进系统控制中心，并把媒体键/触控栏指令接回播放器。
///
/// **默认不接系统**（`suppressesSystemIntegration = true`）：Core 单测跑在非 App 进程里，
/// 真去注册命令中心会抢走当前会话的媒体键路由，写 nowPlayingInfo 也会污染 Dock 上的正在播放状态。
/// 由 App 启动时显式调用 `SpeechSynthesizerService.enableNowPlaying()` 打开。
/// 关掉时 `lastSnapshot` 照常记录，所以"该显示什么"这部分逻辑仍然全部可测。
@MainActor
public final class NowPlayingController {
    public var suppressesSystemIntegration = true

    /// 最近一次发布的快照。测试与"当前是否已占用媒体键"的判据都读它。
    public private(set) var lastSnapshot: NowPlayingSnapshot?

    private var commandsInstalled = false

    public init() {}

    /// nil 表示清空（停止朗读后必须清，否则控制中心会挂着上一张卡的进度条继续走）。
    public func publish(_ snapshot: NowPlayingSnapshot?) {
        lastSnapshot = snapshot
        guard !suppressesSystemIntegration else { return }
        let center = MPNowPlayingInfoCenter.default()
        guard let snapshot else {
            center.nowPlayingInfo = nil
            center.playbackState = .stopped
            return
        }
        center.nowPlayingInfo = [
            MPMediaItemPropertyTitle: snapshot.title,
            MPMediaItemPropertyArtist: snapshot.artist,
            MPMediaItemPropertyAlbumTitle: snapshot.album,
            MPMediaItemPropertyPlaybackDuration: snapshot.durationSeconds,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: snapshot.elapsedSeconds,
            // 暂停时倍率写 0：这是系统判断"是否在推进进度条"的唯一依据
            MPNowPlayingInfoPropertyPlaybackRate: snapshot.isPlaying ? snapshot.playbackRate : 0,
        ]
        center.playbackState = snapshot.isPlaying ? .playing : .paused
    }

    /// 注册媒体键。重复调用只生效一次（命令中心是进程级单例，重复 addTarget 会让一次按键触发多次）。
    public func installCommands(_ commands: @escaping @MainActor @Sendable () -> NowPlayingCommands) {
        guard !commandsInstalled, !suppressesSystemIntegration else { return }
        commandsInstalled = true
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.isEnabled = true
        center.playCommand.addTarget { _ in
            Task { @MainActor in commands().play() }
            return .success
        }
        center.pauseCommand.isEnabled = true
        center.pauseCommand.addTarget { _ in
            Task { @MainActor in commands().pause() }
            return .success
        }
        center.togglePlayPauseCommand.isEnabled = true
        center.togglePlayPauseCommand.addTarget { _ in
            Task { @MainActor in commands().togglePlayPause() }
            return .success
        }
        center.nextTrackCommand.isEnabled = true
        center.nextTrackCommand.addTarget { _ in
            Task { @MainActor in commands().next() }
            return .success
        }
        center.previousTrackCommand.isEnabled = true
        center.previousTrackCommand.addTarget { _ in
            Task { @MainActor in commands().previous() }
            return .success
        }
        // 听书按句定位，±10 秒比系统默认的 30 秒更贴合"刚才那句再说一遍"
        center.skipForwardCommand.isEnabled = true
        center.skipForwardCommand.preferredIntervals = [10]
        center.skipForwardCommand.addTarget { _ in
            Task { @MainActor in commands().skip(10) }
            return .success
        }
        center.skipBackwardCommand.isEnabled = true
        center.skipBackwardCommand.preferredIntervals = [10]
        center.skipBackwardCommand.addTarget { _ in
            Task { @MainActor in commands().skip(-10) }
            return .success
        }
    }

    /// 退出时摘掉指令，避免进程存活期间媒体键打到已释放的播放器上。
    public func teardown() {
        guard commandsInstalled else { return }
        commandsInstalled = false
        let center = MPRemoteCommandCenter.shared()
        for command in [
            center.playCommand, center.pauseCommand, center.togglePlayPauseCommand,
            center.nextTrackCommand, center.previousTrackCommand,
            center.skipForwardCommand, center.skipBackwardCommand,
        ] {
            command.removeTarget(nil)
            command.isEnabled = false
        }
        publish(nil)
    }
}
