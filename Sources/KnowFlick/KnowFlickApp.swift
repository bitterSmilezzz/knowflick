import SwiftUI

@main
struct KnowFlickApp: App {
    @State private var store = AppStore()

    var body: some Scene {
        WindowGroup {
            CardDeckView(store: store)
                .frame(minWidth: 760, minHeight: 560)
                .task {
                    await store.bootstrap()
                }
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentMinSize)
        .defaultSize(width: 980, height: 720)
    }
}
