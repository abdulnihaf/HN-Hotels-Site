import SwiftUI

// Naam — the marketing-pulse chamber. ONE screen: how every acquisition channel is performing,
// read LIVE from five open-CORS cockpit APIs (never the naam-data.json snapshot). §10-consistent:
// Naam accent only (platform identity = the real logo, not a coloured icon), shared kit components
// (ChamberHeader / StatCard / MetricGrid / NaamFmt), capsule period tabs, mandatory brand chips,
// honest empty/stale/unreachable states. READ-ONLY — no pause/spend/send.
struct NaamView: View {
    @StateObject private var model = NaamAppModel()
    private let accent = Color(hex: 0xE0762D)   // Naam orange — the ONLY per-chamber variable

    var body: some View {
        ZStack {
            HK.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                ChamberHeader(title: "Naam", subtitle: model.statusLine, accent: accent)
                periodTabs
                ScrollView {
                    VStack(spacing: 12) {
                        spendHero
                        metaCard
                        googleCard
                        gbpCard
                        leadsCard
                        influencerCard
                        aggregatorCard("swiggy")
                        aggregatorCard("zomato")
                    }
                    .padding(.horizontal, 16).padding(.bottom, 18)
                }
                .scrollIndicators(.hidden)
                .refreshable { await model.refresh() }
            }
        }
        .task { await model.bootstrap() }
        .navigationTitle("Naam").navigationBarTitleDisplayMode(.inline)
    }

    // §10 horizontal capsule tab bar — active = accent fill + black text, inactive = HK.card + textDim.
    private var periodTabs: some View {
        HStack(spacing: 8) {
            ForEach([("7d", "7 days"), ("30d", "30 days"), ("all", "All")], id: \.0) { p in
                let on = model.period == p.0
                Button {
                    if !on { model.period = p.0; Task { await model.refresh() } }
                } label: {
                    Text(p.1)
                        .font(.system(size: 12.5, weight: .heavy))
                        .foregroundStyle(on ? .black : HK.textDim)
                        .frame(maxWidth: .infinity).frame(minHeight: 36)
                        .background(on ? accent : HK.card, in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16).padding(.bottom, 10)
    }

    // mandatory brand chip (§10) — small accent capsule.
    private func brandChip(_ b: NaamBrand) -> some View {
        Text(b.label)
            .font(.system(size: 9.5, weight: .heavy))
            .foregroundStyle(accent)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(accent.opacity(0.16), in: Capsule())
    }
    private func unreachable() -> some View {
        Text("Source unreachable").font(.system(size: 13)).foregroundStyle(HK.textFaint)
    }

    // Hero — glance-first: total paid spend across Meta + Google (already rupees).
    private var spendHero: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("PAID SPEND · \(model.periodLabel.uppercased())")
                .font(.system(size: 11, weight: .heavy)).foregroundStyle(HK.textFaint).tracking(0.5)
            Text(NaamFmt.rupee(model.totalSpend))
                .font(.system(size: 34, weight: .heavy, design: .rounded)).foregroundStyle(HK.text)
            Text("Meta + Google · read live from source")
                .font(.system(size: 12)).foregroundStyle(HK.textDim)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(LinearGradient(colors: [accent.opacity(0.18), HK.card], startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(accent.opacity(0.35), lineWidth: 1))
    }

    private var metaCard: some View {
        StatCard(title: "Meta Ads", system: "m.circle.fill", accent: accent,
                 status: model.ctwa?.adMetrics?.available == true ? "LIVE" : nil, logo: "logo-meta") {
            brandChip(.he)
            if let a = model.ctwa?.adMetrics {
                MetricGrid(metrics: [
                    ("Spend", NaamFmt.rupee(a.spend ?? model.ctwa?.overview?.totalSpend ?? 0)),
                    ("Impressions", NaamFmt.compact(a.impressions)),
                    ("Reach", NaamFmt.compact(a.reach)),
                    ("Link clicks", NaamFmt.compact(a.linkClicks)),
                    ("Landing views", NaamFmt.compact(a.landingPageViews)),
                    ("CPC", NaamFmt.rupee(a.cpc)),
                ])
            } else { unreachable() }
        }
    }

    private var googleCard: some View {
        StatCard(title: "Google Ads", system: "g.circle.fill", accent: accent,
                 status: model.google?.overview?.status, logo: "logo-google") {
            brandChip(.he)
            if let o = model.google?.overview {
                if let name = model.google?.campaignName {
                    Text(name).font(.system(size: 12.5, weight: .medium)).foregroundStyle(HK.textDim)
                        .lineLimit(1).padding(.bottom, 2)
                }
                MetricGrid(metrics: [
                    ("Spend", NaamFmt.rupee(o.spend)),
                    ("Impressions", NaamFmt.compact(o.impressions)),
                    ("Clicks", NaamFmt.compact(o.clicks)),
                    ("CTR", String(format: "%.1f%%", o.ctr ?? 0)),
                    ("Avg CPC", NaamFmt.rupee(o.avgCPC)),
                    ("Conversions", NaamFmt.compact(o.conversions)),
                ])
            } else { unreachable() }
        }
    }

    // Google Business Profile — organic discovery. T-2 day lag, labelled honestly. Counts, not money.
    private var gbpCard: some View {
        StatCard(title: "Google · Organic", system: "mappin.and.ellipse", accent: accent,
                 status: model.gbp?.freshness?.performance, logo: nil) {
            brandChip(.he)
            if let s = model.gbp?.summary {
                MetricGrid(metrics: [
                    ("Impressions", NaamFmt.compact(s.impressions?.total.map(Double.init))),
                    ("Maps", NaamFmt.compact(s.impressions?.maps.map(Double.init))),
                    ("Search", NaamFmt.compact(s.impressions?.search.map(Double.init))),
                    ("Calls", NaamFmt.compact(s.actions?.calls.map(Double.init))),
                    ("Directions", NaamFmt.compact(s.actions?.directions.map(Double.init))),
                    ("Website", NaamFmt.compact(s.actions?.website.map(Double.init))),
                ])
            } else { unreachable() }
        }
    }

    private var leadsCard: some View {
        StatCard(title: "WhatsApp Leads", system: "person.crop.circle.badge.checkmark", accent: accent,
                 status: nil, logo: "logo-whatsapp") {
            brandChip(.he)
            if model.leads != nil {
                HStack(spacing: 8) {
                    ForEach(model.leadStages, id: \.0) { stage in
                        VStack(spacing: 3) {
                            Text("\(stage.1)").font(.system(size: 17, weight: .heavy, design: .rounded)).foregroundStyle(HK.text)
                            Text(stage.0).font(.system(size: 10, weight: .semibold)).foregroundStyle(HK.textFaint)
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 10)
                        .background(HK.bgElev, in: RoundedRectangle(cornerRadius: 12))
                    }
                }
                // §6.6 — assignee + (carried) staff_pin slot for a Darbar tap-through.
                if !model.leadAssignees.isEmpty {
                    Text("Owner: " + model.leadAssignees.prefix(3).map { "\($0.name) \($0.count)" }.joined(separator: " · "))
                        .font(.system(size: 11.5)).foregroundStyle(HK.textDim).padding(.top, 8)
                }
                if let src = model.leads?.bySource, !src.isEmpty {
                    Text("Sources: " + src.sorted { $0.value > $1.value }.prefix(3).map { "\($0.key) \($0.value)" }.joined(separator: " · "))
                        .font(.system(size: 11.5)).foregroundStyle(HK.textDim).padding(.top, 2)
                }
            } else { unreachable() }
        }
    }

    private var influencerCard: some View {
        StatCard(title: "Influencer", system: "star.circle.fill", accent: accent,
                 status: model.influencer.map { _ in "PIPELINE" }, logo: "logo-instagram") {
            brandChip(.both)
            if let inf = model.influencer, let c = inf.contacts {
                MetricGrid(metrics: [
                    ("Creators", NaamFmt.compact(inf.total.map(Double.init))),
                    ("Business", NaamFmt.compact(c.businessAccts.map(Double.init))),
                    ("Verified", NaamFmt.compact(c.verified.map(Double.init))),
                    ("Contactable", NaamFmt.compact(c.withAnyContact.map(Double.init))),
                    ("Email", NaamFmt.compact(c.withEmail.map(Double.init))),
                    ("WhatsApp", NaamFmt.compact(c.withWhatsapp.map(Double.init))),
                ])
            } else { unreachable() }
        }
    }

    // Swiggy / Zomato organic pulse — not wired yet. HONEST empty state, never a fabricated number.
    private func aggregatorCard(_ id: String) -> some View {
        let ref = model.channel(id)
        return StatCard(title: ref?.title ?? id.capitalized, system: "bag.circle.fill", accent: accent,
                        status: "NOT WIRED", logo: ref?.logo) {
            brandChip(ref?.brand ?? .both)
            Text("Organic pulse not wired yet. This card stays empty until a read-proxy lands — never a placeholder number.")
                .font(.system(size: 12.5)).foregroundStyle(HK.textFaint).fixedSize(horizontal: false, vertical: true)
        }
    }
}
