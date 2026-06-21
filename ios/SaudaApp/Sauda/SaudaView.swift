import SwiftUI

// Sauda — the daily-buying chamber. FAITHFUL native port of the deployed PWA's 8 tabs
// (Buy list · Place · Purchase day · To pay · Vendor diary · Hyperpure · Compare · Settings).
// READ-ONLY: place / pay / decode / save controls are rendered but inert — the coordinator wires
// those behind the owner's tap. Accent = sauda gold 0xD4A24C. Composes only from the shared kit.
struct SaudaView: View {
    @StateObject private var model = SaudaAppModel()
    private let accent = Color(hex: 0xD4A24C)

    var body: some View {
        ZStack {
            HK.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                ChamberHeader(title: "Sauda", subtitle: model.statusLine, accent: accent)
                tabStrip
                if model.locked {
                    lockedView
                } else {
                    ScrollView {
                        LazyVStack(spacing: 12) { tabContent }
                            .padding(.horizontal, 16).padding(.top, 4).padding(.bottom, 20)
                    }
                    .scrollIndicators(.hidden)
                    .refreshable { await model.refresh() }
                }
            }
        }
        .task { await model.bootstrap() }
        .navigationTitle("Sauda")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: tab strip (§10 capsule bar — active = accent fill + black text; inactive = card + dim)
    private var tabStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(SaudaAppModel.Tab.allCases) { t in
                    let on = model.tab == t
                    Button { model.switchTo(t) } label: {
                        Text(t.title)
                            .font(.system(size: 13, weight: .heavy))
                            .foregroundStyle(on ? .black : HK.textDim)
                            .padding(.horizontal, 13).padding(.vertical, 8)
                            .background(on ? accent : HK.card, in: Capsule())
                            .overlay(Capsule().stroke(on ? .clear : HK.line, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
        }
    }

    @ViewBuilder private var tabContent: some View {
        switch model.tab {
        case .buy:         buyList
        case .place:       place
        case .purchaseDay: purchaseDay
        case .pay:         toPay
        case .vendors:     vendorDiary
        case .hyperpure:   hyperpure
        case .compare:     compare
        case .settings:    settings
        }
    }

    private var lockedView: some View {
        VStack(spacing: 10) {
            Image(systemName: "lock.fill").font(.system(size: 26)).foregroundStyle(HK.textFaint)
            Text("Unlock from the Diwan home").font(.system(size: 15, weight: .semibold)).foregroundStyle(HK.textDim)
        }.frame(maxWidth: .infinity).padding(.top, 60)
    }

    // ════════════════════════════ 1 · BUY LIST ════════════════════════════
    private var buyList: some View {
        Group {
            inertBanner("Paste a WhatsApp order", system: "doc.on.clipboard",
                        note: "Decode is owner-approve — it opens from the Hukum unlock.")
            HStack(spacing: 8) {
                inertChip("For today", on: true); inertChip("For tomorrow", on: false); Spacer()
            }
            if let items = model.compare?.items, !items.isEmpty {
                sectionLabel("WHAT TO BUY")
                ForEach(items) { it in buyRow(it) }
            } else { stateNote(model.statusLine) }
        }
    }
    private func buyRow(_ it: SaudaCompareItem) -> some View {
        card {
            HStack(spacing: 12) {
                monogram(it.label)
                VStack(alignment: .leading, spacing: 3) {
                    Text(it.label ?? it.item_key ?? "—").rowTitle()
                    Text(usual(it)).body13()
                }
                Spacer()
                let ready = (it.your_paise ?? 0) > 0
                Text(ready ? "ready" : "price missing")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundStyle(ready ? HK.ready : HK.running)
            }
        }
    }
    private func usual(_ it: SaudaCompareItem) -> String {
        guard (it.your_paise ?? 0) > 0 else { return "no usual price set" }
        let pk = (it.your_pack ?? "").isEmpty ? "" : " · \(it.your_pack!)"
        return "usual \(SaudaFmt.rupee(Double(it.your_paise!)/100))\(pk)"
    }

    // ════════════════════════════ 2 · PLACE ════════════════════════════
    private var place: some View {
        Group {
            HStack(spacing: 8) {
                inertChip("Both", on: true); inertChip("HE", on: false); inertChip("NCH", on: false); Spacer()
            }
            inertField("Add an item…  (carrot, oil, coke)", system: "magnifyingglass")
            sectionLabel("CHOOSE A VENDOR")
            if let vs = model.settings?.vendors, !vs.isEmpty {
                ForEach(vs) { v in placeVendorRow(v) }
                inertBanner("Place order", system: "paperplane.fill",
                            note: "Placing fires the vendor WhatsApp — opens from the Hukum unlock.")
            } else { stateNote(model.statusLine) }
        }
    }
    private func placeVendorRow(_ v: SaudaSettingsVendor) -> some View {
        let n = model.settings?.items?.filter { $0.default_vendor == v.vendor_key }.count ?? 0
        return card {
            HStack(spacing: 12) {
                monogram(v.name)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(v.name ?? v.vendor_key ?? "—").rowTitle()
                        brandChip(v.brand)
                    }
                    HStack(spacing: 6) {
                        if let f = v.fulfilment, !f.isEmpty { tag(f) }
                        if let p = v.pay, !p.isEmpty { tag(payLabel(p)) }
                    }
                }
                Spacer()
                if n > 0 {
                    Text("\(n)").font(.system(size: 12, weight: .heavy)).foregroundStyle(.black)
                        .padding(.horizontal, 8).padding(.vertical, 3).background(accent, in: Capsule())
                }
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundStyle(HK.textFaint)
            }
        }
    }

