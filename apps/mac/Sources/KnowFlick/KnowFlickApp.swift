import SwiftUI
import KnowFlickCore

@main
struct KnowFlickApp: App {
    @State private var store = AppStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            CardDeckView(store: store)
                .frame(minWidth: 760, minHeight: 560)
                .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification)) { _ in
                    store.shutdown()
                }
                .onChange(of: scenePhase) { _, phase in
                    // 切后台不再主线程同步写盘（会随卡库增长造成 Cmd-Tab 掉帧）；
                    // 立即写入交给后台队列，真正退出由 willTerminate 的 shutdown 同步收口
                    if phase != .active { store.persistImmediately() }
                }
                .preferredColorScheme(store.settings.appearance.colorScheme)
                .task {
                    await store.bootstrap()
                }
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentMinSize)
        .defaultSize(width: 1120, height: 780)
        .commands { MacCommands() }
    }
}
