import SwiftUI

@main
struct TakhtWatchApp: App {
    @StateObject private var store = TakhtStore()

    var body: some Scene {
        WindowGroup {
            TakhtWatchView()
                .environmentObject(store)
                .task {
                    await store.refresh()
                }
        }
    }
}

