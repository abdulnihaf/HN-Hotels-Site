import SwiftUI

// Post-unlock root — the full native Darbar (4 tabs + execution). The gate (ContentView) shows this
// once the PIN is verified; the model mints the token from the vaulted PIN.
struct HomeView: View {
    @ObservedObject var session: DarbarSession
    var body: some View { DarbarView() }
}
