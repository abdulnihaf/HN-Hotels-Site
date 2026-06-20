import SwiftUI

// Takht — the day's settlement at a glance. RUPEES (never ÷100). READ-ONLY owner-witness.
// Gate (verify-pin) → board. Correction/rectify is execution and OUT OF SCOPE — disabled placeholder only.
struct TakhtSettlementView: View {
    @StateObject private var model = TakhtAppModel()
    private let accent = Color(hex: 0xC8964A)

    var body: some View {
        ZStack {
            HK.bg.ignoresSafeArea()
            if model.unlocked {
                board
            } else {
                TakhtGateView(model: model)
            }
        }
        .task { if model.unlocked { await model.bootstrap() } }
        .navigationTitle("Takht")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var board: some View {
        VStack(spacing: 0) {
            ChamberHeader(title: "Takht", subtitle: model.status, accent: accent)
            ScrollView {
                VStack(spacing: 12) {
                    flagsCard
                    handHero
                    upiCard
                    chaiCard
                    sessionCard
                    rectifyPlaceholder
                }
                .padding(.horizontal, 16).padding(.bottom, 18)
            }
            .scrollIndicators(.hidden)
            .refreshable { await model.refresh() }
        }
    }

    // ── FLAGS FIRST — "what was missed, read to staff" ──
    private var flagsCard: some View {
        StatCard(title: "What was missed", system: "exclamationmark.bubble.fill", accent: accent, status: "READ TO STAFF") {
            VStack(spacing: 8) {
                ForEach(model.flags) { f in flagRow(f) }
            }
        }
    }

    private func flagRow(_ f: TakhtFlag) -> some View {
        let c: Color = f.level == .red ? HK.error : (f.level == .amber ? HK.running : HK.ready)
        return HStack(alignment: .top, spacing: 10) {
            Circle().fill(c).frame(width: 9, height: 9).padding(.top, 5)
            VStack(alignment: .leading, spacing: 2) {
                Text(f.title).font(.system(size: 14, weight: .bold)).foregroundStyle(HK.text)
                Text(f.cause).font(.system(size: 12.5)).foregroundStyle(HK.textDim).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(11)
        .background(c.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(c.opacity(0.3), lineWidth: 0.5))
    }

    // ── THE RUPEE THAT REACHES YOUR HAND — Runners → Cashier → You ──
    private var handHero: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 0) {
                chainNode("Runners", TakhtFmt.rupee(model.balance?.runnerCash), HK.textDim)
                Text("→").foregroundStyle(accent).font(.system(size: 16, weight: .bold)).padding(.horizontal, 4)
                chainNode("Cashier", TakhtFmt.rupee(model.balance?.counterCash), HK.textDim)
                Text("→").foregroundStyle(accent).font(.system(size: 16, weight: .bold)).padding(.horizontal, 4)
                chainNode("You", TakhtFmt.rupee(model.handTotal), accent)
            }
            .padding(.bottom, 6)

            if model.balance != nil {
                Text(TakhtFmt.rupee(model.handTotal))
                    .font(.system(size: 40, weight: .heavy, design: .rounded)).foregroundStyle(HK.text)
                Text("cash that should reach your hand")
                    .font(.system(size: 12)).foregroundStyle(HK.textDim)
            } else {
                Text("Counter balance unreadable")
                    .font(.system(size: 15, weight: .semibold)).foregroundStyle(HK.textFaint).padding(.vertical, 8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(LinearGradient(colors: [accent.opacity(0.18), HK.card], startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(accent.opacity(0.35), lineWidth: 1))
    }

    private func chainNode(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text(label).font(.system(size: 11, weight: .heavy)).foregroundStyle(color == accent ? accent : HK.textDim)
            Text(value).font(.system(size: 13, weight: .bold, design: .rounded)).foregroundStyle(color == accent ? accent : HK.text)
        }
        .frame(maxWidth: .infinity)
    }

    // ── UPI · Razorpay vs POS ──
    private var upiCard: some View {
        StatCard(title: "UPI · Razorpay vs POS", system: "indianrupeesign.circle.fill", accent: Color(hex: 0x5e9eff),
                 status: model.upi == nil ? nil : "LIVE") {
            if let snaps = model.upi?.snapshots, !snaps.isEmpty {
                VStack(spacing: 7) {
                    ForEach(snaps) { s in
                        HStack(spacing: 6) {
                            Text(s.entity + (s.isRunnerQr == true ? " (runner)" : ""))
                                .font(.system(size: 12.5, weight: .medium)).foregroundStyle(HK.textDim).lineLimit(1)
                            Spacer()
                            Text(TakhtFmt.rupee(s.razorpay)).font(.system(size: 13, weight: .semibold)).foregroundStyle(HK.text)
                            Text("/r").font(.system(size: 10)).foregroundStyle(HK.textFaint)
                            Text(TakhtFmt.rupee(s.posUpi)).font(.system(size: 13, weight: .semibold)).foregroundStyle(HK.text)
                            Text("/p").font(.system(size: 10)).foregroundStyle(HK.textFaint)
                            gapPill(s)
                        }
                    }
                }
            } else {
                Text("Source unreachable").font(.system(size: 13)).foregroundStyle(HK.textFaint)
            }
        }
    }

    private func gapPill(_ s: TakhtUpiSnapshot) -> some View {
        let off = s.isOff
        let txt = off ? (s.gap > 0 ? "+" : "") + TakhtFmt.rupee(s.gap) : "✓"
        let c: Color = off ? HK.error : HK.ready
        return Text(txt)
            .font(.system(size: 10, weight: .heavy)).foregroundStyle(c)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(c.opacity(0.16), in: Capsule())
    }

    // ── Inventory Layer 1 — chai (token box vs POS) ──
    private var chaiCard: some View {
        StatCard(title: "Inventory · chai", system: "cup.and.saucer.fill", accent: accent, status: nil) {
            if let t = model.token {
                MetricGrid(metrics: [
                    ("Weighed tokens", "\(t.tokenCount ?? 0)"),
                    ("POS beverages", "\(t.odooTotalBeverages ?? 0)"),
                    ("Gap", "\((t.discrepancy ?? 0) > 0 ? "+" : "")\(t.discrepancy ?? 0)"),
                ])
            } else {
                Text("Source unreachable").font(.system(size: 13)).foregroundStyle(HK.textFaint)
            }
        }
    }

    // ── POS session ──
    private var sessionCard: some View {
        StatCard(title: "POS session", system: "clock.badge.checkmark.fill", accent: accent, status: nil) {
            if let sh = model.shift {
                let days = (sh.shiftMinutes ?? 0) / 1440
                MetricGrid(metrics: [
                    ("Cashier", sh.name ?? "—"),
                    ("Open for", "\(days)d"),
                    ("State", days > 1 ? "never closed" : "ok"),
                ])
            } else {
                Text("No shift on record").font(.system(size: 13)).foregroundStyle(HK.textFaint)
            }
        }
    }

    // ── Correction is EXECUTION — out of scope here. Disabled placeholder only. ──
    private var rectifyPlaceholder: some View {
        HStack(spacing: 10) {
            Image(systemName: "wrench.and.screwdriver.fill").font(.system(size: 15)).foregroundStyle(HK.textFaint)
            VStack(alignment: .leading, spacing: 2) {
                Text("One-tap correct").font(.system(size: 14, weight: .semibold)).foregroundStyle(HK.textFaint)
                Text("Fixes happen in the staff settlement app — this is the witness view.")
                    .font(.system(size: 12)).foregroundStyle(HK.textFaint)
            }
            Spacer(minLength: 0)
        }
        .padding(13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HK.bgElev, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(HK.line, lineWidth: 1))
        .opacity(0.7)
    }
}