    // ════════════════════════════ 3 · PURCHASE DAY ════════════════════════════
    private var purchaseDay: some View {
        Group {
            card {
                HStack {
                    Text("Purchase date").rowTitle()
                    Spacer()
                    DatePicker("", selection: $model.purchaseDate, displayedComponents: .date)
                        .labelsHidden().tint(accent)
                        .onChange(of: model.purchaseDate) { _ in model.reloadPurchaseDay() }
                }
            }
            if let orders = model.purchaseDay?.orders, !orders.isEmpty {
                sectionLabel("VENDOR PURCHASES")
                ForEach(orders) { o in orderCard(o, showStatus: true) }
            } else {
                emptyOrLoading(model.purchaseDay == nil, "No purchase orders for \(model.purchaseYMD) yet. Use Buy list or Place to create one.")
            }
        }
    }

    // ════════════════════════════ 4 · TO PAY ════════════════════════════
    private var toPay: some View {
        Group {
            if let orders = model.payQueue?.orders, !orders.isEmpty {
                let needs = orders.filter { $0.needsBill }
                let ready = orders.filter { !$0.needsBill && ($0.pay ?? "") != "khata_roll" && ($0.payRail ?? "") != "manual" }
                let khata = orders.filter { !$0.needsBill && ($0.pay ?? "") == "khata_roll" }
                let manual = orders.filter { !$0.needsBill && ($0.pay ?? "") != "khata_roll" && ($0.payRail ?? "") == "manual" }
                payGroup("Needs bill / rates", needs, HK.running)
                payGroup("Ready to pay", ready, HK.ready)
                payGroup("Khata / rolling bill", khata, accent)
                payGroup("Manual rail", manual, HK.textDim)
            } else {
                emptyOrLoading(model.payQueue == nil, "Nothing waiting for payment.")
            }
        }
    }
    @ViewBuilder private func payGroup(_ title: String, _ orders: [SaudaOrder], _ col: Color) -> some View {
        if !orders.isEmpty {
            let sub = orders.reduce(0) { $0 + ($1.pay_amount_paise ?? 0) }
            HStack {
                Text(title).font(.system(size: 11, weight: .heavy)).tracking(0.5).foregroundStyle(col)
                Spacer()
                Text("\(orders.count) · \(SaudaFmt.rupee(Double(sub)/100))")
                    .font(.system(size: 11, weight: .heavy)).foregroundStyle(HK.textFaint)
            }.padding(.top, 4)
            ForEach(orders) { o in orderCard(o, showStatus: false, payTone: col) }
        }
    }

