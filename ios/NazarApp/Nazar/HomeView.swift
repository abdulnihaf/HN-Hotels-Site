import SwiftUI

struct HomeView: View {
    @ObservedObject var session: NazarSession
    // Optional launch override (NAZAR_TAB=0|1|2) for verification screenshots; defaults to Watch.
    @State private var tab = Int(ProcessInfo.processInfo.environment["NAZAR_TAB"] ?? "0") ?? 0

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack {
                NazarIntelligenceView()
                    .navigationTitle("Nazar")
                    .navigationBarTitleDisplayMode(.large)
                    .toolbar {
                        ToolbarItem(placement: .navigationBarTrailing) {
                            Button { session.lock() } label: {
                                Image(systemName: "lock.fill")
                                    .foregroundColor(HK.textDim)
                            }
                        }
                    }
            }
            .tabItem { Label("Watch", systemImage: "eye.fill") }
            .tag(0)

            NavigationStack {
                NazarCamerasView()
                    .navigationTitle("Cameras")
                    .navigationBarTitleDisplayMode(.inline)
            }
            .tabItem { Label("Cameras", systemImage: "camera.fill") }
            .tag(1)

            NavigationStack {
                NazarFlagsView()
                    .navigationTitle("Flags")
                    .navigationBarTitleDisplayMode(.inline)
            }
            .tabItem { Label("Flags", systemImage: "exclamationmark.triangle.fill") }
            .tag(2)
        }
        .tint(HK.accent)
        .background(HK.bg.ignoresSafeArea())
    }
}
