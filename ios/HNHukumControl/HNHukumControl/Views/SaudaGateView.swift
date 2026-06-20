import SwiftUI

// Sauda has NO per-chamber PIN gate — the Diwan one-unlock seeds the shared token
// (DIWAN-IOS-CONTRACT §4). The old gate is retired; kept as a thin shim so any stale
// reference compiles. It simply shows the chamber.
struct SaudaGateView: View {
    var body: some View { SaudaView() }
}