    // shared vendor-order card (Purchase day + To pay)
    private func orderCard(_ o: SaudaOrder, showStatus: Bool, payTone: Color? = nil) -> some View {
        card {
            VStack(alignment: .leading, spacing: 9) {
                HStack(spacing: 8) {
                    Text(o.vendor_name ?? o.vendorKey ?? "—").rowTitle()
                    brandChip(o.brand)
                    Spacer()
                    Text(SaudaFmt.rupee(o.amountRupees))
                        .font(.system(size: 17, weight: .heavy, design: .rounded))
                        .foregroundStyle(payTone ?? HK.text)
                }
                HStack(spacing: 6) {
                    if let f = o.fulfilmentLabel, !f.isEmpty { tag(f) }
                    if let p = o.payLabel, !p.isEmpty { tag(p) }
                    Text("\(o.itemCount) item\(o.itemCount == 1 ? "" : "s")").font(.system(size: 11, weight: .semibold)).foregroundStyle(HK.textFaint)
                    Spacer()
                    if let src = o.amount_source { Text(src == "anbar_receipt" ? "received bill" : "ordered basis").font(.system(size: 10, weight: .heavy)).foregroundStyle(HK.textFaint) }
                }
                ForEach(o.lines.prefix(8)) { ln in
                    HStack {
                        Text(ln.item ?? "—").font(.system(size: 13)).foregroundStyle(HK.textDim).lineLimit(1)
                        Spacer()
                        Text(ln.qtyDisplay).font(.system(size: 12)).foregroundStyle(HK.textFaint)
                        if ln.linePaise > 0 {
                            Text(SaudaFmt.rupee(Double(ln.linePaise)/100)).font(.system(size: 12, weight: .semibold)).foregroundStyle(HK.textDim)
                        }
                    }
                }
                if o.itemCount > 8 { Text("+ \(o.itemCount - 8) more").font(.system(size: 11)).foregroundStyle(HK.textFaint) }
                if !showStatus {
                    HStack(spacing: 10) {
                        inertSmall(o.vpa?.isEmpty == false ? "Pay" : (o.bank?.valid == true ? "Bank details" : "No rail"))
                        inertSmall(o.vpa?.isEmpty == false ? "Mark paid" : "Record paid")
                        Spacer()
                    }.padding(.top, 2)
                }
            }
        }
    }

