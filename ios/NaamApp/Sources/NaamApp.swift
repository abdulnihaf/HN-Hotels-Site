import SwiftUI

// Naam — standalone marketing-pulse app for the HN court. One live screen reading the five
// open-CORS cockpit APIs (Meta CTWA + Google Ads + WABA leads on hamzaexpress.in; GBP organic +
// influencer on hnhotels.in). READ-ONLY: no pause/spend/send. Peer to Sauda/Darbar/Nazar/Takht.
@main
struct NaamApp: App {
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                NaamView()
            }
            .preferredColorScheme(.dark)
            .tint(Color(hex: 0xE0762D))
        }
    }
}
