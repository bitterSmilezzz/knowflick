import SwiftUI
import KnowFlickCore

@main
struct KnowFlickApp: App {
    @State private var store = AppStore()

    var body: some Scene {
        WindowGroup {
            CardDeckView(store: store)
                .frame(minWidth: 760, minHeight: 560)
                .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification)) { _ in
                    store.closeChat()
                    store.flushPersistence()
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
