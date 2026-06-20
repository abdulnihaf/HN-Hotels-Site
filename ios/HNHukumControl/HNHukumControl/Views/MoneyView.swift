import SwiftUI

// Tijori — the money / cash / bank chamber. A faithful native port of the three deployed cockpits:
//   Bank  = /ops/bank/  (bank ledger over money_events)
//   Money = /ops/money/ (reconciliation cockpit + cash-position)
//   Cash  = /ops/cash/  (4-pile cash trail)
// One chamber, three capsule tabs. Read-only. Accent = Money teal 0x4FB0A8. Surfaces are the shared
// HK.bg / HK.card / HK.bgElev (contract §10 — identity is ONLY the accent). Money in paise ÷100 for
// bank+cash; the money cockpit already returns rupees.
//
// The chamber's reason to exist: cross-map BOTH HDFC accounts into ONE account-tagged view —
// business current 4680 (live) + personal savings 4005 (isolated D1, not yet in the feed) — plus the
// company-owes-Nihaf bridge. Where a feed isn't wired we say so honestly; we never fake a number.
struct MoneyView: View {
    @StateObject private var model = MoneyAppModel()
    @State private var tab: MoneyTab = MoneyTab.initial
    static let accent = Color(hex: 0x4FB0A8)

    var body: some View {
        ZStack {
            HK.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                ChamberHeader(title: "Tijori", subtitle: model.statusLine, accent: Self.accent)
                tabBar
                content
            }
        }
        .task { await model.bootstrap() }
        .navigationTitle("Tijori").navigationBarTitleDisplayMode(.inline)
    }

    // MARK: tab bar — shared capsule pattern (active = accent fill + black text)

    private var tabBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(MoneyTab.allCases, id: \.self) { t in
                    let on = tab == t
                    Button { tab = t } label: {
                        Text(t.label)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(on ? .black : HK.textDim)
                            .padding(.horizontal, 14).padding(.vertical, 8)
                            .background(on ? Self.accent : HK.card, in: Capsule())
                            .overlay(Capsule().stroke(on ? Color.clear : HK.line, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.bottom, 10)
    }

    @ViewBuilder private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if !model.loaded {
                    loadingCard
                } else {
                    switch tab {
                    case .bank:  bankTab
                    case .money: moneyTab
                    case .cash:  cashTab
                    }
                }
            }
            .padding(.horizontal, 16).padding(.top, 2).padding(.bottom, 28)
        }
        .scrollIndicators(.hidden)
        .refreshable { await model.refresh() }
    }

    // MARK: ───────── BANK tab ─────────

    @ViewBuilder private var bankTab: some View {
        if model.summary == nil && model.position == nil {
            unreachableCard("bank ledger")
        } else {
            bankHero
            accountsCard      // THE KEY WORK — both HDFC accounts, account-tagged, + owed-to-Nihaf
            flowCard
            sparkCard
            attentionCard
            ledgerCard
        }
    }

    private var bankHero: some View {
        let total = model.summary?.balances?.reduce(0.0) { $0 + $1.rupees }
        let live = model.summary?.balances?.count ?? 0
        return hero("BANK BALANCE", Self.money(total),
                    live <= 1 ? "HDFC current 4680 · live · per-txn alert feed"
                              : "\(live) accounts in feed")
    }

    // Both HDFC accounts in ONE account-tagged view — the whole point of the chamber.
    private var accountsCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Image(systemName: "building.columns.fill").font(.system(size: 16, weight: .semibold)).foregroundStyle(Self.accent)
                Text("Accounts").font(.system(size: 16, weight: .bold)).foregroundStyle(HK.text)
                Spacer()
                Text("BOTH HDFC + BRIDGE").font(.system(size: 9, weight: .heavy)).foregroundStyle(HK.textFaint).tracking(0.5)
            }
            .padding(.bottom, 6)
            // live accounts that carry a balance in the feed
            ForEach(model.summary?.balances ?? []) { b in
                accountRow(instrument: b.instrument, rupees: b.rupees, status: liveStatus(b.instrument), wired: true)
            }
            // Federal savings 4510 — a known source with no events yet (silent)
            if hasSource("federal_sa_4510") {
                accountRow(instrument: "federal_sa_4510", rupees: nil, status: "silent · no events ingested yet", wired: false)
            }
            // Personal HDFC 4005 — lives in the isolated hn-personal-finance D1 that NO cockpit reads.
            accountRow(instrument: "hdfc_sa_4005", rupees: nil, status: "personal a/c — not yet wired into feed (separate D1)", wired: false)
            // company-owes-Nihaf — tracked off-ledger (loose ledger files), no live surface yet
            bridgeRow
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HK.card, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(HK.line, lineWidth: 1))
    }

    private func accountRow(instrument: String?, rupees: Double?, status: String, wired: Bool) -> some View {
        let a = acct(instrument)
        return HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(acctTitle(instrument)).font(.system(size: 15, weight: .semibold)).foregroundStyle(HK.text)
                    chip(a.chip)
                    if let br = a.brand { brandChip(br) }
                }
                Text(status).font(.system(size: 11.5)).foregroundStyle(wired ? HK.textDim : HK.running)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            if let r = rupees {
                Text(Self.money(r)).font(.system(size: 17, weight: .heavy, design: .rounded)).foregroundStyle(HK.text)
            } else {
                Text("—").font(.system(size: 17, weight: .heavy, design: .rounded)).foregroundStyle(HK.textFaint)
            }
        }
        .padding(.vertical, 9)
        .overlay(Rectangle().fill(HK.lineSoft).frame(height: 1), alignment: .bottom)
    }

    private var bridgeRow: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text("Owed to Nihaf").font(.system(size: 15, weight: .semibold)).foregroundStyle(HK.text)
                    chip("BRIDGE")
                }
                Text("company owes Nihaf · personal-a/c business spend · off-ledger, not yet wired")
                    .font(.system(size: 11.5)).foregroundStyle(HK.running)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            Text("≈ ₹2.1L").font(.system(size: 17, weight: .heavy, design: .rounded)).foregroundStyle(HK.running)
        }
        .padding(.vertical, 9)
    }

    private var flowCard: some View {
        StatCard(title: "Cash flow", system: "arrow.left.arrow.right", accent: Self.accent, status: nil) {
            MetricGrid(metrics: [
                ("Today net", Self.signed(model.summary?.today?.netR)),
                ("Week net",  Self.signed(model.summary?.week?.netR)),
                ("Month net", Self.signed(model.summary?.month?.netR)),
                ("Week in",   Self.money(model.summary?.week?.creditR)),
                ("Week out",  Self.money(model.summary?.week?.debitR)),
                ("Month out", Self.money(model.summary?.month?.debitR)),
            ])
        }
    }

    private var sparkCard: some View {
        let rows = Array(model.daily.suffix(30))
        let maxV = max(rows.map { abs($0.netR) }.max() ?? 1, 1)
        return VStack(alignment: .leading, spacing: 8) {
            label("30-DAY NET FLOW", rows.isEmpty ? nil : "\(rows.count)d")
            if rows.isEmpty {
                Text("No daily flow in range.").font(.system(size: 13)).foregroundStyle(HK.textFaint)
            } else {
                HStack(alignment: .center, spacing: 2) {
                    ForEach(rows) { r in
                        let h = CGFloat(min(abs(r.netR) / maxV, 1)) * 38 + 2
                        ZStack {
                            Rectangle().fill(HK.lineSoft).frame(height: 1)
                            Capsule()
                                .fill(r.netR >= 0 ? HK.ready : HK.error)
                                .frame(height: h)
                                .offset(y: r.netR >= 0 ? -h / 2 : h / 2)
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 84)
                    }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HK.card, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(HK.line, lineWidth: 1))
    }

    private var attentionCard: some View {
        StatCard(title: "Reconcile queue", system: "tray.full.fill", accent: Self.accent,
                 status: model.attention == nil ? nil : "REVIEW") {
            if let c = model.attention?.counts {
                MetricGrid(metrics: [
                    ("Unmatched", "\(c.nUnmatched ?? 0)"),
                    ("Unreconciled", "\(c.nUnreconciled ?? 0)"),
                    ("Parse issues", "\(c.nParseIssues ?? 0)"),
                ])
                ForEach(Array((model.attention?.unmatched ?? []).prefix(3))) { r in
                    HStack(spacing: 8) {
                        Circle().fill(r.direction == "credit" ? HK.ready : HK.error).frame(width: 6, height: 6)
                        Text(r.counterparty ?? r.narration ?? "—").font(.system(size: 12.5)).foregroundStyle(HK.textDim).lineLimit(1)
                        Spacer()
                        Text(Self.money(r.rupees)).font(.system(size: 13, weight: .semibold, design: .rounded)).foregroundStyle(HK.text)
                    }
                }
                ownerNote("Match / mark-reconciled are owner-approve — wired later behind your tap.")
            } else {
                Text("Source unreachable").font(.system(size: 13)).foregroundStyle(HK.textFaint)
            }
        }
    }

    private var ledgerCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            label("RECENT", model.ledger.isEmpty ? nil : "\(model.ledger.count)")
            if model.ledger.isEmpty {
                note("No transactions in range.", "tray")
            } else {
                ForEach(Array(model.ledger.prefix(8))) { r in bankRowView(r) }
            }
        }
    }

    private func bankRowView(_ r: BankRow) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Text(r.who).font(.system(size: 14, weight: .semibold)).foregroundStyle(HK.text).lineLimit(1)
                Spacer()
                Text((r.isCredit ? "+ " : "− ") + Self.money(r.rupees))
                    .font(.system(size: 15, weight: .heavy, design: .rounded))
                    .foregroundStyle(r.isCredit ? HK.ready : HK.text)
            }
            HStack(spacing: 6) {
                chip(acct(r.instrument).chip)
                if let ch = r.channel, !ch.isEmpty { chip(ch.uppercased()) }
                if let br = brandLabel(r.brand) { brandChip(br) }
                if let sp = r.settlementPlatform, !sp.isEmpty { chip(sp.uppercased()) }
                if (r.reconcileStatus ?? "unreconciled") == "unreconciled" {
                    Text("!").font(.system(size: 10, weight: .heavy)).foregroundStyle(HK.running)
                        .padding(.horizontal, 6).padding(.vertical, 2).background(HK.running.opacity(0.16), in: Capsule())
                }
                Spacer()
                Text(istTime(r.txnAt)).font(.system(size: 10.5)).foregroundStyle(HK.textFaint)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HK.card, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(HK.line, lineWidth: 1))
    }

    // MARK: ───────── MONEY tab ─────────

    @ViewBuilder private var moneyTab: some View {
        if model.cockpit == nil && model.position == nil {
            unreachableCard("money cockpit")
        } else {
            positionCard
            kpiCard
            posOpenCard
            orphansDupesCard
            feedStatusCard
        }
    }

    // Phase-3 Cash Position — bank + per-account + petty + in-transit float + week/month net.
    private var positionCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text("POSITION NOW").font(.system(size: 11, weight: .heavy)).foregroundStyle(HK.textFaint).tracking(0.5)
                Text(Self.money(model.position?.grandTotal)).font(.system(size: 32, weight: .heavy, design: .rounded)).foregroundStyle(HK.text)
                Text("Bank + NCH petty + in-transit float").font(.system(size: 12)).foregroundStyle(HK.textDim)
            }
            ForEach(model.position?.bank?.accounts ?? []) { a in
                HStack(spacing: 6) {
                    Text(a.label ?? acct(a.instrument).chip).font(.system(size: 13, weight: .medium)).foregroundStyle(HK.textDim)
                    chip(acct(a.instrument).chip)
                    if a.stale == true {
                        Text("STALE").font(.system(size: 9, weight: .heavy)).foregroundStyle(HK.running)
                            .padding(.horizontal, 6).padding(.vertical, 2).background(HK.running.opacity(0.16), in: Capsule())
                    }
                    Spacer()
                    Text(Self.money(a.amount)).font(.system(size: 15, weight: .bold, design: .rounded)).foregroundStyle(HK.text)
                }
            }
            MetricGrid(metrics: [
                ("Bank", Self.money(model.position?.bank?.total)),
                ("Cash float", Self.money(model.position?.cash?.total)),
                ("In-transit", Self.money(model.position?.cash?.inTransitTotal)),
                ("Week net", Self.signed(model.position?.bank?.weekNet)),
                ("Month net", Self.signed(model.position?.bank?.monthNet)),
                ("Today out", Self.money(model.position?.todayOutflow?.total)),
            ])
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LinearGradient(colors: [Self.accent.opacity(0.16), HK.card], startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Self.accent.opacity(0.30), lineWidth: 1))
    }

    private var kpiCard: some View {
        StatCard(title: "Reconciliation", system: "doc.text.magnifyingglass", accent: Self.accent,
                 status: model.cockpit == nil ? nil : "LIVE") {
            if let k = model.cockpit?.kpis {
                MetricGrid(metrics: [
                    ("Paid", Self.money(k.paidTotal)),
                    ("Open POs", Self.money(k.openPoTotal)),
                    ("Bills due", Self.money(k.billsPendingTotal)),
                    ("PO count", "\(k.openPoCount ?? 0)"),
                    ("Orphans", "\(k.orphanCount ?? 0)"),
                    ("Dup suspects", "\(k.dupCount ?? 0)"),
                ])
            } else {
                Text("Source unreachable").font(.system(size: 13)).foregroundStyle(HK.textFaint)
            }
        }
    }

    private var posOpenCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            label("OPEN POs", "\(model.cockpit?.kpis?.openPoCount ?? (model.cockpit?.posOpen?.count ?? 0))")
            let rows = model.cockpit?.posOpen ?? []
            if rows.isEmpty {
                note("No open purchase orders.", "checkmark.seal")
            } else {
                ForEach(Array(rows.prefix(8))) { r in moneyRowView(r) }
            }
        }
    }

    private func moneyRowView(_ r: MoneyLedgerRow) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Text(r.vendorName ?? r.source ?? "—").font(.system(size: 14, weight: .semibold)).foregroundStyle(HK.text).lineLimit(1)
                Spacer()
                Text(Self.money(r.amount)).font(.system(size: 15, weight: .heavy, design: .rounded)).foregroundStyle(HK.text)
            }
            if let it = r.item, !it.isEmpty {
                Text(it).font(.system(size: 12)).foregroundStyle(HK.textDim).lineLimit(1)
            }
            HStack(spacing: 6) {
                if let br = brandLabel(r.brand) { brandChip(br) }
                if let nm = r.odooName, !nm.isEmpty { chip(nm) }
                if let by = r.recordedBy, !by.isEmpty { staffChip(by, nil) }
                Spacer()
                if (r.attachmentCount ?? 0) > 0 {
                    Image(systemName: "paperclip").font(.system(size: 10)).foregroundStyle(HK.textFaint)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HK.card, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(HK.line, lineWidth: 1))
    }

    private var orphansDupesCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            label("INTEGRITY", nil)
            if (model.cockpit?.orphans ?? []).isEmpty {
                note("No orphans — every outlet entry mirrored to Odoo.", "checkmark.seal.fill")
            } else {
                note("\(model.cockpit?.orphans?.count ?? 0) orphan(s) — outlet entries not mirrored to Odoo (dual-write gap).", "exclamationmark.triangle.fill")
            }
            if (model.cockpit?.dupAlerts ?? []).isEmpty {
                note("No duplicate suspects across PO ↔ cash.", "checkmark.seal.fill")
            } else {
                note("\(model.cockpit?.dupAlerts?.count ?? 0) duplicate suspect(s) — possible PO↔cash double-count.", "exclamationmark.triangle.fill")
                ownerNote("Resolve-dup (mark-paired / cancel PO) is owner-approve — wired later.")
            }
        }
    }

    private var feedStatusCard: some View {
        HStack(spacing: 8) {
            Text("FEEDS").font(.system(size: 10, weight: .heavy)).foregroundStyle(HK.textFaint).tracking(0.5)
            feedDot("NCH", model.cockpit?.feedStatus?.nchExport)
            feedDot("HE", model.cockpit?.feedStatus?.heExport)
            feedDot("Odoo PO", model.cockpit?.feedStatus?.odooPos)
            feedDot("Bills", model.cockpit?.feedStatus?.odooBills)
            Spacer()
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(HK.bgElev, in: RoundedRectangle(cornerRadius: 12))
    }

    private func feedDot(_ name: String, _ status: String?) -> some View {
        HStack(spacing: 4) {
            Circle().fill((status ?? "") == "ok" ? HK.ready : HK.running).frame(width: 6, height: 6)
            Text(name).font(.system(size: 11, weight: .semibold)).foregroundStyle(HK.textDim)
        }
    }

    // MARK: ───────── CASH tab ─────────

    @ViewBuilder private var cashTab: some View {
        if model.trail == nil {
            unreachableCard("cash trail")
        } else {
            cashHero
            pilesCard
            inFlightCard
            cashLedgerCard
            syncCard
        }
    }

    private var cashHero: some View {
        hero("TOTAL LIVE CASH", Self.money(model.trail?.totalR),
             "Across 4 piles · counter · Basheer · Nihaf")
    }

    private var pilesCard: some View {
        let piles = model.trail?.balances ?? []
        return LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
            ForEach(piles) { p in pileTile(p) }
        }
    }

    private func pileTile(_ p: CashPile) -> some View {
        let a = acct(p.instrument)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(p.label ?? a.chip).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(HK.textDim).lineLimit(1)
                if let br = a.brand { brandChip(br) }
                Spacer()
            }
            Text(Self.money(p.rupees)).font(.system(size: 22, weight: .heavy, design: .rounded)).foregroundStyle(HK.text)
            Text(p.anchorAt != nil ? "anchored · \(p.eventCount ?? 0) events" : "no anchor · \(p.eventCount ?? 0) events")
                .font(.system(size: 10)).foregroundStyle(HK.textFaint).lineLimit(1)
        }
        .padding(13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HK.bgElev, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(HK.lineSoft, lineWidth: 1))
    }

    private var inFlightCard: some View {
        StatCard(title: "In flight", system: "figure.walk.motion", accent: Self.accent,
                 status: model.trail?.pending == nil ? nil : "PENDING") {
            if let pend = model.trail?.pending {
                Text("\(Self.money(pend.totalR)) held by runners / captains — not yet in any pile")
                    .font(.system(size: 12.5)).foregroundStyle(HK.textDim).fixedSize(horizontal: false, vertical: true)
                ForEach(pend.breakdown ?? []) { it in
                    HStack(spacing: 8) {
                        Text(it.who ?? "—").font(.system(size: 13, weight: .medium)).foregroundStyle(HK.text).lineLimit(1)
                        chip((it.pile ?? "").uppercased())
                        Spacer()
                        Text(Self.money(it.rupees)).font(.system(size: 13, weight: .semibold, design: .rounded)).foregroundStyle(HK.text)
                    }
                }
            } else {
                Text("Source unreachable").font(.system(size: 13)).foregroundStyle(HK.textFaint)
            }
        }
    }

    private var cashLedgerCard: some View {
        let rows = model.trail?.ledger ?? []
        return VStack(alignment: .leading, spacing: 10) {
            label("CASH TRAIL", rows.isEmpty ? nil : "\(rows.count)")
            if rows.isEmpty {
                note("No cash events in range.", "tray")
            } else {
                ForEach(Array(rows.prefix(8))) { r in cashRowView(r) }
            }
        }
    }

    private func cashRowView(_ r: CashRow) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(acct(r.instrument).chip).font(.system(size: 13, weight: .semibold)).foregroundStyle(HK.text)
                if let br = brandLabel(r.brand) { brandChip(br) }
                Spacer()
                Text((r.isCredit ? "+ " : "− ") + Self.money(r.rupees))
                    .font(.system(size: 15, weight: .heavy, design: .rounded))
                    .foregroundStyle(r.isCredit ? HK.ready : HK.text)
            }
            if let nt = r.notes ?? r.vendorName, !nt.isEmpty {
                Text(nt).font(.system(size: 11.5)).foregroundStyle(HK.textDim).lineLimit(2).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 6) {
                if let src = r.source, !src.isEmpty { chip(src.uppercased()) }
                ForEach(r.linkedRefs, id: \.self) { ref in chip(ref) }
                Spacer()
                if let nm = r.recordedByName { staffChip(nm, r.recordedByPin) }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HK.card, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(HK.line, lineWidth: 1))
    }

    private var syncCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            label("SOURCE SYNC", "\(model.sync.count)")
            if model.sync.isEmpty {
                note("No sync state.", "arrow.triangle.2.circlepath")
            } else {
                ForEach(model.sync) { s in
                    HStack(spacing: 8) {
                        Circle().fill(syncColor(s.lastRunStatus)).frame(width: 7, height: 7)
                        Text(s.syncSource ?? "—").font(.system(size: 12.5, weight: .medium)).foregroundStyle(HK.textDim).lineLimit(1)
                        Spacer()
                        Text(s.lastRunStatus ?? "—").font(.system(size: 11, weight: .semibold)).foregroundStyle(HK.textFaint)
                    }
                    .padding(.vertical, 2)
                }
                ownerNote("Sync-now is owner-approve (admin/cfo) — read-only here.")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HK.card, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(HK.line, lineWidth: 1))
    }

    // MARK: ───────── shared chrome ─────────

    private var loadingCard: some View {
        HStack(spacing: 12) {
            ProgressView().tint(Self.accent)
            Text("Loading the money chamber…").font(.system(size: 14)).foregroundStyle(HK.textDim)
            Spacer()
        }
        .padding(16)
        .background(HK.card, in: RoundedRectangle(cornerRadius: 16))
    }

    private func unreachableCard(_ what: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Image(systemName: "wifi.exclamationmark").font(.system(size: 18)).foregroundStyle(HK.error)
                Text("Source unreachable").font(.system(size: 16, weight: .bold)).foregroundStyle(HK.text)
                Spacer()
            }
            Text("Couldn't reach the \(what) right now. Pull to refresh.")
                .font(.system(size: 13)).foregroundStyle(HK.textDim)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HK.card, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(HK.line, lineWidth: 1))
    }

    private func hero(_ caption: String, _ value: String, _ sub: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(caption).font(.system(size: 11, weight: .heavy)).foregroundStyle(HK.textFaint).tracking(0.5)
            Text(value).font(.system(size: 32, weight: .heavy, design: .rounded)).foregroundStyle(HK.text)
            Text(sub).font(.system(size: 12)).foregroundStyle(HK.textDim)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(LinearGradient(colors: [Self.accent.opacity(0.18), HK.card], startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Self.accent.opacity(0.35), lineWidth: 1))
    }

    private func label(_ t: String, _ trailing: String?) -> some View {
        HStack {
            Text(t).font(.system(size: 11, weight: .heavy)).foregroundStyle(HK.textFaint).tracking(0.6)
            Spacer()
            if let trailing, !trailing.isEmpty {
                Text(trailing).font(.system(size: 11, weight: .bold)).foregroundStyle(HK.textDim)
            }
        }
        .padding(.horizontal, 4).padding(.top, 4)
    }

    private func note(_ msg: String, _ icon: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).font(.system(size: 16)).foregroundStyle(Self.accent)
            Text(msg).font(.system(size: 13)).foregroundStyle(HK.textDim)
            Spacer()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HK.card, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(HK.line, lineWidth: 1))
    }

    private func ownerNote(_ msg: String) -> some View {
        HStack(spacing: 9) {
            Image(systemName: "hand.raised.fill").font(.system(size: 12)).foregroundStyle(HK.running)
            Text(msg).font(.system(size: 11.5, weight: .medium)).foregroundStyle(HK.running)
            Spacer()
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(HK.running.opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
    }

    private func chip(_ t: String) -> some View {
        Text(t).font(.system(size: 9.5, weight: .heavy)).foregroundStyle(HK.textDim)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(HK.bgElev, in: Capsule())
    }

    private func brandChip(_ b: String) -> some View {
        Text(b).font(.system(size: 9, weight: .heavy)).foregroundStyle(Self.accent)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(Self.accent.opacity(0.16), in: Capsule())
    }

    private func staffChip(_ name: String, _ pin: String?) -> some View {
        HStack(spacing: 4) {
            Image(systemName: "person.fill").font(.system(size: 8))
            Text(pin != nil ? "\(name) · \(pin!)" : name).font(.system(size: 9.5, weight: .bold)).lineLimit(1)
        }
        .foregroundStyle(HK.textDim)
        .padding(.horizontal, 7).padding(.vertical, 3)
        .background(HK.bgElev, in: Capsule())
    }

    private func syncColor(_ s: String?) -> Color {
        switch (s ?? "").lowercased() {
        case "ok": return HK.ready
        case "error", "failed": return HK.error
        case "idle": return HK.idle
        default: return HK.running
        }
    }

    // MARK: data helpers

    private func acct(_ instrument: String?) -> (chip: String, brand: String?) {
        switch instrument ?? "" {
        case "hdfc_ca_4680":   return ("CA · 4680", "HQ")
        case "hdfc_sa_4005":   return ("SA · 4005", nil)
        case "federal_sa_4510": return ("SA · 4510", nil)
        case "pos_counter_he": return ("HE counter", "HE")
        case "pos_counter_nch": return ("NCH counter", "NCH")
        case "cash_basheer":   return ("Basheer", nil)
        case "cash_nihaf":     return ("Nihaf", nil)
        default:               return (instrument ?? "—", nil)
        }
    }

    private func acctTitle(_ instrument: String?) -> String {
        switch instrument ?? "" {
        case "hdfc_ca_4680":   return "Business current"
        case "hdfc_sa_4005":   return "Personal · HDFC savings"
        case "federal_sa_4510": return "Personal · Federal savings"
        default:               return acct(instrument).chip
        }
    }

    private func liveStatus(_ instrument: String?) -> String {
        guard let sh = model.summary?.sourceHealth?.first(where: { $0.instrument == instrument }) else { return "live" }
        let st = (sh.liveStatus ?? sh.status ?? "").lowercased()
        let age: String = {
            guard let m = sh.ageMinutes else { return "" }
            if m < 60 { return " · \(Int(m))m ago" }
            if m < 1440 { return " · \(Int(m / 60))h ago" }
            return " · \(Int(m / 1440))d ago"
        }()
        switch st {
        case "healthy": return "live\(age)"
        case "stale":   return "stale\(age)"
        case "silent":  return "silent — feed quiet"
        case "":        return "live\(age)"
        default:        return st + age
        }
    }

    private func hasSource(_ instrument: String) -> Bool {
        model.summary?.sourceHealth?.contains(where: { $0.instrument == instrument }) ?? false
    }

    private func brandLabel(_ b: String?) -> String? {
        guard let raw = b?.lowercased(), !raw.isEmpty, raw != "null" else { return nil }
        switch raw {
        case "mixed", "both": return "BOTH"
        case "hq": return "HQ"
        case "he": return "HE"
        case "nch": return "NCH"
        default: return raw.uppercased()
        }
    }

    // crude IST HH:MM lift from an ISO/offset string — display only
    private func istTime(_ s: String?) -> String {
        guard let s, s.count >= 16 else { return "" }
        if let tIdx = s.firstIndex(of: "T") {
            let after = s.index(after: tIdx)
            let end = s.index(after, offsetBy: 5, limitedBy: s.endIndex) ?? s.endIndex
            return String(s[after..<end])
        }
        return ""
    }

    // MARK: formatting

    static func money(_ v: Double?) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.maximumFractionDigits = 0
        f.locale = Locale(identifier: "en_IN")
        return "₹" + (f.string(from: NSNumber(value: v ?? 0)) ?? "0")
    }

    static func short(_ v: Double) -> String {
        let a = abs(v)
        if a >= 1e7 { return String(format: "₹%.2fCr", v / 1e7) }
        if a >= 1e5 { return String(format: "₹%.1fL", v / 1e5) }
        return money(v)
    }

    static func signed(_ v: Double?) -> String {
        let n = v ?? 0
        return (n < 0 ? "− " : "+ ") + money(abs(n))
    }
}

enum MoneyTab: CaseIterable {
    case bank, money, cash
    // verification hook: MONEY_TAB=money|cash picks the starting tab on the sim
    static var initial: MoneyTab {
        switch ProcessInfo.processInfo.environment["MONEY_TAB"] {
        case "money": return .money
        case "cash":  return .cash
        default:      return .bank
        }
    }
    var label: String {
        switch self {
        case .bank:  return "Bank"
        case .money: return "Money"
        case .cash:  return "Cash"
        }
    }
}
