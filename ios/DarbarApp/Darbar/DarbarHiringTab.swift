import SwiftUI

// Darbar — Hiring tab, now a 1-2-3 landing for the three hiring channels:
// 1. Manpower Suppliers (call list), 2. WhatsApp Campaigns, 3. Facebook Posting.
// Tap a card to open the matching sub-flow sheet. Additive 5th tab.

struct DarbarHiringTab: View {
    @ObservedObject var model: DarbarAppModel
    @Binding var sheet: DarbarSheet?
    private let accent = DarbarView.accent

    var body: some View {
        DarbarScreen(title: "Hiring", subtitle: subtitle) {
            ScrollView {
                VStack(spacing: 12) {
                    channelCard(
                        icon: "person.2.fill",
                        title: "Manpower Suppliers",
                        subtitle: suppliersSubtitle,
                        badge: nil,
                        action: { sheet = .hiringSuppliers }
                    )
                    channelCard(
                        icon: "message.badge.filled.fill",
                        title: "WhatsApp Campaigns",
                        subtitle: "Compose & send hiring messages to your candidate DB",
                        badge: "NEW",
                        action: { sheet = .hiringCampaign }
                    )
                    channelCard(
                        icon: "square.and.arrow.up.on.square.fill",
                        title: "Facebook Posting",
                        subtitle: "Post creatives to hiring groups from the page account",
                        badge: "NEW",
                        action: { sheet = .hiringFacebook }
                    )
                }
                .padding(.horizontal, 16).padding(.bottom, 24)
            }
            .scrollIndicators(.hidden)
        }
        .task { if !model.suppliersLoaded { await model.loadSuppliers() } }
    }

    private var subtitle: String {
        if !model.suppliersLoaded { return "Loading suppliers…" }
        let n = model.supplierUncalled
        return n > 0 ? "\(n) supplier\(n == 1 ? "" : "s") still to call" : "All suppliers contacted"
    }

    private var suppliersSubtitle: String {
        if !model.suppliersLoaded { return "Loading suppliers…" }
        let n = model.supplierUncalled
        return n > 0 ? "\(n) suppliers to call" : "All suppliers contacted"
    }

    private func channelCard(icon: String, title: String, subtitle: String, badge: String?, action: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 22)).foregroundStyle(.white)
                    .frame(width: 42, height: 42)
                    .background(accent, in: RoundedRectangle(cornerRadius: HK.radiusSm))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 16, weight: .bold)).foregroundStyle(HK.text)
                    Text(subtitle)
                        .font(.system(size: 12)).foregroundStyle(HK.textDim).lineLimit(1)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 14, weight: .bold)).foregroundStyle(HK.textDim)
            }
            if let badge {
                HStack(spacing: 6) {
                    Text(badge.uppercased()).font(.system(size: 8, weight: .heavy)).tracking(0.5)
                        .foregroundStyle(.black).padding(.horizontal, 6).padding(.vertical, 2)
                        .background(HK.ready, in: Capsule())
                    Text("Tap to open")
                        .font(.system(size: 10, weight: .semibold)).foregroundStyle(HK.textFaint)
                }
            }
        }
        .padding(13)
        .background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.line, lineWidth: 1))
        .onTapGesture(perform: action)
    }
}
