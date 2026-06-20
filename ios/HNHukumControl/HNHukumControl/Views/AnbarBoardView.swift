import SwiftUI

// The Diwan navigation (ContentView / ChambersHomeView) routes "anbar" here. The rich chamber UI is
// AnbarView; this thin wrapper keeps the existing navigation symbol stable — no shared-file edit.
// (Replaces the old thin action=board stub faithfully with the action=live conservation model.)
struct AnbarBoardView: View {
    var body: some View { AnbarView() }
}
