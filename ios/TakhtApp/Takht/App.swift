import SwiftUI

@main
struct TakhtApp: App {
    @StateObject private var model = TakhtAppModel()

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
                .preferredColorScheme(.dark)
                .task { if model.unlocked { await model.bootstrap() } }
        }
    }
}
