import SwiftUI

// Compatibility shim. The coordinator routes to `SaudaBoardView()` (ContentView, ChambersHomeView);
// the real faithful chamber is `SaudaView`. Kept as an alias so no shared/coordinator file needs an
// edit — the coordinator MAY rewire those two call-sites to `SaudaView()` directly and delete this.
struct SaudaBoardView: View {
    var body: some View { SaudaView() }
}
