import SwiftUI

// Hisab — the daily P&L "reckoning" glance. READ-ONLY (read-and-freeze chamber; the freeze mutation
// lives on the web — not built here). Honest-blocked: stale feeds read as a calm "waiting on X",
// never a fake number. The one number Nihaf wants — Operating Profit — is the hero; null → "—".
struct HisabTodayView: View {
    @StateObject private var model = HisabAppModel()
    private let accent = Color(hex: 0x7FA86A)

    var body: some View {
        ZStack {
            HK.bg.ignoresSafeArea()
            if model.needsAuth {
                HisabGateView(model: model)
            } else {
                content
            }
        }
        .task { await model.bootstrap() }
        .navigationTitle("Hisaab")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var content: some View {
        VStack(spacing: 0) {
            ChamberHeader(title: "Hisaab", subtitle: model.statusLine, accent: accent)
            brandPicker
            ScrollView {
                VStack(spacing: 12) {
                    if let s = model.summary {
                        hero(s)
                        gatesPanel(s)
                        metricsGrid(s)
                        witnesses(s)
                        if let fr = s.finalRun { frozenSeal(fr, changed: s.finalSourceChanged == true) }
                    } else {
                        Text(model.statusLine)
                            .font(.subheadline).foregroundStyle(HK.textFaint)
                            .padding(.top, 44)
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 18)
            }
            .scrollIndicators(.hidden)
            .refreshable { await model.refresh() }
        }
    }

    private var brandPicker: some View {
        Picker("Brand", selection: $model.brand) {
            ForEach(HisabBrand.allCases) { Text($0 == .he ? "Hamza Express" : "Nawabi Chai House").tag($0) }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 16).padding(.bottom, 10)
    }

    // MARK: hero — status capsule + the one Operating-Profit number (or honest "can't reckon yet").
    private func hero(_ s: HisabSummary) -> some View {
        let st = (s.status ?? "blocked").lowercased()
        let col = statusColor(st)
        let blocked = st == "blocked"
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Circle().fill(col).frame(width: 9, height: 9)
                Text(st.uppercased())
                    .font(.system(size: 11, weight: .heavy)).tracking(0.6)
                    .foregroundStyle(col)
                Spacer()
                Text("OPERATING PROFIT")
                    .font(.system(size: 10, weight: .heavy)).tracking(0.5)
                    .foregroundStyle(HK.textFaint)
            }
            if blocked {
                Text(model.heroNote)
                    .font(.system(size: 19, weight: .bold))
                    .foregroundStyle(HK.text)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text(HisabFmt.rupees(s.pnl?.operatingProfitPaise))
                    .font(.system(size: 38, weight: .heavy, design: .rounded))
                    .foregroundStyle(profitColor(s.pnl?.operatingProfitPaise))
                HStack(spacing: 10) {
                    Text("margin \(HisabFmt.marginPct(s.pnl?.operatingMarginBp))")
                        .font(.system(size: 13, weight: .medium)).foregroundStyle(HK.textDim)
                    Text(model.heroNote)
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(col)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(LinearGradient(colors: [col.opacity(0.16), HK.card], startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(col.opacity(0.35), lineWidth: 1))
    }

    // MARK: gates — vertical checklist, verbatim reason when missing.
    private func gatesPanel(_ s: HisabSummary) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("GATES")
                .font(.system(size: 11, weight: .heavy)).tracking(0.5).foregroundStyle(HK.textFaint)
            ForEach(s.gates?.ordered ?? [], id: \.key) { row in
                gateRow(title: row.title, gate: row.gate)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(15)
        .background(HK.card, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(HK.line, lineWidth: 1))
    }

    private func gateRow(title: String, gate: HisabGate?) -> some View {
        let ok = gate?.ok == true
        return HStack(alignment: .top, spacing: 10) {
            Image(systemName: ok ? "checkmark.circle.fill" : "xmark.circle.fill")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(ok ? HK.ready : HK.error)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 14.5, weight: .semibold)).foregroundStyle(HK.text)
                if !ok, let reason = gate?.reason, !reason.isEmpty {
                    // Verbatim — names the latest available upstream day. Never paraphrase.
                    Text(reason)
                        .font(.system(size: 12)).foregroundStyle(HK.textDim)
                        .fixedSize(horizontal: false, vertical: true)
                } else if ok {
                    Text("OK").font(.system(size: 11, weight: .heavy)).foregroundStyle(HK.ready)
                }
            }
            Spacer()
        }
        .padding(.vertical, 4)
    }

    // MARK: metrics grid — 2-col, null → "—", profit cards green/red by sign.
    private func metricsGrid(_ s: HisabSummary) -> some View {
        let p = s.pnl
        let cols = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]
        return LazyVGrid(columns: cols, spacing: 10) {
            metricCard("Revenue", HisabFmt.rupees(p?.revenuePaise), tint: HK.text)
            metricCard("Raw COGS", HisabFmt.rupees(p?.rawCogsPaise), tint: p?.rawCogsPaise == nil ? HK.running : HK.text)
            metricCard("Gross food profit", HisabFmt.rupees(p?.grossFoodProfitPaise),
                       sub: "margin \(HisabFmt.marginPct(p?.grossFoodMarginBp))",
                       tint: profitColor(p?.grossFoodProfitPaise))
            metricCard("Labor", HisabFmt.rupees(p?.laborPaise), tint: HK.text)
            metricCard("Major bills", HisabFmt.rupees(p?.majorBillsPaise), tint: p?.majorBillsPaise == nil ? HK.running : HK.text)
            metricCard("Operating profit", HisabFmt.rupees(p?.operatingProfitPaise),
                       sub: "margin \(HisabFmt.marginPct(p?.operatingMarginBp))",
                       tint: profitColor(p?.operatingProfitPaise))
        }
    }

