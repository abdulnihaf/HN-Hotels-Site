import SwiftUI

// Takht — NCH cash + UPI settlement WITNESS (read-only). Ported faithfully from the LIVE PWA
// (nawabichaihouse.com/ops/takht): the single load() builds ONE scrolling screen from 5 parallel
// GETs — the "what was missed — read to staff" flags card FIRST, then the settlement-chain hero,
// UPI Razorpay-vs-POS, the chai token inventory, and the POS session.
//
// Rendered in the shared Hukum design system (HK surfaces + the shared kit); the only chamber
// variable is the accent — warm gold 0xC8964A (§10). RUPEES throughout — every amount is already
// whole rupees from the worker, NEVER ÷100. Doctrine: never-block, honest states only — a feed that
// returns no data shows an honest "Source unreachable", never a fabricated number. No money/settle/
// collect/rectify action is wired here (the counted-cash variance helper is deferred to the
// coordinator, behind the owner's tap).
struct TakhtSettlementView: View {
    @StateObject private var model = TakhtAppModel()
    private let accent = Color(hex: 0xC8964A)

    var body: some View {
        ZStack {
            HK.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                ChamberHeader(title: "Takht", subtitle: model.status, accent: accent)
                ScrollView {
                    VStack(spacing: 12) {
                        brandLine
                        flagsCard
                        chainHero
                        upiCard
                        chaiCard
                        sessionCard
                    }
                    .padding(.horizontal, 16).padding(.bottom, 18)
                }
                .scrollIndicators(.hidden)
                .refreshable { await model.refresh() }
            }
        }
        .task { await model.bootstrap() }
        .navigationTitle("Takht").navigationBarTitleDisplayMode(.inline)
    }

    // Brand indicator — Takht is the NCH settlement seat (§10: brand chip wherever data carries brand).
    private var brandLine: some View {
        HStack(spacing: 8) {
            pill("NCH", accent)
            Text("Nawabi Chai House · cash + UPI settlement")
                .font(.system(size: 11.5)).foregroundStyle(HK.textFaint)
            Spacer()
        }
    }

    // MARK: 1 — "What was missed — read to staff" (glance-first, top of screen)

    private var flagsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionLabel("WHAT WAS MISSED — READ TO STAFF")
            ForEach(model.flags) { f in
                HStack(alignment: .top, spacing: 10) {
                    Circle().fill(flagColor(f.level)).frame(width: 9, height: 9).padding(.top, 5)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(f.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(HK.text)
                        Text(f.cause).font(.system(size: 13)).foregroundStyle(HK.textDim)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(flagColor(f.level).opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .padding(15)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HK.card, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(HK.line, lineWidth: 1))
    }

    // MARK: 2 — settlement chain hero: Runners → Cashier → You + the rupee that should reach the hand

    private var chainHero: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionLabel("SETTLEMENT CHAIN · SINCE LAST SWEEP")
            if model.balance == nil {
                Text("Source unreachable").font(.system(size: 13)).foregroundStyle(HK.textFaint)
            } else {
                HStack(spacing: 2) {
                    chainNode("Runners", TakhtFmt.rupee(model.balance?.runnerCash), isYou: false)
                    chainArrow
                    chainNode("Cashier", TakhtFmt.rupee(model.balance?.counterCash), isYou: false)
                    chainArrow
                    chainNode("You", TakhtFmt.rupee(model.handTotal), isYou: true)
                }
                .padding(.vertical, 2)
                Text(TakhtFmt.rupee(model.handTotal))
                    .font(.system(size: 32, weight: .heavy, design: .rounded)).foregroundStyle(HK.text)
                Text("cash that should reach your hand")
                    .font(.system(size: 13)).foregroundStyle(HK.textDim)
                expensesRow
                Text("Count the physical cash and reconcile before you take it.")
                    .font(.system(size: 12)).foregroundStyle(HK.textFaint).padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(LinearGradient(colors: [accent.opacity(0.16), HK.card],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(accent.opacity(0.32), lineWidth: 1))
    }

    private var expensesRow: some View {
        HStack {
            Text("Cash expenses").font(.system(size: 14)).foregroundStyle(HK.textDim)
            Spacer()
            let exp = model.balance?.totalExpenses ?? 0
            if exp == 0 {
                pill("₹0 · UPI-only ✓", HK.ready)
            } else {
                Text(TakhtFmt.rupee(exp)).font(.system(size: 15, weight: .semibold)).foregroundStyle(HK.text)
                pill("check", HK.running)
            }
        }
        .padding(.top, 4)
    }

    private func chainNode(_ label: String, _ value: String, isYou: Bool) -> some View {
        VStack(spacing: 3) {
            Text(label).font(.system(size: 13, weight: .bold)).foregroundStyle(isYou ? accent : HK.text)
            Text(value).font(.system(size: 11, weight: .medium)).foregroundStyle(HK.textDim)
        }
        .frame(maxWidth: .infinity)
    }
    private var chainArrow: some View {
        Image(systemName: "arrow.right").font(.system(size: 12, weight: .bold)).foregroundStyle(accent)
    }

    // MARK: 3 — UPI · Razorpay vs POS (per-entity rows; runner QRs tagged)

    private var upiCard: some View {
        StatCard(title: "UPI · Razorpay vs POS", system: "indianrupeesign.circle.fill", accent: accent, status: nil) {
            if let snaps = model.upi?.snapshots, !snaps.isEmpty {
                VStack(spacing: 0) {
                    if let p = model.upi?.period, let f = p.from, let t = p.to {
                        Text("window \(f) → \(t)")
                            .font(.system(size: 11)).foregroundStyle(HK.textFaint)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, 4)
                    }
                    ForEach(snaps) { s in upiRow(s) }
                }
            } else if model.upiLoading {
                Text("Loading…").font(.system(size: 13)).foregroundStyle(HK.textFaint)
            } else {
                Text(model.upi == nil ? "Source unreachable" : "No UPI activity this window.")
                    .font(.system(size: 13)).foregroundStyle(HK.textFaint)
            }
        }
    }

    private func upiRow(_ s: TakhtUpiSnapshot) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(s.entity).font(.system(size: 14, weight: .medium)).foregroundStyle(HK.text)
            if s.isRunnerQr == true {
                Text("runner").font(.system(size: 10, weight: .semibold)).foregroundStyle(HK.textFaint)
            }
            Spacer(minLength: 6)
            Text(TakhtFmt.rupee(s.razorpay)).font(.system(size: 13, weight: .semibold)).foregroundStyle(HK.textDim)
            Text("/r").font(.system(size: 10)).foregroundStyle(HK.textFaint)
            Text(TakhtFmt.rupee(s.posUpi)).font(.system(size: 13, weight: .semibold)).foregroundStyle(HK.textDim)
            Text("/p").font(.system(size: 10)).foregroundStyle(HK.textFaint)
            if s.isOff {
                pill((s.gap > 0 ? "+" : "") + TakhtFmt.rupee(s.gap), HK.error)
            } else {
                pill("✓", HK.ready)
            }
        }
        .padding(.vertical, 7)
    }

    // MARK: 4 — Inventory · Layer 1 — chai (token box vs POS beverages)

    private var chaiCard: some View {
        StatCard(title: "Inventory · Layer 1 — chai", system: "cup.and.saucer.fill", accent: accent, status: nil) {
            if let t = model.token {
                VStack(spacing: 0) {
                    kvRow("Weighed tokens", "\(t.tokenCount ?? 0)")
                    kvRow("POS beverages", "\(t.odooTotalBeverages ?? 0)")
                    HStack {
                        Text("Gap").font(.system(size: 14)).foregroundStyle(HK.textDim)
                        Spacer()
                        let disc = t.discrepancy ?? 0
                        Text("\(disc > 0 ? "+" : "")\(disc)")
                            .font(.system(size: 15, weight: .semibold)).foregroundStyle(HK.text)
                        pill(abs(disc) > 20 ? "leak?" : "ok", abs(disc) > 20 ? HK.running : HK.ready)
                    }
                    .padding(.vertical, 7)
                    if let n = t.notes, !n.isEmpty {
                        Text(n).font(.system(size: 12)).foregroundStyle(HK.textFaint)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    Text("Snack/bun count-check wires in next — Frigate is Layer 2.")
                        .font(.system(size: 12)).foregroundStyle(HK.textFaint)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 4)
                }
            } else {
                Text("Source unreachable").font(.system(size: 13)).foregroundStyle(HK.textFaint)
            }
        }
    }

    // MARK: 5 — POS session (who holds the counter, and for how long)

    private var sessionCard: some View {
        StatCard(title: "POS session", system: "clock.fill", accent: accent, status: nil) {
            if let sh = model.shift, let mins = sh.shiftMinutes {
                let days = mins / 1440
                VStack(spacing: 0) {
                    kvRow("Cashier", sh.name ?? "—")
                    HStack {
                        Text("Open for").font(.system(size: 14)).foregroundStyle(HK.textDim)
                        Spacer()
                        Text("\(days) day\(days == 1 ? "" : "s")")
                            .font(.system(size: 15, weight: .semibold)).foregroundStyle(HK.text)
                        pill(days > 1 ? "never closed" : "ok", days > 1 ? HK.error : HK.ready)
                    }
                    .padding(.vertical, 7)
                }
            } else {
                Text(model.shift == nil ? "Source unreachable" : "No open session.")
                    .font(.system(size: 13)).foregroundStyle(HK.textFaint)
            }
        }
    }

    // MARK: shared-spec helpers (capsule chip · kv row · section label — the §10 canonical styles)

    private func sectionLabel(_ t: String) -> some View {
        Text(t).font(.system(size: 11, weight: .heavy)).foregroundStyle(HK.textFaint).tracking(0.6)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
    private func kvRow(_ k: String, _ v: String) -> some View {
        HStack {
            Text(k).font(.system(size: 14)).foregroundStyle(HK.textDim)
            Spacer()
            Text(v).font(.system(size: 15, weight: .semibold)).foregroundStyle(HK.text)
        }
        .padding(.vertical, 7)
    }
    private func pill(_ text: String, _ color: Color) -> some View {
        Text(text).font(.system(size: 10, weight: .heavy)).foregroundStyle(color)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.16), in: Capsule())
    }
    private func flagColor(_ l: TakhtFlag.Level) -> Color {
        switch l {
        case .red: return HK.error
        case .amber: return HK.running
        case .green: return HK.ready
        }
    }
}
