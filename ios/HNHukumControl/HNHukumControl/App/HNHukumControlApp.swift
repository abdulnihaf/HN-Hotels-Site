import SwiftUI
import BackgroundTasks

@main
struct HNHukumControlApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var settings = HukumSettings.shared
    @StateObject private var model = HukumAppModel()
    @StateObject private var nazar = NazarAppModel()
    @StateObject private var audio = HukumAudioQueue.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(settings)
                .environmentObject(model)
                .environmentObject(nazar)
                .environmentObject(audio)
                .preferredColorScheme(.dark)
                .task {
                    await model.bootstrap()
                    await nazar.bootstrap()
                }
        }
    }
}
