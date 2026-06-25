import SwiftUI

@main
struct TakhtApp: App {
    @StateObject private var store = TakhtStore()

    var body: some Scene {
        WindowGroup {
            TakhtHomeView()
                .environmentObject(store)
                .task {
                    await store.refresh()
                }
        }
    }
}

