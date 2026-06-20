import SwiftUI

// The Hisaab chamber was rebuilt to the DIWAN-IOS-CONTRACT §10 as `HisaabView`
// (Core/Hisaab{Client,Models,AppModel}.swift + Views/HisaabView.swift).
// This thin type is kept ONLY so the shared route (ContentView `case "hisab"`) and any
// Diwan-home tile that references `HisabTodayView` keep compiling and now render the new
// module. Coordinator: repoint the route/tile to `HisaabView` directly, then the old thin
// Hisab* files (HisabClient/HisabModels/HisabAppModel/HisabGateView) can be deleted.
struct HisabTodayView: View {
    var body: some View { HisaabView() }
}
