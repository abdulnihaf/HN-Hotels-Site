import SwiftUI

// The Diwan home — the chamber launcher. A compact identity header up top, then the six chambers
// sized to divide the full height edge-to-edge (no floating grid, no empty top/bottom).
// Live chambers navigate; not-yet-built show "soon". (Scope/PIN gating hides tiles per role once
// Darbar identity is wired.)
struct ChambersHomeView: View {
    var body: some View {
        NavigationStack {
            ZStack {
                HK.bg.ignoresSafeArea()
                VStack(spacing: 12) {
                    DiwanHeader()
                    VStack(spacing: 12) {
                        HStack(spacing: 12) {
                            NavigationLink { AnbarView() } label: {
                                ChamberTile(title: "Anbar", subtitle: "Inventory · receive & count",
                                            icon: "shippingbox.fill", accent: Color(hex: 0x4FAE6A), live: true)
                            }.buttonStyle(.plain)
                            NavigationLink { TakhtSettlementView() } label: {
                                ChamberTile(title: "Takht", subtitle: "Sale settlement",
                                            icon: "chair.lounge.fill", accent: Color(hex: 0xC8964A), live: true)
                            }.buttonStyle(.plain)
                        }
                        .frame(maxHeight: .infinity)
                        HStack(spacing: 12) {
                            NavigationLink { DarbarView() } label: {
                                ChamberTile(title: "Darbar", subtitle: "Staff & attendance",
                                            icon: "person.2.fill", accent: Color(hex: 0x5B86C9), live: true)
                            }.buttonStyle(.plain)
                            NavigationLink { SaudaView() } label: {
                                ChamberTile(title: "Sauda", subtitle: "Purchase & pay",
                                            icon: "cart.fill", accent: Color(hex: 0xC85A8E), live: true)
                            }.buttonStyle(.plain)
                        }
                        .frame(maxHeight: .infinity)
                        HStack(spacing: 12) {
                            NavigationLink { HisaabView() } label: {
                                ChamberTile(title: "Hesab", subtitle: "Daily P&L",
                                            icon: "indianrupeesign.circle.fill", accent: Color(hex: 0x7FA86A), live: true)
                            }.buttonStyle(.plain)
                            NavigationLink { NaamView() } label: {
                                ChamberTile(title: "Naam", subtitle: "Marketing · live",
                                            icon: "megaphone.fill", accent: Color(hex: 0xE0762D), live: true)
                            }.buttonStyle(.plain)
                        }
                        .frame(maxHeight: .infinity)
                        HStack(spacing: 12) {
                            NavigationLink { MoneyView() } label: {
                                ChamberTile(title: "Tijori", subtitle: "Money · bank & cash",
                                            icon: "banknote.fill", accent: Color(hex: 0x4FB0A8), live: true)
                            }.buttonStyle(.plain)
                            NavigationLink { NazarView() } label: {
                                ChamberTile(title: "Nazar", subtitle: "Cameras · live watch",
                                            icon: "eye.fill", accent: Color(hex: 0x6AA9FF), live: true)
                            }.buttonStyle(.plain)
                        }
                        .frame(maxHeight: .infinity)
                    }
                    .frame(maxHeight: .infinity)
                }
                .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 14)
            }
            .toolbar(.hidden, for: .navigationBar)
        }
    }
}

// Compact identity header — anchors the top so the grid doesn't float.
struct DiwanHeader: View {
    var body: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Diwan")
                    .font(.system(size: 32, weight: .heavy, design: .rounded))
                    .foregroundStyle(HK.text)
                Text("Your HN operating brain")
                    .font(.system(size: 13.5, weight: .medium))
                    .foregroundStyle(HK.textDim)
            }
            Spacer()
            ZStack {
                Circle().fill(HK.accent.opacity(0.16)).frame(width: 46, height: 46)
                Image(systemName: "building.columns.fill")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(HK.accent)
            }
        }
        .padding(.top, 8)
    }
}
