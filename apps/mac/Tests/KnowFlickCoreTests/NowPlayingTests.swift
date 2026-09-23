import Foundation
import Testing

@testable import KnowFlickCore

/// 控制中心 / 媒体键的元数据映射与发布链路。
///
/// 系统 API（`MPNowPlayingInfoCenter` / `MPRemoteCommandCenter`）在测试进程里既无法断言、
/// 也会真的抢走当前会话的媒体键路由，所以这些用例全部走 `suppressesSystemIntegration`
/// 那条路：验证"该显示什么、什么时候清空"，不验证系统本身。
@MainActor
struct NowPlayingTests {

    private func card(
        _ headline: String = "复利的第七十天",
        category: String = "金融",
        subject: String? = "finance"
    ) -> KnowledgeCard {
        var made = KnowledgeCard(
            category: category, headline: headline, summary: "摘要",
            details: "正文", source: .seed
        )
        made.subject = subject
        return made
    }

    // MARK: - 映射（纯函数）

    @Test("空闲或没有卡片时不占控制中心")
    func mapperReturnsNilWhenNothingPlaying() {
        #expect(NowPlayingMapper.snapshot(
            card: nil, state: .playing(cardId: UUID(), text: "t", progress: 0.2),
            positionMs: 1000, durationMs: 5000, rate: 1) == nil)
        #expect(NowPlayingMapper.snapshot(
            card: card(), state: .idle, positionMs: 1000, durationMs: 5000, rate: 1) == nil)
    }

    @Test("标题/学科/专辑取自卡片，播放态与倍率如实反映")
    func mapperReflectsCardAndState() {
        let playing = NowPlayingMapper.snapshot(
            card: card(), state: .playing(cardId: UUID(), text: "t", progress: 0.4),
            positionMs: 4000, durationMs: 10_000, rate: 1.25
        )
        #expect(playing?.title == "复利的第七十天")
        #expect(playing?.artist == "金融")
        #expect(playing?.album == "KnowFlick · finance")
        #expect(playing?.elapsedSeconds == 4)
        #expect(playing?.durationSeconds == 10)
        #expect(playing?.playbackRate == 1.25)
        #expect(playing?.isPlaying == true)

        let paused = NowPlayingMapper.snapshot(
            card: card(), state: .paused(cardId: UUID(), text: "t", progress: 0.4),
            positionMs: 4000, durationMs: 10_000, rate: 1
        )
        #expect(paused?.isPlaying == false)
    }

    @Test("未分级卡片走通用专辑名，异常数值不会污染系统字段")
    func mapperSanitizesBadNumbers() {
        #expect(NowPlayingMapper.snapshot(
            card: card(subject: nil), state: .playing(cardId: UUID(), text: "t", progress: 0),
            positionMs: 0, durationMs: 0, rate: 1)?.album == "KnowFlick 知识卡")

        // 时长未知（云端逐句合成时 durationMs 可能为 0）：elapsed 不能变成 NaN/负数
        let unknown = NowPlayingMapper.snapshot(
            card: card(), state: .playing(cardId: UUID(), text: "t", progress: 0),
            positionMs: 5000, durationMs: 0, rate: .nan
        )
        #expect(unknown?.elapsedSeconds == 0)
        #expect(unknown?.playbackRate == 1)

        let negative = NowPlayingMapper.snapshot(
            card: card(), state: .playing(cardId: UUID(), text: "t", progress: 0),
            positionMs: -100, durationMs: 1000, rate: 0
        )
        #expect(negative?.elapsedSeconds == 0)
        #expect(negative?.playbackRate == 1)
    }

    // MARK: - 控制器

    @Test("抑制系统接入时仍记录快照，清空时一并清掉")
    func controllerTracksSnapshotWithoutTouchingSystem() {
        let controller = NowPlayingController()
        controller.suppressesSystemIntegration = true
        let snapshot = NowPlayingSnapshot(
            title: "t", artist: "a", album: "b",
            elapsedSeconds: 1, durationSeconds: 2, playbackRate: 1, isPlaying: true
        )
        controller.publish(snapshot)
        #expect(controller.lastSnapshot == snapshot)
        controller.publish(nil)
        #expect(controller.lastSnapshot == nil)
    }

    // MARK: - 服务链路（状态变更 → 控制中心）

    private func makeService() -> SpeechSynthesizerService {
        let service = SpeechSynthesizerService()
        service.suppressesRealSynthesis = true   // 同时关掉系统接入，见该属性的 didSet
        return service
    }

    @Test("朗读/暂停/停止会分别把快照置为播放、暂停与清空")
    func servicePublishesOnStateTransitions() throws {
        let service = makeService()
        // 默认不接系统：Core 测试进程绝不能抢媒体键路由
        #expect(service.nowPlaying.suppressesSystemIntegration)
        #expect(service.nowPlaying.lastSnapshot == nil)

        service.speak(card: card())
        let playing = try #require(service.nowPlaying.lastSnapshot)
        #expect(playing.title == "复利的第七十天")
        #expect(playing.isPlaying)
        #expect(playing.durationSeconds > 0)

        service.pause()
        #expect(service.nowPlaying.lastSnapshot?.isPlaying == false)

        service.resume()
        #expect(service.nowPlaying.lastSnapshot?.isPlaying == true)

        service.stop()
        #expect(service.nowPlaying.lastSnapshot == nil)
    }

    @Test("淡出中的倍率会反映到控制中心，而不是写死 1x")
    func fadeRateReachesNowPlaying() throws {
        let service = makeService()
        service.speedMultiplier = 1.0
        service.applyFadePlan(SleepFade.plan(remainingSeconds: 0))   // 最深处 0.9
        service.speak(card: card())
        let snapshot = try #require(service.nowPlaying.lastSnapshot)
        #expect(abs(snapshot.playbackRate - 0.9) < 0.001)
    }

    @Test("系统暂停命令是单向且可重复调用")
    func pauseCommandDoesNotResumePlayback() {
        let service = makeService()
        service.speak(card: card())
        let commands = service.makeNowPlayingCommands()

        commands.pause()
        #expect(service.state.isPaused)
        commands.pause()
        #expect(service.state.isPaused)
    }

    @Test("系统切换命令在播放与暂停之间双向切换")
    func toggleCommandSwitchesBetweenPlayingAndPaused() {
        let service = makeService()
        service.speak(card: card())
        let commands = service.makeNowPlayingCommands()

        commands.togglePlayPause()
        #expect(service.state.isPaused)
        commands.togglePlayPause()
        #expect(service.state.isPlaying)
    }

    @Test("媒体键指令接回播放器：下一张会划走当前卡，上一张把它放回顶位")
    func transportCommandsDriveTheStore() {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let service = makeService()
        let store = AppStore(storage: Storage(baseDir: directory), speechService: service)
        defer {
            store.flushPersistence()
            try? FileManager.default.removeItem(at: directory)
        }

        store.cards = [card("第一张"), card("第二张"), card("第三张")]
        guard let first = store.topCard else { Issue.record("顶卡应为非空"); return }
        service.speak(card: first)

        service.onTransportNext?()
        // 卡堆排布带防重打散，具体下一张是谁不作断言；断言的是契约：旧的被划走、播放跟着顶卡
        #expect(store.cards.contains { $0.headline == first.headline && $0.seenAt != nil })
        #expect(service.currentCard?.headline == store.topCard?.headline)
        #expect(service.nowPlaying.lastSnapshot?.title == store.topCard?.headline)
        let advanced = service.currentCard?.headline

        service.onTransportPrevious?()
        #expect(service.currentCard?.headline == first.headline, "撤销上一张应回到刚被划走的那张")
        #expect(advanced != first.headline)
    }
}