    // ════════════════════════════ 5 · VENDOR DIARY ════════════════════════════
    private var vendorDiary: some View {
        Group {
            if let vs = model.ledger?.vendors, !vs.isEmpty {
                ForEach(vs) { v in vendorLedgerCard(v) }
            } else { emptyOrLoading(model.ledger == nil, "No vendor diary yet. Place an order or save an invoice and it appears here.") }
        }
    }
    private func vendorLedgerCard(_ v: SaudaLedgerVendor) -> some View {
        card {
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 14) {
                        meta("billed", SaudaFmt.rupee(v.billedRupees))
                        meta("paid", SaudaFmt.rupee(v.paidRupees))
                        meta("orders", "\(v.order_count ?? 0)")
                    }.padding(.top, 6)
                    ForEach(v.trail ?? []) { t in trailRow(t) }
                    if (v.trail ?? []).isEmpty { Text("No orders in the last 30 days.").body13() }
                }.padding(.top, 6)
            } label: {
                HStack(spacing: 8) {
                    monogram(v.vendor_name)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(v.vendor_name ?? v.vendorKey ?? "—").rowTitle()
                        Text(v.bankLabel?.isEmpty == false ? v.bankLabel! : (v.vpa?.isEmpty == false ? v.vpa! : "manual only")).body13().lineLimit(1)
                    }
                    Spacer()
                    Text(v.isDue ? SaudaFmt.rupee(v.outstandingRupees) : "clear")
                        .font(.system(size: 14, weight: .heavy)).foregroundStyle(v.isDue ? HK.running : HK.ready)
                }
            }.tint(accent)
        }
    }
    private func trailRow(_ t: SaudaTrailEntry) -> some View {
        let paid = (t.paid_at?.isEmpty == false)
        return HStack(alignment: .top, spacing: 9) {
            Text((t.status ?? "open").uppercased())
                .font(.system(size: 9, weight: .heavy)).foregroundStyle(accent)
                .padding(.horizontal, 6).padding(.vertical, 3).background(accent.opacity(0.16), in: Capsule())
            VStack(alignment: .leading, spacing: 2) {
                Text("\(t.for_date ?? "") · \(t.items ?? 0) item\((t.items ?? 0) == 1 ? "" : "s")").font(.system(size: 13, weight: .semibold)).foregroundStyle(HK.text)
                Text(trailWhen(t)).font(.system(size: 11)).foregroundStyle(HK.textFaint)
            }
            Spacer()
            Text(SaudaFmt.rupee(t.amountRupees)).font(.system(size: 13, weight: .semibold)).foregroundStyle(paid ? HK.ready : HK.textDim)
        }.padding(.vertical, 3)
    }
    private func trailWhen(_ t: SaudaTrailEntry) -> String {
        if t.paid_at?.isEmpty == false { return "paid \(t.paid_at!)\(t.reconciled == true ? " · ✓ bank" : "")" }
        if t.pay_requested_at?.isEmpty == false { return "asked \(t.pay_requested_at!)" }
        if t.ordered_at?.isEmpty == false { return "placed \(t.ordered_at!)" }
        return "open"
    }

    // ════════════════════════════ 6 · HYPERPURE ════════════════════════════
    private var hyperpure: some View {
        Group {
            if let hp = model.hyperpure {
                card {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(hpWindow(hp)).rowTitle()
                            Text(hp.stale == true ? "prices may be a day old" : "scraped \(hp.scraped_at ?? "—")").body13()
                        }
                        Spacer()
                    }
                }
                if hp.stale == true { amberBanner("Prices may be stale — verdicts hidden until the scout refreshes.") }
                if let items = hp.items, !items.isEmpty {
                    let groups: [(String, Color, [SaudaHpItem])] = [
                        ("Cheaper on Hyperpure", HK.ready, items.filter { $0.verdict == "cheaper" && $0.verified == true }),
                        ("About the same", HK.textDim, items.filter { $0.verdict == "same" && $0.verified == true }),
                        ("Dearer on Hyperpure", HK.running, items.filter { $0.verdict == "dearer" && $0.verified == true }),
                        ("Couldn't compare", HK.textFaint, items.filter { $0.verified != true }),
                    ]
                    ForEach(groups, id: \.0) { g in
                        if !g.2.isEmpty {
                            sectionLabel(g.0.uppercased())
                            ForEach(g.2) { hpRow($0, tone: g.1) }
                        }
                    }
                } else { stateNote("No mandi prices yet. The scout refreshes Hyperpure prices each night.") }
            } else { stateNote(model.statusLine) }
        }
    }
    private func hpRow(_ it: SaudaHpItem, tone: Color) -> some View {
        card {
            HStack(spacing: 12) {
                monogram(it.label ?? it.name)
                VStack(alignment: .leading, spacing: 3) {
                    Text(it.label ?? it.name ?? "—").rowTitle()
                    if let m = it.matched, !m.isEmpty { Text(m).body13().lineLimit(1) }
                    Text(hpVerdict(it)).font(.system(size: 12, weight: .semibold)).foregroundStyle(tone)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    if (it.unit_price_paise ?? 0) > 0 {
                        Text("\(SaudaFmt.rupee(Double(it.unit_price_paise!)/100))/\(it.unit ?? "u")").font(.system(size: 13, weight: .heavy)).foregroundStyle(HK.text)
                    }
                    if let pk = it.pack, !pk.isEmpty { Text(pk).font(.system(size: 10)).foregroundStyle(HK.textFaint) }
                    inertSmall("Open ↗")
                }
            }
        }
    }
    private func hpVerdict(_ it: SaudaHpItem) -> String {
        if it.verified != true { return it.no_compare_reason?.isEmpty == false ? it.no_compare_reason! : "couldn't compare" }
        switch it.verdict {
        case "cheaper": return "\(it.pct ?? 0)% cheaper than your \(SaudaFmt.rupee(Double(it.your_unit_paise ?? 0)/100))/\(it.your_unit ?? "u")"
        case "dearer":  return "\(it.pct ?? 0)% dearer than yours"
        default:        return "about the same as yours"
        }
    }
    private func hpWindow(_ hp: SaudaHyperpure) -> String {
        guard let w = hp.window else { return "Hyperpure — tomorrow's basket" }
        if w.open == true, let m = w.mins_to_cutoff, m > 0 { return "Order within \(m/60)h \(m%60)m" }
        return "Cutoff passed — opens for the next day"
    }

    // ════════════════════════════ 7 · COMPARE ════════════════════════════
    private var compare: some View {
        Group {
            if let items = model.compare?.items, !items.isEmpty {
                ForEach(items) { compareRow($0) }
            } else { emptyOrLoading(model.compare == nil, "No price comparison yet. The scout compares platforms each night.") }
        }
    }
    private func compareRow(_ it: SaudaCompareItem) -> some View {
        card {
            HStack(spacing: 12) {
                monogram(it.label)
                VStack(alignment: .leading, spacing: 3) {
                    Text(it.label ?? it.item_key ?? "—").rowTitle()
                    Text(compareResult(it)).font(.system(size: 12, weight: .semibold)).foregroundStyle(compareTone(it))
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text("you pay \(SaudaFmt.rupee(Double(it.your_paise ?? 0)/100))").font(.system(size: 12, weight: .semibold)).foregroundStyle(HK.textDim)
                    if let pk = it.your_pack, !pk.isEmpty { Text(pk).font(.system(size: 10)).foregroundStyle(HK.textFaint) }
                }
            }
        }
    }
    private func compareResult(_ it: SaudaCompareItem) -> String {
        guard let srcs = it.sources, !srcs.isEmpty else { return "no online price yet" }
        if it.beats_baseline == true, let s = it.cheapest_source, (it.save_unit_paise ?? 0) > 0 {
            return "\(s.uppercased()) · save \(SaudaFmt.rupee(Double(it.save_unit_paise!)/100))/\(it.unit ?? "u")"
        }
        return "best online not cheaper than you"
    }
    private func compareTone(_ it: SaudaCompareItem) -> Color {
        if (it.sources ?? []).isEmpty { return HK.textFaint }
        return it.beats_baseline == true ? HK.ready : HK.textDim
    }

    // ════════════════════════════ 8 · SETTINGS ════════════════════════════
    private var settings: some View {
        Group {
            Picker("", selection: $model.settingsSeg) {
                Text("Items").tag(0); Text("Vendors").tag(1)
            }.pickerStyle(.segmented).tint(accent)
            if model.settingsSeg == 0 {
                if let items = model.settings?.items, !items.isEmpty {
                    let priced = items.filter { $0.hasPrice }.count
                    sectionLabel("\(priced) PRICED · \(items.count - priced) TO FILL · \(items.filter { $0.isLive }.count) LIVE")
                    ForEach(items) { settingsItemRow($0) }
                } else { stateNote(model.statusLine) }
            } else {
                if let vs = model.settings?.vendors, !vs.isEmpty {
                    let fill = vs.filter { $0.needsFill }.count
                    sectionLabel("\(vs.count) VENDORS · \(fill) TO FILL")
                    ForEach(vs) { settingsVendorRow($0) }
                } else { stateNote(model.statusLine) }
            }
        }
    }
    private func settingsItemRow(_ it: SaudaItem) -> some View {
        card {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(it.label ?? it.item_code ?? "—").rowTitle()
                        brandChip(it.brand)
                        if it.isFlagged { Text("⚠").font(.system(size: 12)) }
                    }
                    Text(settingsItemSub(it)).body13()
                }
                Spacer()
                if it.isLive {
                    Text("LIVE").font(.system(size: 11, weight: .heavy)).foregroundStyle(accent)
                        .padding(.horizontal, 8).padding(.vertical, 3).background(accent.opacity(0.16), in: Capsule())
                } else if it.hasPrice {
                    Text(SaudaFmt.rupee(it.priceRupees)).font(.system(size: 14, weight: .heavy)).foregroundStyle(HK.text)
                } else {
                    Text("needs price").font(.system(size: 11, weight: .heavy)).foregroundStyle(HK.running)
                }
            }
        }
    }
    private func settingsItemSub(_ it: SaudaItem) -> String {
        var parts: [String] = []
        if let u = it.unit, !u.isEmpty { parts.append(u) }
        parts.append(it.hasVendor ? (it.default_vendor ?? "") : "no vendor")
        if (it.form ?? "") == "defined", let p = it.pack_label, !p.isEmpty { parts.append(p) }
        if it.isFlagged, let n = it.note, !n.isEmpty { parts.append("confirm: \(n)") }
        return parts.joined(separator: " · ")
    }
    private func settingsVendorRow(_ v: SaudaSettingsVendor) -> some View {
        card {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text(v.name ?? v.vendor_key ?? "—").rowTitle()
                    brandChip(v.brand)
                    Spacer()
                    if v.needsFill { Text("to fill").font(.system(size: 11, weight: .heavy)).foregroundStyle(HK.running) }
                }
                Text(settingsVendorSub(v)).body13()
                HStack(spacing: 6) {
                    if let f = v.fulfilment, !f.isEmpty { tag(f) }
                    if let p = v.pay, !p.isEmpty { tag(payLabel(p)) }
                }
            }
        }
    }
    private func settingsVendorSub(_ v: SaudaSettingsVendor) -> String {
        var parts: [String] = []
        parts.append((v.phone?.isEmpty == false) ? "📞 \(v.phone!)" : "no phone")
        if let u = v.primaryVpa, !u.isEmpty { parts.append(u) }
        else if v.bank?.valid == true { parts.append(v.bankLabel ?? "bank") }
        else { parts.append("no rail") }
        return parts.joined(separator: " · ")
    }

    // ════════════════════════════ shared bits (composed from kit tokens) ════════════════════════════
    private func card<Content: View>(@ViewBuilder _ c: () -> Content) -> some View {
        c().padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(HK.card, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(HK.line, lineWidth: 1))
    }
    private func sectionLabel(_ t: String) -> some View {
        HStack { Text(t).font(.system(size: 11, weight: .heavy)).tracking(0.5).foregroundStyle(HK.textFaint); Spacer() }
            .padding(.top, 4)
    }
    private func stateNote(_ t: String) -> some View {
        Text(t).font(.system(size: 14)).foregroundStyle(HK.textFaint)
            .frame(maxWidth: .infinity, alignment: .center).padding(.top, 44)
    }
    // honest, distinct states: nil+refreshing = Loading… · nil+stopped = the error (statusLine) · loaded-empty = sentence
    @ViewBuilder private func emptyOrLoading(_ isNil: Bool, _ empty: String) -> some View {
        if isNil { stateNote(model.isRefreshing ? "Loading…" : model.statusLine) }
        else { stateNote(empty) }
    }
    private func amberBanner(_ t: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 13, weight: .bold)).foregroundStyle(HK.running)
            Text(t).font(.system(size: 12.5, weight: .medium)).foregroundStyle(HK.textDim)
            Spacer()
        }.padding(12).background(HK.running.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
    }
    private func tag(_ t: String) -> some View {
        Text(t).font(.system(size: 10, weight: .heavy)).foregroundStyle(HK.textDim)
            .padding(.horizontal, 7).padding(.vertical, 3).background(HK.bgElev, in: Capsule())
    }
    private func brandChip(_ brand: String?) -> some View {
        let b = (brand ?? "").lowercased()
        let label = b == "he" ? "HE" : b == "nch" ? "NCH" : "BOTH"
        return Text(label).font(.system(size: 9, weight: .heavy)).foregroundStyle(accent)
            .padding(.horizontal, 6).padding(.vertical, 2).background(accent.opacity(0.16), in: Capsule())
    }
    private func monogram(_ s: String?) -> some View {
        let ch = String((s ?? "?").trimmingCharacters(in: .whitespaces).prefix(1)).uppercased()
        return Text(ch.isEmpty ? "•" : ch)
            .font(.system(size: 15, weight: .heavy)).foregroundStyle(accent)
            .frame(width: 38, height: 38).background(accent.opacity(0.14), in: RoundedRectangle(cornerRadius: 11))
    }
    private func meta(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value).font(.system(size: 15, weight: .bold, design: .rounded)).foregroundStyle(HK.text)
            Text(label.uppercased()).font(.system(size: 9, weight: .heavy)).foregroundStyle(HK.textFaint)
        }
    }
    // inert affordances — visible, disabled (mutations are owner-approve, wired by the coordinator)
    private func inertBanner(_ title: String, system: String, note: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Image(systemName: system).font(.system(size: 15, weight: .semibold)).foregroundStyle(accent)
                Text(title).font(.system(size: 15, weight: .bold)).foregroundStyle(HK.text)
                Spacer()
                Image(systemName: "lock.fill").font(.system(size: 11)).foregroundStyle(HK.textFaint)
            }
            Text(note).font(.system(size: 11)).foregroundStyle(HK.textFaint)
        }
        .padding(13).frame(maxWidth: .infinity, alignment: .leading)
        .background(accent.opacity(0.10), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(accent.opacity(0.3), lineWidth: 1))
        .opacity(0.85)
    }
    private func inertChip(_ t: String, on: Bool) -> some View {
        Text(t).font(.system(size: 12, weight: .heavy)).foregroundStyle(on ? .black : HK.textDim)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(on ? accent : HK.card, in: Capsule())
            .overlay(Capsule().stroke(on ? .clear : HK.line, lineWidth: 1))
            .opacity(0.9)
    }
    private func inertField(_ placeholder: String, system: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: system).font(.system(size: 13)).foregroundStyle(HK.textFaint)
            Text(placeholder).font(.system(size: 14)).foregroundStyle(HK.textFaint)
            Spacer()
        }.padding(12).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 12)).opacity(0.8)
    }
    private func inertSmall(_ t: String) -> some View {
        Text(t).font(.system(size: 12, weight: .heavy)).foregroundStyle(HK.textDim)
            .padding(.horizontal, 11).padding(.vertical, 7)
            .background(HK.bgElev, in: Capsule()).opacity(0.8)
    }
    private func payLabel(_ p: String) -> String { p.replacingOccurrences(of: "khata_", with: "khata ") }
}

// Text style helpers (§10 type scale)
private extension Text {
    func rowTitle() -> some View { self.font(.system(size: 15, weight: .semibold)).foregroundStyle(HK.text).lineLimit(1) }
    func body13() -> some View { self.font(.system(size: 13)).foregroundStyle(HK.textDim).lineLimit(2) }
}
