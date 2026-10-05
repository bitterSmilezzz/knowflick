import SwiftUI
import AppKit
import KnowFlickCore

/// 局域网轻量极速同步面板 (macOS Sync Sheet)
///
/// 支持双向互传：
/// 1. 作为服务端等待手机连接同步；
/// 2. 作为客户端输入手机配对地址一键双向增量合并。
struct SyncSheetView: View {
    @Bindable var store: AppStore
    var onClose: () -> Void

    @State private var selectedTab: Int = 0 // 0: 作为接收端 (服务端), 1: 连接其他设备 (客户端)
    @State private var toast = ToastCenter()

    // 服务端状态
    @State private var isServerRunning: Bool = false
    @State private var pairingCode: String = ""
    @State private var serverPort: Int = 8998
    @State private var localIP: String = "正在检测…"
    @State private var syncServer: SyncServer? = nil

    // 客户端状态
    @State private var targetInput: String = ""
    @State private var isChecking: Bool = false
    @State private var remoteInfo: RemoteDeviceInfo? = nil
    @State private var isSyncing: Bool = false
    @State private var syncResult: SyncResult? = nil
    @State private var errorMessage: String? = nil

    // 客户端任务的句柄：关面板时必须取消，否则进行中的请求会静默跑完。
    // SyncClient 的协作式取消（checkCancellation + CancellationError 直通）在 Core 层已就绪。
    @State private var checkTask: Task<Void, Never>? = nil
    @State private var syncTask: Task<Void, Never>? = nil

    private var syncAddressString: String {
        guard isServerRunning, localIP != "正在检测…", !pairingCode.isEmpty else { return "" }
        return "\(localIP):\(serverPort)#\(pairingCode)"
    }

    var body: some View {
        ZStack {
            InsightColor.surfaceRaised
                .ignoresSafeArea()

            VStack(spacing: 0) {
                headerBar
                Divider().overlay(InsightColor.divider)

                Picker("", selection: $selectedTab) {
                    Text("当前设备作为接收端").tag(0)
                    Text("连接其他设备").tag(1)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 24)
                .padding(.top, 16)
                .padding(.bottom, 8)

                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if selectedTab == 0 {
                            serverSection
                                .transition(.opacity)
                        } else {
                            clientSection
                                .transition(.opacity)
                        }
                    }
                    .padding(18)
                    .animation(EditorialSpring.state, value: selectedTab)
                }

                Divider().overlay(InsightColor.divider)
                bottomBar
            }