    private func metricCard(_ label: String, _ value: String, sub: String? = nil, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.system(size: 10, weight: .heavy)).tracking(0.4).foregroundStyle(HK.textFaint)
            Text(value)
                .font(.system(size: 20, weight: .heavy, design: .rounded)).foregroundStyle(tint)
            if let sub {
                Text(sub).font(.system(size: 11, weight: .medium)).foregroundStyle(HK.textDim)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .topLeading)
        .padding(13)
        .background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.line, lineWidth: 1))
    }

    // MARK: witnesses — read-only cross-checks, NOT counted in COGS.
    private func witnesses(_ s: HisabSummary) -> some View {
        let w = s.inputs?.anbar?.witnesses
        let rev = s.inputs?.revenue
        return DisclosureGroup {
            VStack(alignment: .leading, spacing: 8) {
                Text("read-only — not counted in COGS")
                    .font(.system(size: 11, weight: .medium)).foregroundStyle(HK.textFaint)
                witnessRow("Revenue mirror", rev?.orderCount.map { "\($0) orders" } ?? "—",
                           rev?.lastRecomputedAt ?? rev?.latestDay)
                witnessRow("Anbar settlement", s.inputs?.anbar?.id.map { "#\($0)" } ?? "none",
                           s.inputs?.anbar?.settledAt ?? s.inputs?.anbar?.latestDay)
                witnessRow("Sauda purchases", "\(w?.saudaPurchase?.rows ?? 0) rows",
                           HisabFmt.rupees(w?.saudaPurchase?.amountPaise))
                witnessRow("Shared (BOTH) Sauda", "\(w?.saudaBothPurchase?.rows ?? 0) rows",
                           HisabFmt.rupees(w?.saudaBothPurchase?.amountPaise))
                witnessRow("Chicken ledger", "\(w?.chickenDailyLedger?.rows ?? 0) rows",
                           HisabFmt.rupees(w?.chickenDailyLedger?.costPaise))
                witnessRow("Anbar receipts", "\(w?.receipts?.rows ?? 0) rows",
                           HisabFmt.kg(w?.receipts?.qty))
                witnessRow("Active staff", "\(s.inputs?.labor?.activeStaff ?? 0)", nil)
                if let h = s.sourceHash, !h.isEmpty {
                    witnessRow("Source hash", String(h.prefix(12)),
                               s.finalSourceChanged == true ? "changed after final" : "current inputs")
                }
            }
            .padding(.top, 8)
        } label: {
            Text("Cross-checks")
                .font(.system(size: 14, weight: .bold)).foregroundStyle(HK.text)
        }
        .tint(accent)
        .padding(15)
        .background(HK.card, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(HK.line, lineWidth: 1))
    }

    private func witnessRow(_ label: String, _ value: String, _ detail: String?) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.system(size: 12.5, weight: .medium)).foregroundStyle(HK.textDim)
            Spacer()
            VStack(alignment: .trailing, spacing: 1) {
                Text(value).font(.system(size: 13, weight: .semibold)).foregroundStyle(HK.text)
                if let detail, !detail.isEmpty {
                    Text(detail).font(.system(size: 10.5)).foregroundStyle(HK.textFaint)
                }
            }
        }
    }

    // MARK: frozen seal — read-only display of the finalized run (no re-finalize affordance).
    private func frozenSeal(_ fr: HisabFinalRun, changed: Bool) -> some View {
        HStack(spacing: 10) {
            Image(systemName: changed ? "exclamationmark.triangle.fill" : "lock.fill")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(changed ? HK.running : HK.ready)
            VStack(alignment: .leading, spacing: 2) {
                Text(fr.id.map { "Final run #\($0)" } ?? "Finalized")
                    .font(.system(size: 14, weight: .bold)).foregroundStyle(HK.text)
                Text(changed ? "Source changed after finalization — verdict suspect (re-freeze on web)"
                             : "Frozen by \(fr.createdBy ?? "—") · \(fr.finalizedAt ?? "")")
                    .font(.system(size: 11.5)).foregroundStyle(HK.textDim)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
        }
        .padding(14)
        .background(HK.card, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke((changed ? HK.running : HK.ready).opacity(0.4), lineWidth: 1))
    }

    // MARK: helpers
    private func statusColor(_ st: String) -> Color {
        switch st {
        case "final": return HK.ready
        case "draft": return HK.running
        default: return HK.error      // blocked
        }
    }

    private func profitColor(_ paise: Int?) -> Color {
        guard let paise else { return HK.textDim }   // null → dim, never green/red-as-if-real
        return paise >= 0 ? HK.ready : HK.error
    }
}
