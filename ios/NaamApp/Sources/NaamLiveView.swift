import SwiftUI

// Naam — LIVE native marketing glance. Reads Meta CTWA + Google Ads + WABA leads directly from
// source (open-CORS cockpit APIs). No web snapshot, always fresh.
struct NaamLiveView: View {
    @StateObject private var model = NaamLiveModel()
    private let accent = Color(hex: 0xE0762D)

    var body: some View {
        ZStack {
            HK.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                ChamberHeader(title: "Naam", subtitle: model.status, accent: accent)
                Picker("Period", selection: $model.period) {
                    Text("7 days").tag("7d"); Text("30 days").tag("30d"); Text("All").tag("all")
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16).padding(.bottom, 10)
                .onChange(of: model.period) { Task { await model.refresh() } }

                ScrollView {
                    VStack(spacing: 12) {
                        spendHero
                        metaCard
                        googleCard
                        gbpCard
                        leadsCard
                        influencerCard
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

    // hero — total paid spend across Meta + Google
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
        StatCard(title: "Meta Ads", system: "m.circle.fill", accent: Color(hex: 0x4a8df0),
                 status: model.ctwa?.adMetrics?.available == true ? "LIVE" : nil, logo: "logo-meta") {
            if let a = model.ctwa?.adMetrics {
                MetricGrid(metrics: [
                    ("Spend", NaamFmt.rupee(a.spend ?? model.ctwa?.overview?.totalSpend ?? 0)),
                    ("Impressions", NaamFmt.compact(a.impressions)),
                    ("Reach", NaamFmt.compact(a.reach)),
                    ("Link clicks", NaamFmt.compact(a.linkClicks)),
                    ("Landing views", NaamFmt.compact(a.landingPageViews)),
                    ("Conversations", NaamFmt.compact(model.ctwa?.overview?.conversations)),
                ])
            } else {
                Text("Source unreachable").font(.system(size: 13)).foregroundStyle(HK.textFaint)
            }
        }
    }

    private var googleCard: some View {
        StatCard(title: "Google Ads", system: "g.circle.fill", accent: Color(hex: 0x7FB36B),
                 status: model.google?.overview?.status, logo: "logo-google") {
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
            } else {
                Text("Source unreachable").font(.system(size: 13)).foregroundStyle(HK.textFaint)
            }
        }
    }

    // Google Business Profile — organic discovery. No logo asset; SF symbol pin. Counts, not money.
    private var gbpCard: some View {
        StatCard(title: "Google · Organic", system: "mappin.and.ellipse", accent: Color(hex: 0x4285F4),
                 status: model.gbp?.freshness?.performance, logo: nil) {
            if let s = model.gbp?.summary {
                MetricGrid(metrics: [
                    ("Impressions", NaamFmt.compact(s.impressions?.total.map(Double.init))),
                    ("Maps", NaamFmt.compact(s.impressions?.maps.map(Double.init))),
                    ("Search", NaamFmt.compact(s.impressions?.search.map(Double.init))),
                    ("Calls", NaamFmt.compact(s.actions?.calls.map(Double.init))),
                    ("Directions", NaamFmt.compact(s.actions?.directions.map(Double.init))),
                    ("Website", NaamFmt.compact(s.actions?.website.map(Double.init))),
                ])
            } else {
                Text("Source unreachable").font(.system(size: 13)).foregroundStyle(HK.textFaint)
            }
        }
    }

    private var leadsCard: some View {
        StatCard(title: "WhatsApp Leads", system: "person.crop.circle.badge.checkmark", accent: Color(hex: 0x25D366), status: nil, logo: "logo-whatsapp") {
            if model.leads != nil {
                HStack(spacing: 8) {
                    ForEach(model.leadStages, id: \.0) { stage in
                        VStack(spacing: 3) {
                            Text("\(stage.1)").font(.system(size: 20, weight: .heavy, design: .rounded)).foregroundStyle(HK.text)
                            Text(stage.0).font(.system(size: 10, weight: .semibold)).foregroundStyle(HK.textFaint)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(HK.bgElev, in: RoundedRectangle(cornerRadius: 12))
                    }
                }
                if let src = model.leads?.bySource, !src.isEmpty {
                    Text("Sources: " + src.sorted { $0.value > $1.value }.prefix(3).map { "\($0.key) \($0.value)" }.joined(separator: " · "))
                        .font(.system(size: 11.5)).foregroundStyle(HK.textDim).padding(.top, 8)
                }
            } else {
                Text("Source unreachable").font(.system(size: 13)).foregroundStyle(HK.textFaint)
            }
        }
    }

    // Influencer outreach pipeline — enriched creators + contactability. Read-only (no send).
    private var influencerCard: some View {
        StatCard(title: "Influencer", system: "star.circle.fill", accent: Color(hex: 0xC77DBB),
                 status: model.influencer.map { _ in "PIPELINE" }, logo: nil) {
            if let inf = model.influencer, let c = inf.contacts {
                MetricGrid(metrics: [
                    ("Creators", NaamFmt.compact((inf.total).map(Double.init))),
                    ("Business", NaamFmt.compact(c.businessAccts.map(Double.init))),
                    ("Verified", NaamFmt.compact(c.verified.map(Double.init))),
                    ("Contactable", NaamFmt.compact(c.withAnyContact.map(Double.init))),
                    ("Email", NaamFmt.compact(c.withEmail.map(Double.init))),
                    ("WhatsApp", NaamFmt.compact(c.withWhatsapp.map(Double.init))),
                ])
            } else {
                Text("Source unreachable").font(.system(size: 13)).foregroundStyle(HK.textFaint)
            }
        }
    }
}

// Reusable stat card chrome.
struct StatCard<Content: View>: View {
    let title: String
    let system: String
    let accent: Color
    var status: String?
    var logo: String? = nil
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                if let logo {
                    Image(logo).resizable().scaledToFit()
                        .frame(width: 28, height: 28)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                } else {
                    Image(systemName: system).font(.system(size: 18, weight: .semibold)).foregroundStyle(accent)
                }
                Text(title).font(.system(size: 16, weight: .bold)).foregroundStyle(HK.text)
                Spacer()
                if let s = status, !s.isEmpty {
                    Text(s.uppercased()).font(.system(size: 10, weight: .heavy)).foregroundStyle(accent)
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(accent.opacity(0.16), in: Capsule())
                }
            }
            content()
        }
        .padding(15)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HK.card, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(HK.line, lineWidth: 1))
    }
}

struct MetricGrid: View {
    let metrics: [(String, String)]
    private let cols = [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())]
    var body: some View {
        LazyVGrid(columns: cols, spacing: 12) {
            ForEach(metrics, id: \.0) { m in
                VStack(alignment: .leading, spacing: 2) {
                    Text(m.1).font(.system(size: 17, weight: .bold, design: .rounded)).foregroundStyle(HK.text)
                    Text(m.0).font(.system(size: 10.5, weight: .medium)).foregroundStyle(HK.textFaint)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

enum NaamFmt {
    static func rupee(_ v: Double?) -> String {
        let n = v ?? 0
        let f = NumberFormatter(); f.numberStyle = .decimal; f.maximumFractionDigits = 0
        return "₹" + (f.string(from: NSNumber(value: n)) ?? "0")
    }
    static func compact(_ v: Double?) -> String {
        let n = v ?? 0
        if n >= 100_000 { return String(format: "%.1fL", n / 100_000) }
        if n >= 1_000 { return String(format: "%.1fk", n / 1_000) }
        return String(Int(n))
    }
}