            VStack {
                Spacer()
                InsightToast(center: toast, edge: .bottom)
                    .padding(.bottom, 64)
            }
        }
        .frame(minWidth: 580, idealWidth: 620, minHeight: 480, idealHeight: 560)
        .onAppear {
            initializeServerDefaults()
        }
        .onDisappear {
            checkTask?.cancel()
            syncTask?.cancel()
            stopServer()
        }
    }

    // MARK: - 顶栏

    private var headerBar: some View {
        HStack {
            HStack(spacing: 10) {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(InsightColor.accent)
                Text("局域网极速双向同步")
                    .font(InsightFont.title)
                    .foregroundStyle(InsightColor.textPrimary)
            }
            Spacer()
            GlassIconButton(icon: "xmark", help: "关闭 (Esc)") {
                onClose()
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }

    // MARK: - 服务端视图

    private var serverSection: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                Text("等待同一 Wi-Fi 下的 Android 或其他设备发起同步")
                    .font(InsightFont.bodyStrong)
                    .foregroundStyle(InsightColor.textSecondary)
                Text("启动服务后，在手机端输入下方配对地址，即可一键双向合并卡库与复习进度。")
                    .font(InsightFont.caption)
                    .foregroundStyle(InsightColor.textMuted)
            }

            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("同步服务状态")
                            .font(InsightFont.bodyStrong)
                            .foregroundStyle(InsightColor.textPrimary)
                        Text(isServerRunning ? "正在局域网监听端口 \(serverPort)" : "服务已停止")
                            .font(InsightFont.caption)
                            .foregroundStyle(isServerRunning ? InsightColor.success : InsightColor.textMuted)
                    }
                    Spacer()
                    Toggle("", isOn: Binding(
                        get: { isServerRunning },
                        set: { enable in
                            if enable { startServer() } else { stopServer() }
                        }
                    ))
                    .toggleStyle(.switch)
                }

                if isServerRunning {
                    Divider().overlay(InsightColor.divider)

                    VStack(alignment: .leading, spacing: 10) {
                        Text("配对同步地址")
                            .font(InsightFont.callout)
                            .foregroundStyle(InsightColor.textSecondary)
                        HStack {
                            Text(syncAddressString.isEmpty ? "正在获取 IP 地址…" : syncAddressString)
                                .font(.system(size: 14, weight: .semibold, design: .monospaced))
                                .foregroundStyle(InsightColor.textPrimary)
                                .textSelection(.enabled)
                            Spacer()
                            Button {
                                AudioEffectManager.shared.playClick()
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(syncAddressString, forType: .string)
                                toast.show("已复制同步配对码到剪贴板")
                            } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: "doc.on.doc")
                                    Text("复制")
                                }
                                .font(InsightFont.caption)
                                .foregroundStyle(InsightColor.accent)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(InsightColor.accentSoft, in: RoundedRectangle(cornerRadius: 6))
                            }
                            .buttonStyle(PressableButtonStyle(scale: 0.95, playAudio: false))
                        }
                        .padding(12)
                        .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.control))
                        .overlay(RoundedRectangle(cornerRadius: InsightRadius.control).strokeBorder(InsightColor.border, lineWidth: 1))
                    }

                    HStack(spacing: 24) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("本机卡片总数")
                                .font(InsightFont.captionSmall)
                                .foregroundStyle(InsightColor.textMuted)
                            Text("\(store.cards.count) 张")
                                .font(InsightFont.bodyStrong)
                                .foregroundStyle(InsightColor.textPrimary)
                                .contentTransition(.numericText())
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text("6 位动态配对码")
                                .font(InsightFont.captionSmall)
                                .foregroundStyle(InsightColor.textMuted)
                            Text(pairingCode)
                                .font(.system(size: 14, weight: .bold, design: .monospaced))
                                .foregroundStyle(InsightColor.accent)
                        }
                    }
                    .transition(.opacity)
                }
            }
            .padding(16)
            .editorialGlassCard()
            // 配对信息块随服务开关插入/移除
            .animation(EditorialSpring.state, value: isServerRunning)
        }
    }

    // MARK: - 客户端视图

    private var clientSection: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                Text("主动连接对端设备")
                    .font(InsightFont.bodyStrong)
                    .foregroundStyle(InsightColor.textSecondary)
                Text("输入手机端或另一台 Mac 上显示的局域网同步地址（包含 6 位配对码）。")
                    .font(InsightFont.caption)
                    .foregroundStyle(InsightColor.textMuted)
            }

            VStack(alignment: .leading, spacing: 14) {
                Text("目标设备地址")
                    .font(InsightFont.callout)
                    .foregroundStyle(InsightColor.textSecondary)

                HStack {
                    TextField("例如: 192.168.1.5:8998#829143", text: $targetInput)
                        .textFieldStyle(.plain)
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundStyle(InsightColor.textPrimary)

                    if !targetInput.isEmpty {
                        Button {
                            targetInput = ""
                            remoteInfo = nil
                            errorMessage = nil
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 13))
                                .foregroundStyle(InsightColor.textMuted)
                        }
                        .buttonStyle(PressableButtonStyle(scale: 0.85, playAudio: false))
                    }

                    Button {
                        checkRemoteDevice()
                    } label: {
                        HStack(spacing: 4) {
                            if isChecking {
                                ProgressView()
                                    .scaleEffect(0.6)
                            } else {
                                Image(systemName: "antenna.radiowaves.left.and.right")
                            }
                            Text("检测连接")
                        }
                        .font(InsightFont.caption)
                        .foregroundStyle(InsightColor.accent)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(InsightColor.accentSoft, in: RoundedRectangle(cornerRadius: 6))
                    }
                    .buttonStyle(PressableButtonStyle(scale: 0.95, playAudio: false))
                    .disabled(targetInput.isEmpty || isChecking)
                }
                .padding(10)
                .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.control))
                .overlay(RoundedRectangle(cornerRadius: InsightRadius.control).strokeBorder(InsightColor.border, lineWidth: 1))

                if let err = errorMessage {
                    HStack(spacing: 6) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(InsightColor.danger)
                        Text(err)
                            .font(InsightFont.caption)
                            .foregroundStyle(InsightColor.danger)
                    }
                    .transition(.opacity)
                }

                if let info = remoteInfo {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(InsightColor.success)
                            Text("已发现设备：\(info.deviceName)")
                                .font(InsightFont.bodyStrong)
                                .foregroundStyle(InsightColor.textPrimary)
                            Spacer()
                            Text("\(info.cardCount) 张卡片 · \(info.favoriteCount) 收藏")
                                .font(InsightFont.caption)
                                .foregroundStyle(InsightColor.textMuted)
                        }

                        if let hint = peerVersionHint(info.protocolVersion) {
                            versionHintRow(hint)
                        }

                        Button {
                            executeSync()
                        } label: {
                            HStack {
                                if isSyncing {
                                    ProgressView()
                                        .scaleEffect(0.7)
                                        .padding(.trailing, 4)
                                } else {
                                    Image(systemName: "arrow.triangle.2.circlepath")
                                }
                                Text(isSyncing ? "正在双向同步卡库…" : "立即执行双向增量同步")
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(InsightColor.accent, in: RoundedRectangle(cornerRadius: InsightRadius.control))
                            .foregroundStyle(Color.white)
                            .font(InsightFont.bodyStrong)
                        }
                        .buttonStyle(PressableButtonStyle())
                        .disabled(isSyncing)
                    }
                    .padding(14)
                    .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: InsightRadius.control))
                    .overlay(RoundedRectangle(cornerRadius: InsightRadius.control).strokeBorder(InsightColor.success.opacity(0.4), lineWidth: 1))
                }

                if let res = syncResult {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 6) {
                            Image(systemName: "checkmark.seal.fill")
                                .foregroundStyle(InsightColor.success)
                            Text("双向极速同步完成！")
                                .font(InsightFont.bodyStrong)
                                .foregroundStyle(InsightColor.success)
                        }
                        Text("向对端推送 \(res.pushedCount) 张，从对端拉取 \(res.pulledCount) 张（本机新增 \(res.addedCount) 张，更新学习进度 \(res.restoredCount) 张）。")
                            .font(InsightFont.caption)
                            .foregroundStyle(InsightColor.textSecondary)
                        // 协议 v2 §2/§3：版本握手提示——优先用本次同步载荷的实际版本，
                        // 尚未同步过时回退到 /api/info 的检测结果；不阻断同步，仅提醒两端升级
                        if let hint = peerVersionHint(res.peerProtocolVersion ?? remoteInfo?.protocolVersion) {
                            versionHintRow(hint)
                        }
                    }
                    .padding(12)
                    .background(InsightColor.success.opacity(0.12), in: RoundedRectangle(cornerRadius: InsightRadius.control))
                    .transition(.opacity)
                }
            }
            .padding(16)
            .editorialGlassCard()
            // 状态块（错误 / 对端信息 / 同步结果）插入移除的统一动画上下文
            .animation(EditorialSpring.state, value: errorMessage)
            .animation(EditorialSpring.state, value: remoteInfo?.deviceName)
            .animation(EditorialSpring.state, value: syncResult == nil)
        }
    }

    // MARK: - 底栏

    private var bottomBar: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text("KnowFlick 局域网协议 · 严格本地加密验证 · 0 外部依赖")
                    .font(InsightFont.captionSmall)
                    .foregroundStyle(InsightColor.textMuted)
                // 常驻明示文案（协议 §8）：两个标签页都可见，关面板即停服务
                Text("关闭此面板即停止本机同步服务，对端进行中的同步会中断")
                    .font(InsightFont.captionSmall)
                    .foregroundStyle(InsightColor.textMuted)
            }
            Spacer()
            Button("关闭") {
                onClose()
            }
            .buttonStyle(BorderedProminentButtonStyle())
            .tint(InsightColor.accent)
            .foregroundStyle(Color.white)
        }
        .padding(.top, 4)
    }

    // MARK: - 同步与服务逻辑

    /// 对端版本提示（协议 v2 §2）：缺字段 = v1 旧端；高于本端支持版本 = 对端更新。
    /// 两种情况都**不阻断**同步（字段级兼容，新字段会被旧端静默丢弃）。
    private func peerVersionHint(_ version: Int?) -> String? {
        guard let version else { return "对端版本较旧，建议两端升级" }
        return version > SyncProtocol.currentVersion ? "对端版本更新" : nil
    }

    private func versionHintRow(_ text: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "arrow.up.circle")
                .foregroundStyle(InsightColor.textMuted)
            Text(text)
                .font(InsightFont.caption)
                .foregroundStyle(InsightColor.textMuted)
        }
    }

    private func initializeServerDefaults() {
        if pairingCode.isEmpty {
            pairingCode = String(format: "%06d", Int.random(in: 100000...999999))
        }
        if let ip = SyncServer.getLocalIPAddress() {
            localIP = ip
        } else {
            localIP = "127.0.0.1"
        }
        startServer()
    }

    private func startServer() {
        stopServer()
        let server = SyncServer(
            accessCode: pairingCode,
            getCards: { [store] in
                await MainActor.run { store.cards }
            },
            getTombstones: { [store] in
                await MainActor.run { store.currentTombstones }
            },
            onReceiveCards: { [store] incoming, tombstones in
                await MainActor.run {
                    let result = store.applySyncPayload(cards: incoming, tombstones: tombstones)
                    return (added: result.added, restored: result.updated, ignored: result.ignored, deleted: result.deleted)
                }
            }
        )
        let res = server.start(preferredPort: 8998)
        switch res {
        case .success(let port):
            self.serverPort = port
            self.isServerRunning = true
            self.syncServer = server
            AudioEffectManager.shared.playPaperSlide()
        case .failure(let err):
            self.isServerRunning = false
            self.errorMessage = "启动同步服务失败: \(err.localizedDescription)"
        }
    }

    private func stopServer() {
        syncServer?.stop()
        syncServer = nil
        isServerRunning = false
    }

    private func checkRemoteDevice() {
        errorMessage = nil
        remoteInfo = nil
        syncResult = nil
        isChecking = true
        AudioEffectManager.shared.playClick()

        // 新一次检测顶掉旧检测，避免两个请求并发写同一组状态
        checkTask?.cancel()
        checkTask = Task {
            do {
                let info = try await SyncClient.fetchRemoteInfo(target: targetInput)
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    self.remoteInfo = info
                    self.isChecking = false
                    AudioEffectManager.shared.playCardFlip()
                }
            } catch {
                // 取消不是故障：关面板/重复点击触发的取消不写错误栏
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    self.errorMessage = "检测失败: \(error.localizedDescription)"
                    self.isChecking = false
                }
            }
        }
    }

    private func executeSync() {
        isSyncing = true
        errorMessage = nil
        syncResult = nil
        AudioEffectManager.shared.playPaperSlide()

        syncTask?.cancel()
        syncTask = Task {
            do {
                let result = try await SyncClient.executeBidirectionalSync(
                    target: targetInput,
                    // 推送的是「合并后的最新快照」：合并回调可能新增/更新/删除本地卡（协议 §4）
                    currentCards: { [store] in
                        await MainActor.run { store.cards }
                    },
                    currentTombstones: { [store] in
                        await MainActor.run { store.currentTombstones }
                    }
                ) { incoming, tombstones in
                    await MainActor.run {
                        let res = store.applySyncPayload(cards: incoming, tombstones: tombstones)
                        return (added: res.added, restored: res.updated, ignored: res.ignored, deleted: res.deleted)
                    }
                }
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    // 协议 §8「推送完成后显式 flush」：合并落库已在 applySyncPayload 内立即落盘，
                    // 这里收口整个持久化队列（有界等待 ≤2s，见 PersistenceCoordinator.flushPersistence）
                    store.flushPersistence()
                    self.syncResult = result
                    self.isSyncing = false
                    AudioEffectManager.shared.playMasteryChime()
                    toast.show("双向同步成功！")
                }
            } catch {
                // 取消不是故障：关面板触发的取消不写错误栏（此前会伪装成「同步失败: cancelled」）
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    self.errorMessage = "同步失败: \(error.localizedDescription)"
                    self.isSyncing = false
                }
            }
        }
    }
}
