import SwiftUI

struct HomeView: View {
    @ObservedObject var session: NazarSession

    var body: some View {
        TabView {
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

            NavigationStack {
                NazarCamerasView()
                    .navigationTitle("Cameras")
                    .navigationBarTitleDisplayMode(.inline)
            }
            .tabItem { Label("Cameras", systemImage: "camera.fill") }

            NavigationStack {
                NazarFlagsView()
                    .navigationTitle("Flags")
                    .navigationBarTitleDisplayMode(.inline)
            }
            .tabItem { Label("Flags", systemImage: "exclamationmark.triangle.fill") }
        }
        .tint(HK.accent)
        .background(HK.bg.ignoresSafeArea())
    }
}
