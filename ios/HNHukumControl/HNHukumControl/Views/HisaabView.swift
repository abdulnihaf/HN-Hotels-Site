import SwiftUI

// Hisaab — the daily operating-P&L "reckoning" glance. READ-ONLY (read-and-freeze chamber;
// the freeze/bill mutations live on the web — never wired here). HONEST-BLOCKED: a stale feed
// reads as a calm amber "Day blocked — N gates pending" + the verbatim reason, NEVER a fake
// number. The one number Nihaf wants — Operating Profit — is the hero; null → never shown.
// Built from the shared kit only (ChamberHeader, StatCard, MetricGrid, capsule tab bar) per §10.
struct HisaabView: View {
    @StateObject private var model = HisaabAppModel()
    private let accent = Color(hex: 0x7FA86A)      // §10 Hisaab accent — the ONLY colour we choose

    var body: some View {
        ZStack {
            HK.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                ChamberHeader(title: "Hisaab", subtitle: model.statusLine, accent: accent)
                brandTabBar
                ScrollView {
                    VStack(spacing: 12) {
                        if let s = model.summary {
                            hero(s)
                            pnlCard(s)
                            gatesCard(s)
                            witnesses(s)
                        } else {
                            Text(model.statusLine)
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(HK.textFaint)
                                .frame(maxWidth: .infinity).padding(.top, 44)
                        }
                    }
                    .padding(.horizontal, 16).padding(.bottom, 18)
                }
                .scrollIndicators(.hidden)
                .refreshable { await model.refresh() }
            }
        }
        .task { await model.bootstrap() }
        .navigationTitle("Hisaab")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: brand toggle — the shared horizontal capsule tab bar (active = accent fill + black).
    private var brandTabBar: some View {
        HStack(spacing: 8) {
            ForEach(HisaabBrand.allCases) { b in
                let on = model.brand == b
                Button { model.brand = b } label: {
                    Text(b.label)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(on ? .black : HK.textDim)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(on ? accent : HK.card, in: Capsule())
                        .overlay(Capsule().stroke(on ? Color.clear : HK.line, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16).padding(.bottom, 10)
    }

    // MARK: hero — status badge + the one Operating-Profit number, or the honest blocked state.
    private func hero(_ s: HisaabSummary) -> some View {
        let st = (s.status ?? "blocked").lowercased()
        let col = statusColor(st)
        let op = s.pnl?.operatingProfitPaise
        let showNumber = !model.isBlocked && op != nil
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Circle().fill(col).frame(width: 9, height: 9)
                Text(st.uppercased())
                    .font(.system(size: 10, weight: .heavy)).tracking(0.6)
                    .foregroundStyle(col)
                brandChip(s.brand ?? model.brand.rawValue)
                Spacer()
                Text("OPERATING PROFIT")
                    .font(.system(size: 10, weight: .heavy)).tracking(0.5)
                    .foregroundStyle(HK.textFaint)
            }
            if showNumber {
                Text(HisaabFmt.rupees(op))
                    .font(.system(size: 34, weight: .heavy, design: .rounded))
                    .foregroundStyle(profitColor(op))
                Text("margin \(HisaabFmt.marginPct(s.pnl?.operatingMarginBp))")
                    .font(.system(size: 13, weight: .medium)).foregroundStyle(HK.textDim)
            } else {
                // Honest blocked — amber, never a fabricated number.
                Text(model.heroBlockedNote)
                    .font(.system(size: 21, weight: .bold))
                    .foregroundStyle(HK.running)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(LinearGradient(colors: [col.opacity(0.16), HK.card],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(col.opacity(0.35), lineWidth: 1))
    }

    // MARK: P&L grid — null → "—", profit cards by sign. Reuses the shared StatCard + MetricGrid.
    private func pnlCard(_ s: HisaabSummary) -> some View {
        let p = s.pnl
        return StatCard(title: "Profit & Loss", system: "indianrupeesign.circle.fill",
                        accent: accent, status: (s.status ?? "").isEmpty ? nil : s.status) {
            MetricGrid(metrics: [
                ("Revenue", HisaabFmt.rupees(p?.revenuePaise)),
                ("Raw COGS", HisaabFmt.rupees(p?.rawCogsPaise)),
                ("Gross profit", HisaabFmt.rupees(p?.grossFoodProfitPaise)),
                ("Gross margin", HisaabFmt.marginPct(p?.grossFoodMarginBp)),
                ("Labor", HisaabFmt.rupees(p?.laborPaise)),
                ("Major bills", HisaabFmt.rupees(p?.majorBillsPaise)),
            ])
        }
    }

    // MARK: gates — 4 rows, verbatim reason when blocked (amber), ₹ when the gate is met (green).
    private func gatesCard(_ s: HisaabSummary) -> some View {
        StatCard(title: "Gates", system: "checklist", accent: accent,
                 status: model.isBlocked ? "\(s.missingGates?.count ?? 0) blocked" : "all met") {
            VStack(spacing: 0) {
                ForEach(s.gates?.ordered ?? []) { row in
                    gateRow(row, value: gateValue(row.key, s.pnl))
                }
            }
        }
    }

    private func gateRow(_ row: HisaabGateRow, value: String) -> some View {
        let ok = row.gate?.ok == true
        return HStack(alignment: .top, spacing: 10) {
            Image(systemName: ok ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(ok ? HK.ready : HK.running)
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(row.title)
                        .font(.system(size: 15, weight: .semibold)).foregroundStyle(HK.text)
                    Spacer()
                    if ok {
                        Text(value).font(.system(size: 15, weight: .bold, design: .rounded))
                            .foregroundStyle(HK.ready)
                    }
                }
                if !ok {
                    // Verbatim upstream reason — names the latest available day. Never paraphrase.
                    Text("blocked: \(row.gate?.reason ?? "feed unavailable")")
                        .font(.system(size: 12)).foregroundStyle(HK.running)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(.vertical, 9)
        .overlay(alignment: .top) { Rectangle().fill(HK.line).frame(height: 1).opacity(row.key == "revenue" ? 0 : 1) }
    }

    // MARK: witnesses — read-only cross-checks, NOT counted in COGS. Collapsed by default.
    private func witnesses(_ s: HisaabSummary) -> some View {
        let w = s.inputs?.anbar?.witnesses
        let rev = s.inputs?.revenue
        return StatCard(title: "Cross-checks", system: "magnifyingglass.circle.fill",
                        accent: accent, status: "read-only") {
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 8) {
                    Text("witnesses — not summed into COGS")
                        .font(.system(size: 11, weight: .medium)).foregroundStyle(HK.textFaint)
                    witnessRow("Revenue mirror", rev?.orderCount.map { "\($0) orders" } ?? "—",
                               rev?.lastRecomputedAt ?? rev?.latestDay)
                    witnessRow("Anbar settlement", s.inputs?.anbar?.id.map { "#\($0)" } ?? "none",
                               s.inputs?.anbar?.settledAt ?? s.inputs?.anbar?.latestDay)
                    witnessRow("Sauda purchases", "\(w?.saudaPurchase?.rows ?? 0) rows",
                               HisaabFmt.rupees(w?.saudaPurchase?.amountPaise))
                    witnessRow("Shared (BOTH) Sauda", "\(w?.saudaBothPurchase?.rows ?? 0) rows",
                               HisaabFmt.rupees(w?.saudaBothPurchase?.amountPaise))
                    witnessRow("Chicken ledger", "\(w?.chickenDailyLedger?.rows ?? 0) rows",
                               HisaabFmt.rupees(w?.chickenDailyLedger?.costPaise))
                    witnessRow("Anbar receipts", "\(w?.receipts?.rows ?? 0) rows",
                               HisaabFmt.kg(w?.receipts?.qty))
                    witnessRow("Active staff", "\(s.inputs?.labor?.activeStaff ?? 0)", nil)
                    if let h = s.sourceHash, !h.isEmpty {
                        witnessRow("Source hash", String(h.prefix(12)),
                                   s.finalSourceChanged == true ? "changed after final" : "current inputs")
                    }
                }
                .padding(.top, 8)
            } label: {
                Text("Witnesses & source")
                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(HK.text)
            }
            .tint(accent)
        }
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

    // MARK: small bits
    private func brandChip(_ b: String) -> some View {
        Text(b.uppercased())
            .font(.system(size: 9, weight: .heavy)).tracking(0.4)
            .foregroundStyle(accent)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(accent.opacity(0.16), in: Capsule())
    }

    private func gateValue(_ key: String, _ p: HisaabPnl?) -> String {
        switch key {
        case "revenue": return HisaabFmt.rupees(p?.revenuePaise)
        case "anbar_settlement": return HisaabFmt.rupees(p?.rawCogsPaise)
        case "labor": return HisaabFmt.rupees(p?.laborPaise)
        case "major_bills": return HisaabFmt.rupees(p?.majorBillsPaise)
        default: return "—"
        }
    }

    private func statusColor(_ st: String) -> Color {
        switch st {
        case "final": return HK.ready
        case "draft": return accent
        default: return HK.running       // blocked → amber (honest, per brief §UI)
        }
    }

    private func profitColor(_ paise: Int?) -> Color {
        guard let paise else { return HK.textDim }   // null → dim, never green/red-as-if-real
        return paise >= 0 ? HK.ready : HK.error
    }
}
