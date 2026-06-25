import SwiftUI

// Mezaan — Nihaf's read-only execution board. One glance: what needs him, what is running,
// what finished today, and the health of the Sauda→Anbar→Takht→Nazar→Darbar chain. It mirrors
// the live Hukum bridge; he never updates it. Peer surface to the Hukum app and the chambers.
@main
struct MezaanApp: App {
    var body: some Scene {
        WindowGroup {
            BoardView()
                .preferredColorScheme(.dark)
                .tint(Color(hex: 0xC8642D))
        }
    }
}
