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

    private var syncAddressString: String {
        guard isServerRunning, localIP != "正在检测…", !pairingCode.isEmpty else { return "" }
        return "\(localIP):\(serverPort)#\(pairingCode)"
    }

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

                Picker("", selection: $selectedTab) {
                    Text("当前设备作为接收端").tag(0)
                    Text("连接其他设备").tag(1)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 24)
                .padding(.top, 16)
                .padding(.bottom, 8)

                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        if selectedTab == 0 {
                            serverSection
                        } else {
                            clientSection
                        }
                    }
                    .padding(22)
                }

                Divider().overlay(EditorialColor.glassDivider)
                bottomBar
            }

            VStack {
                Spacer()
                EditorialToast(center: toast)
                    .padding(.bottom, 64)
            }
            .animation(.spring(response: 0.35, dampingFraction: 0.8), value: toast.message)
        }
        .frame(minWidth: 580, idealWidth: 620, minHeight: 480, idealHeight: 560)
        .onAppear {
            initializeServerDefaults()
        }
        .onDisappear {
            stopServer()
        }
    }

    // MARK: - 顶栏

    private var headerBar: some View {
        HStack {
            HStack(spacing: 10) {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(EditorialColor.aiAmber)
                Text("局域网极速双向同步")
                    .font(EditorialFont.modalTitle)
                    .foregroundStyle(EditorialColor.textPrimary)
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
                    .font(EditorialFont.label)
                    .foregroundStyle(EditorialColor.textSecondary)
                Text("启动服务后，在手机端输入下方配对地址，即可一键双向合并卡库与复习进度。")
                    .font(EditorialFont.caption)
                    .foregroundStyle(EditorialColor.textMuted)
            }

            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("同步服务状态")
                            .font(EditorialFont.label)
                            .foregroundStyle(EditorialColor.textPrimary)
                        Text(isServerRunning ? "正在局域网监听端口 \(serverPort)" : "服务已停止")
                            .font(EditorialFont.caption)
                            .foregroundStyle(isServerRunning ? EditorialColor.likeGreen : EditorialColor.textMuted)
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
                    Divider().overlay(EditorialColor.glassDivider)

                    VStack(alignment: .leading, spacing: 10) {
                        Text("配对同步地址")
                            .font(EditorialFont.labelSmall)
                            .foregroundStyle(EditorialColor.textSecondary)

                        HStack {
                            Text(syncAddressString.isEmpty ? "正在获取 IP 地址…" : syncAddressString)
                                .font(.system(size: 14, weight: .semibold, design: .monospaced))
                                .foregroundStyle(EditorialColor.textPrimary)
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
                                .font(EditorialFont.caption)
                                .foregroundStyle(EditorialColor.aiAmber)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(EditorialColor.aiAmberBg, in: RoundedRectangle(cornerRadius: 6))
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(12)
                        .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: EditorialRadius.control))
                        .overlay(RoundedRectangle(cornerRadius: EditorialRadius.control).strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                    }

                    HStack(spacing: 24) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("本机卡片总数")
                                .font(EditorialFont.captionSmall)
                                .foregroundStyle(EditorialColor.textMuted)
                            Text("\(store.cards.count) 张")
                                .font(EditorialFont.label)
                                .foregroundStyle(EditorialColor.textPrimary)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text("6 位动态配对码")
                                .font(EditorialFont.captionSmall)
                                .foregroundStyle(EditorialColor.textMuted)
                            Text(pairingCode)
                                .font(.system(size: 14, weight: .bold, design: .monospaced))
                                .foregroundStyle(EditorialColor.aiAmber)
                        }
                    }
                }
            }
            .padding(16)
            .editorialGlassCard()
        }
    }

    // MARK: - 客户端视图

    private var clientSection: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                Text("主动连接对端设备")
                    .font(EditorialFont.label)
                    .foregroundStyle(EditorialColor.textSecondary)
                Text("输入手机端或另一台 Mac 上显示的局域网同步地址（包含 6 位配对码）。")
                    .font(EditorialFont.caption)
                    .foregroundStyle(EditorialColor.textMuted)
            }

            VStack(alignment: .leading, spacing: 14) {
                Text("目标设备地址")
                    .font(EditorialFont.labelSmall)
                    .foregroundStyle(EditorialColor.textSecondary)

                HStack {
                    TextField("例如: 192.168.1.5:8998#829143", text: $targetInput)
                        .textFieldStyle(.plain)
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundStyle(EditorialColor.textPrimary)

                    if !targetInput.isEmpty {
                        Button {
                            targetInput = ""
                            remoteInfo = nil
                            errorMessage = nil
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 13))
                                .foregroundStyle(EditorialColor.textMuted)
                        }
                        .buttonStyle(.plain)
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
                        .font(EditorialFont.caption)
                        .foregroundStyle(EditorialColor.aiAmber)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(EditorialColor.aiAmberBg, in: RoundedRectangle(cornerRadius: 6))
                    }
                    .buttonStyle(.plain)
                    .disabled(targetInput.isEmpty || isChecking)
                }
                .padding(10)
                .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: EditorialRadius.control))
                .overlay(RoundedRectangle(cornerRadius: EditorialRadius.control).strokeBorder(EditorialColor.glassBorder, lineWidth: 1))

                if let err = errorMessage {
                    HStack(spacing: 6) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(EditorialColor.dislikeRed)
                        Text(err)
                            .font(EditorialFont.caption)
                            .foregroundStyle(EditorialColor.dislikeRed)
                    }
                }

                if let info = remoteInfo {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(EditorialColor.likeGreen)
                            Text("已发现设备：\(info.deviceName)")
                                .font(EditorialFont.label)
                                .foregroundStyle(EditorialColor.textPrimary)
                            Spacer()
                            Text("\(info.cardCount) 张卡片 · \(info.favoriteCount) 收藏")
                                .font(EditorialFont.caption)
                                .foregroundStyle(EditorialColor.textMuted)
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
                            .background(EditorialColor.aiAmber, in: RoundedRectangle(cornerRadius: EditorialRadius.control))
                            .foregroundStyle(Color.black)
                            .font(EditorialFont.label)
                        }
                        .buttonStyle(PressableButtonStyle())
                        .disabled(isSyncing)
                    }
                    .padding(14)
                    .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: EditorialRadius.control))
                    .overlay(RoundedRectangle(cornerRadius: EditorialRadius.control).strokeBorder(EditorialColor.likeGreen.opacity(0.4), lineWidth: 1))
                }

                if let res = syncResult {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 6) {
                            Image(systemName: "checkmark.seal.fill")
                                .foregroundStyle(EditorialColor.likeGreen)
                            Text("同步完成！")
                                .font(EditorialFont.label)
                                .foregroundStyle(EditorialColor.likeGreen)
                        }
                        Text("推送本机 \(res.pushedCount) 张卡片，拉取对端 \(res.pulledCount) 张，新增 \(res.addedCount) 张，恢复 \(res.restoredCount) 张。")
                            .font(EditorialFont.caption)
                            .foregroundStyle(EditorialColor.textSecondary)
                    }
                    .padding(12)
                    .background(EditorialColor.likeGreen.opacity(0.12), in: RoundedRectangle(cornerRadius: EditorialRadius.control))
                }
            }
            .padding(16)
            .editorialGlassCard()
        }
    }

    // MARK: - 底栏

    private var bottomBar: some View {
        HStack {
            Text("KnowFlick 局域网协议 · 严格本地加密验证 · 0 外部依赖")
                .font(EditorialFont.captionSmall)
                .foregroundStyle(EditorialColor.textMuted)
            Spacer()
            Button("关闭") {
                onClose()
            }
            .font(EditorialFont.label)
            .foregroundStyle(EditorialColor.textSecondary)
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 12)
    }

    // MARK: - 逻辑方法

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
            onReceiveCards: { [store] incoming in
                await MainActor.run {
                    let result = store.importCards(incoming, insertAtTop: false)
                    return (added: result.parsedCards.count, restored: 0, ignored: result.duplicateCount)
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

        Task {
            do {
                let info = try await SyncClient.fetchRemoteInfo(target: targetInput)
                await MainActor.run {
                    self.remoteInfo = info
                    self.isChecking = false
                    AudioEffectManager.shared.playCardFlip()
                }
            } catch {
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

        Task {
            do {
                let localCards = await MainActor.run { store.cards }
                let result = try await SyncClient.executeBidirectionalSync(
                    target: targetInput,
                    localCards: localCards
                ) { incoming in
                    await MainActor.run {
                        let res = store.importCards(incoming, insertAtTop: false)
                        return (added: res.parsedCards.count, restored: 0, ignored: res.duplicateCount)
                    }
                }
                await MainActor.run {
                    self.syncResult = result
                    self.isSyncing = false
                    AudioEffectManager.shared.playMasteryChime()
                    toast.show("双向同步成功！")
                }
            } catch {
                await MainActor.run {
                    self.errorMessage = "同步失败: \(error.localizedDescription)"
                    self.isSyncing = false
                }
            }
        }
    }
}
