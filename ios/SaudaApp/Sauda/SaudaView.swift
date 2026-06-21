import SwiftUI

// Sauda — the daily-buying chamber. FULL native 1:1 port of the deployed PWA (app-v62.js): all 8 tabs
// AND every interaction — buy basket + requisition, place (fires vendor WhatsApp), decode (paste→Claude→
// review→save-po), to-pay (request-pay / mark-paid / receipt kg / receipt rates), vendor diary direct
// invoice+payment, and the item/vendor master editors. MONEY / OUTWARD-SEND / IRREVERSIBLE actions go
// behind an owner-CONFIRM dialog — mirroring the PWA's own confirms + the owner-approve rule. Money is
// PAISE (Int) ÷100 at display. Accent = sauda gold 0xD4A24C. Composes only from the shared kit.
struct SaudaView: View {
    @StateObject private var model = SaudaAppModel()
    private let accent = Color(hex: 0xD4A24C)
    private var accentLineColor: Color { accent.opacity(0.5) }

    // sheet routing
    @State private var sheet: SaudaSheet?
    // confirm dialogs
    @State private var confirm: SaudaConfirm?

    var body: some View {
        ZStack {
            HK.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                saudaHeader
                tabStrip
                if model.locked {
                    lockedView
                } else {
                    ScrollView {
                        LazyVStack(spacing: 12) { tabContent }
                            .padding(.horizontal, 16).padding(.top, 4).padding(.bottom, 90)
                    }
                    .scrollIndicators(.hidden)
                    .refreshable { await model.refresh() }
                }
            }
            // sticky action bar (Buy list / Place) + toast
            VStack(spacing: 0) {
                Spacer()
                stickyBar.transition(.move(edge: .bottom))
            }
            if let t = model.toast { toastView(t) }
        }
        .task { await model.bootstrap() }
        .navigationTitle("Sauda")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $sheet) { s in sheetContent(s) }
        .confirmationDialog(confirm?.title ?? "", isPresented: confirmBinding, titleVisibility: .visible) {
            if let c = confirm {
                Button(c.cta, role: c.destructive ? .destructive : nil) { Task { await c.action() } }
                Button("Cancel", role: .cancel) {}
            }
        } message: { Text(confirm?.message ?? "") }
        .onChange(of: model.showDecodeReview) { show in if show { sheet = .decodeReview } }
    }

    private var confirmBinding: Binding<Bool> {
        Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } })
    }
    private func ask(_ c: SaudaConfirm) { confirm = c }

    // Place explicit date field ↔ model.placeDate (ymd string). PWA shows the resolved date in a
    // calendar-picker field between Today/Tomorrow.
    private var placeDateBinding: Binding<Date> {
        Binding(
            get: {
                let s = model.placeDate.isEmpty ? model.defaultPurchaseDate : model.placeDate
                return SaudaAppModel.ymd.date(from: s) ?? Date()
            },
            set: { model.placeDate = SaudaAppModel.ymd.string(from: $0) }
        )
    }

    // MARK: per-screen header (PWA: title = active section, subtitle = "Nihaf · Sun, 21 Jun",
    // top-right = settings gear + power/sign-out). Title reflects the selected tab, not the app name.
    private var saudaHeader: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(model.tab.title).font(.system(size: 26, weight: .heavy, design: .rounded)).foregroundStyle(HK.text)
                Text(model.headerSubtitle).font(.system(size: 13, weight: .medium)).foregroundStyle(HK.textDim).lineLimit(1)
            }
            Spacer()
            Button { model.switchTo(.settings) } label: {
                Image(systemName: "gearshape.fill").font(.system(size: 18, weight: .semibold)).foregroundStyle(HK.textDim)
            }.buttonStyle(.plain)
            Button {
                ask(SaudaConfirm(title: "Sign out", message: "Lock Sauda. You'll unlock again from the Diwan home.",
                                 cta: "Sign out", destructive: true, action: { await MainActor.run { model.signOut() } }))
            } label: {
                Image(systemName: "power").font(.system(size: 18, weight: .bold)).foregroundStyle(HK.textDim)
            }.buttonStyle(.plain)
        }
        .padding(.horizontal, 18).padding(.top, 8).padding(.bottom, 12)
    }

    // MARK: tab strip
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
            Button { sheet = .paste } label: {
                actionBanner("Paste a WhatsApp order", system: "doc.on.clipboard",
                             note: "Paste the staff dump or a screenshot — Claude cleans it into a PO.")
            }.buttonStyle(.plain)
            HStack(spacing: 8) {
                segChip("For today", on: model.buyWhen == "today") { model.buyWhen = "today" }
                segChip("For tomorrow", on: model.buyWhen == "tomorrow") { model.buyWhen = "tomorrow" }
                Spacer()
            }
            // green contextual day-explainer strip (PWA buyHint .hp-pill)
            buyDayStrip
            // filter field (PWA #buySearch)
            searchField("Filter items… (paneer, oil, rice)", text: $model.buySearch)
            if let items = model.compare?.items, !items.isEmpty {
                let q = model.buySearch.trimmingCharacters(in: .whitespaces).lowercased()
                let rows = q.isEmpty ? items : items.filter { ($0.label ?? $0.item_key ?? "").lowercased().contains(q) }
                if rows.isEmpty { stateNote("No item matches “\(model.buySearch)”.") }
                else {
                    sectionLabel("WHAT TO BUY")
                    ForEach(rows) { it in buyRow(it) }
                }
            } else { stateNote(model.statusLine) }
        }
    }
    private var buyDayStrip: some View {
        let txt = model.buyWhen == "tomorrow"
            ? "For tomorrow — adds Hyperpure’s cheaper next-day rates"
            : "For today — instant delivery + your morning market trip"
        return HStack(spacing: 8) {
            Image(systemName: "leaf.fill").font(.system(size: 11, weight: .bold)).foregroundStyle(HK.ready)
            Text(txt).font(.system(size: 11.5, weight: .semibold)).foregroundStyle(HK.ready)
            Spacer()
        }.padding(10).background(HK.ready.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
    }
    private func buyRow(_ it: SaudaCompareItem) -> some View {
        let key = it.item_key ?? ""
        let qty = model.buyQty[key] ?? 0
        let priced = it.buyPricePaise > 0
        let unitMissing = (it.your_pack ?? "").isEmpty && (it.pack_label ?? "").isEmpty && (it.unit ?? "").isEmpty
        return card {
            HStack(spacing: 12) {
                thumb(url: it.photoURL, fallback: it.label ?? it.item_key, lowPrice: it.lowPrice)
                VStack(alignment: .leading, spacing: 3) {
                    Text(it.label ?? it.item_key ?? "—").rowTitle()
                    Text(it.buyVendor).font(.system(size: 11, weight: .semibold)).foregroundStyle(HK.textFaint).lineLimit(1)
                    HStack(spacing: 6) {
                        // quantity/pack as a bordered chip (PWA .pk)
                        Text(it.buyPack).font(.system(size: 10, weight: .heavy)).foregroundStyle(HK.textDim)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .overlay(Capsule().stroke(HK.line, lineWidth: 1))
                        Text(priced ? "usual \(SaudaFmt.rupee(Double(it.buyPricePaise)/100))" : "price to confirm")
                            .font(.system(size: 11, weight: .semibold)).foregroundStyle(priced ? HK.textDim : HK.running)
                    }
                    // red "price missing" / green "ready for order" status line (PWA .vd)
                    if !priced || unitMissing {
                        Text("\(unitMissing ? "unit missing · " : "")\(priced ? "" : "price missing")")
                            .font(.system(size: 11, weight: .semibold)).foregroundStyle(HK.error)
                    } else {
                        Text("ready for order").font(.system(size: 11, weight: .semibold)).foregroundStyle(HK.ready)
                    }
                }
                Spacer()
                qtyStepper(qty: qty,
                           dec: { model.bumpBuy(key, -1) },
                           inc: { model.bumpBuy(key, 1) },
                           add: { model.setBuyQty(key, 1) })
            }
        }
    }

    // ════════════════════════════ 2 · PLACE ════════════════════════════
    private var place: some View {
        Group {
            HStack(spacing: 8) {
                segChip("Both", on: model.brand == "both") { model.brand = "both" }
                segChip("HE", on: model.brand == "HE") { model.brand = "HE" }
                segChip("NCH", on: model.brand == "NCH") { model.brand = "NCH" }
                Spacer()
            }
            // place date — Today segment + explicit DATE FIELD (calendar picker) + Tomorrow segment (PWA)
            card {
                HStack(spacing: 8) {
                    segChip("Today", on: model.placeDate == model.ymdIST(0) || model.placeDate.isEmpty) { model.placeDate = model.ymdIST(0) }
                    DatePicker("", selection: placeDateBinding, displayedComponents: .date)
                        .labelsHidden().tint(accent)
                    Spacer()
                    segChip("Tomorrow", on: model.placeDate == model.ymdIST(1)) { model.placeDate = model.ymdIST(1) }
                }
            }
            Button { sheet = .addPlaceItem } label: {
                actionField("Add an item…  (carrot, oil, coke)", system: "magnifyingglass")
            }.buttonStyle(.plain)

            // ── staged order, grouped per vendor (PWA renderOrder) ──
            if !model.placeOrder.isEmpty {
                ForEach(placeVendorGroups, id: \.0) { key, lines in
                    placeBasket(vendorKey: key, lines: lines)
                }
            }

            sectionLabel("CHOOSE A VENDOR — ADD EVERYTHING YOU’RE BUYING FROM THEM")
            if let vs = brandFilteredVendors, !vs.isEmpty {
                ForEach(vs) { v in placeVendorRow(v) }
            } else { stateNote(model.statusLine) }
        }
    }
    // group staged lines by vendorKey, preserving first-seen order (PWA Object.keys(groups))
    private var placeVendorGroups: [(String, [SaudaPlaceLine])] {
        var order: [String] = []
        var map: [String: [SaudaPlaceLine]] = [:]
        for l in model.placeOrder {
            if map[l.vendorKey] == nil { order.append(l.vendorKey) }
            map[l.vendorKey, default: []].append(l)
        }
        return order.map { ($0, map[$0] ?? []) }
    }
    private var brandFilteredVendors: [SaudaSettingsVendor]? {
        guard let vs = model.settings?.vendors else { return nil }
        let f = vs.filter { v in
            guard model.brand != "both" else { return true }
            let b = (v.brand ?? "").lowercased()
            return b.isEmpty || b == "both" || b == model.brand.lowercased()
        }
        return f.isEmpty ? nil : f
    }
    // one vendor basket: header tags + khata banner + editable lines + subtotal (PWA .basket)
    @ViewBuilder private func placeBasket(vendorKey: String, lines: [SaudaPlaceLine]) -> some View {
        let v = model.settings?.vendors?.first { $0.vendor_key == vendorKey }
        let sub = lines.reduce(0.0) { $0 + $1.lineRupees }
        let isKhata = (v?.pay ?? "") == "khata_roll"
        card {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 6) {
                    Text(v?.name ?? (vendorKey == "unassigned" ? "Unassigned" : vendorKey)).rowTitle()
                    let f = v?.fulfilmentText ?? ""; if !f.isEmpty { fulfilTag(f) }
                    let p = v?.payText ?? ""; if !p.isEmpty { tag(p) }
                    Spacer()
                }
                if isKhata { khataBanner }
                ForEach(lines) { ln in placeStagedRow(ln) }
                HStack {
                    Spacer()
                    Text("basket ").font(.system(size: 12, weight: .heavy)).foregroundStyle(HK.textFaint)
                    + Text(SaudaFmt.rupee(sub)).font(.system(size: 13, weight: .heavy)).foregroundStyle(HK.text)
                }
            }
        }
    }
    private var khataBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "arrow.triangle.2.circlepath").font(.system(size: 12, weight: .bold)).foregroundStyle(accent)
            Text("On this trip, clear yesterday’s bill. Today’s items are paid tomorrow.")
                .font(.system(size: 11.5, weight: .medium)).foregroundStyle(HK.textDim)
            Spacer()
        }.padding(10).background(accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
    }
    // editable staged line: calc note + Qty field + ₹rate field + remove (PWA .line)
    private func placeStagedRow(_ ln: SaudaPlaceLine) -> some View {
        let qBind = Binding<String>(get: { model.placeOrder.first { $0.seq == ln.seq }?.qty ?? "" },
                                    set: { model.setPlaceQty(ln.seq, $0) })
        let pBind = Binding<String>(get: { model.placeOrder.first { $0.seq == ln.seq }?.price ?? "" },
                                    set: { model.setPlacePrice(ln.seq, $0) })
        return VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 6) {
                Text(ln.item).font(.system(size: 14, weight: .semibold)).foregroundStyle(HK.text)
                if ln.brand != "both" { brandChip(ln.brand) }
                Spacer()
                Button { model.removePlaceLine(ln.seq) } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 18)).foregroundStyle(HK.textFaint)
                }.buttonStyle(.plain)
            }
            Text(placeCalc(ln)).font(.system(size: 11, weight: .semibold))
                .foregroundStyle(ln.qtyNumber > 0 && (Double(ln.price) ?? 0) > 0 ? HK.ready : HK.running)
            HStack(spacing: 8) {
                HStack(spacing: 4) {
                    Text("Qty").font(.system(size: 10, weight: .heavy)).foregroundStyle(HK.textFaint)
                    TextField("qty", text: qBind)
                        .font(.system(size: 14)).keyboardType(.decimalPad).frame(width: 56)
                        .padding(7).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 9))
                    Text(ln.unit).font(.system(size: 11)).foregroundStyle(HK.textFaint)
                }
                Spacer()
                HStack(spacing: 4) {
                    Text("₹\(ln.unit.isEmpty ? "" : "/\(ln.unit)")\(ln.live ? " · live" : "")").font(.system(size: 10, weight: .heavy)).foregroundStyle(HK.textFaint)
                    TextField(ln.live ? "today’s rate" : "rate", text: pBind)
                        .font(.system(size: 14)).keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 72)
                        .padding(7).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 9))
                }
            }
        }
        .padding(11).background(HK.bgElev.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(HK.line, lineWidth: 1))
    }
    private func placeCalc(_ ln: SaudaPlaceLine) -> String {
        let qn = ln.qtyNumber, pr = Double(ln.price) ?? 0
        let u = ln.unit.isEmpty ? "unit" : ln.unit
        if qn > 0 && pr > 0 {
            return "\(ln.qty) \(u) × \(SaudaFmt.rupee(pr))/\(u) = \(SaudaFmt.rupee(qn * pr))\(ln.live ? " · live rate" : "")"
        }
        if qn > 0 { return "\(ln.qty) \(u) × rate pending\(ln.live ? " · live rate" : "")" }
        return "enter quantity and rate"
    }
    // Flat divider-separated row, NO letter avatar (PWA .vrow): vendor name left, fulfilment + full
    // payment term right-aligned on the same line.
    private func placeVendorRow(_ v: SaudaSettingsVendor) -> some View {
        let staged = model.placeOrder.filter { $0.vendorKey == v.vendor_key }.count
        return Button { sheet = .vendorCompose(v) } label: {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    Text(v.name ?? v.vendor_key ?? "—").rowTitle()
                    Spacer()
                    if !v.fulfilmentText.isEmpty { fulfilTag(v.fulfilmentText) }
                    if !v.payText.isEmpty { Text(v.payText).font(.system(size: 11, weight: .semibold)).foregroundStyle(HK.textDim) }
                    if staged > 0 {
                        Text("\(staged)").font(.system(size: 11, weight: .heavy)).foregroundStyle(.black)
                            .padding(.horizontal, 7).padding(.vertical, 2).background(accent, in: Capsule())
                    } else {
                        Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(HK.textFaint)
                    }
                }
                .padding(.vertical, 13)
                Divider().background(HK.line)
            }
        }.buttonStyle(.plain)
    }
    // blue/indigo fulfilment pill (PWA .tag.f) — distinct from the gold pay/brand tags
    private func fulfilTag(_ t: String) -> some View {
        Text(t).font(.system(size: 10, weight: .heavy)).foregroundStyle(Color(hex: 0x8AA0E6))
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(Color(hex: 0x8AA0E6).opacity(0.16), in: Capsule())
    }

    // ════════════════════════════ 3 · PURCHASE DAY ════════════════════════════
    private var purchaseDay: some View {
        Group {
            // date stepper: ‹ prev | date field (calendar picker) | next › + Today/Tomorrow quick jumps (PWA)
            card {
                VStack(spacing: 10) {
                    HStack(spacing: 10) {
                        Button { model.shiftPurchaseDate(-1) } label: {
                            Image(systemName: "chevron.left").font(.system(size: 14, weight: .heavy)).foregroundStyle(accent)
                                .frame(width: 36, height: 36).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 10))
                        }.buttonStyle(.plain)
                        DatePicker("", selection: $model.purchaseDate, displayedComponents: .date)
                            .labelsHidden().tint(accent)
                            .onChange(of: model.purchaseDate) { _ in model.reloadPurchaseDay() }
                        Spacer()
                        Button { model.shiftPurchaseDate(1) } label: {
                            Image(systemName: "chevron.right").font(.system(size: 14, weight: .heavy)).foregroundStyle(accent)
                                .frame(width: 36, height: 36).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 10))
                        }.buttonStyle(.plain)
                    }
                    HStack(spacing: 8) {
                        segChip("Today", on: model.purchaseYMD == model.ymdIST(0)) { model.setPurchaseYMD(model.ymdIST(0)) }
                        segChip("Tomorrow", on: model.purchaseYMD == model.ymdIST(1)) { model.setPurchaseYMD(model.ymdIST(1)) }
                        Spacer()
                    }
                }
            }
            // relative-day context line (PWA "Tomorrow · Mon 22 Jun")
            HStack {
                Text(model.purchaseRelativeLabel).font(.system(size: 12, weight: .heavy)).foregroundStyle(accent)
                Spacer()
            }
            // search (PWA histSearch)
            searchField("Search this day’s orders…", text: $model.histSearch)
            // brand chips incl. 'Both' (PWA histBrandChips: All/HE/NCH/Both)
            chipRow([("All","all",nil),("HE","HE",nil),("NCH","NCH",nil),("Both","both",nil)],
                    active: model.histBrand) { model.histBrand = $0 }
            let po = filteredPo
            let placed = filteredPlaced
            if let pd = model.purchaseDay, (pd.po_orders?.isEmpty == false || pd.placed_orders?.isEmpty == false) {
                purchaseDaySummary(pd.summary)
                if po.isEmpty && placed.isEmpty {
                    stateNote("No order matches this search/filter for \(model.purchaseYMD).")
                }
                if !po.isEmpty {
                    sectionLabel("PURCHASE INPUTS · \(po.count)")
                    ForEach(po) { o in poInputCard(o) }
                }
                if !placed.isEmpty {
                    sectionLabel("VENDOR ORDERS PLACED · \(placed.count)")
                    ForEach(placed) { o in placedOrderCard(o) }
                }
            } else {
                emptyOrLoading(model.purchaseDay == nil, "No purchase orders for \(model.purchaseYMD) yet. Use Buy list or Place to create one.")
            }
        }
    }
    private func brandPass(_ brand: String?) -> Bool {
        guard model.histBrand != "all" else { return true }
        let b = (brand ?? "").lowercased()
        if model.histBrand == "both" { return b == "both" }   // 'Both' chip = only both-brand rows
        return b == model.histBrand.lowercased() || b == "both" || b.isEmpty
    }
    private var filteredPo: [SaudaPoOrder] {
        let q = model.histSearch.trimmingCharacters(in: .whitespaces).lowercased()
        return (model.purchaseDay?.po_orders ?? []).filter { o in
            guard brandPass(o.brand) else { return false }
            guard !q.isEmpty else { return true }
            let hay = ([o.sender, o.brand].compactMap { $0 } + (o.items ?? []).flatMap { [$0.item, $0.ref] .compactMap { $0 } }).joined(separator: " ").lowercased()
            return hay.contains(q)
        }
    }
    private var filteredPlaced: [SaudaPlacedOrder] {
        let q = model.histSearch.trimmingCharacters(in: .whitespaces).lowercased()
        return (model.purchaseDay?.placed_orders ?? []).filter { o in
            guard brandPass(o.brand) else { return false }
            guard !q.isEmpty else { return true }
            let hay = ([o.vendor_name, o.brand, o.status].compactMap { $0 } + (o.items ?? []).compactMap { $0.item }).joined(separator: " ").lowercased()
            return hay.contains(q)
        }
    }
    private func purchaseDaySummary(_ s: SaudaPurchaseDaySummary?) -> some View {
        HStack(spacing: 0) {
            summaryBox("\(s?.po_items ?? 0)", "items entered")
            summaryBox("\(s?.placed_orders ?? 0)", "vendor purchases")
            summaryBox(SaudaFmt.rupee(Double(s?.expected_amount_paise ?? 0)/100), "placed bill")
        }
    }
    private func summaryBox(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.system(size: 16, weight: .heavy, design: .rounded)).foregroundStyle(HK.text)
            Text(label).font(.system(size: 9, weight: .heavy)).foregroundStyle(HK.textFaint)
        }.frame(maxWidth: .infinity).padding(.vertical, 11)
            .background(HK.card, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(HK.line, lineWidth: 1))
    }
    // decoded purchase INPUT card — lines carry the "from <raw>" truth note (PWA renderPoCard)
    private func poInputCard(_ o: SaudaPoOrder) -> some View {
        card {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    brandChip(o.brand)
                    if let s = o.sender, !s.isEmpty {
                        Text(s).font(.system(size: 10, weight: .heavy)).foregroundStyle(accent)
                            .padding(.horizontal, 6).padding(.vertical, 2).background(accent.opacity(0.16), in: Capsule())
                    }
                    Spacer()
                    Text("\((o.items ?? []).count) item\((o.items ?? []).count == 1 ? "" : "s")").font(.system(size: 11)).foregroundStyle(HK.textFaint)
                }
                ForEach(o.items ?? []) { ln in
                    VStack(alignment: .leading, spacing: 1) {
                        HStack {
                            Text(ln.item ?? "—").font(.system(size: 13)).foregroundStyle(HK.textDim).lineLimit(1)
                            Spacer()
                            Text(ln.qtyDisplay).font(.system(size: 12)).foregroundStyle(HK.textFaint)
                        }
                        if let raw = ln.raw, !raw.isEmpty, raw.lowercased() != (ln.item ?? "").lowercased() {
                            Text("from \(raw)").font(.system(size: 10)).foregroundStyle(HK.textFaint).italic()
                        }
                    }
                }
            }
        }
    }
    private func placedOrderCard(_ o: SaudaPlacedOrder) -> some View {
        card {
            VStack(alignment: .leading, spacing: 9) {
                HStack(spacing: 8) {
                    Text(o.vendor_name ?? o.vendorKey ?? "—").rowTitle()
                    brandChip(o.brand)
                    Spacer()
                    if (o.expected_amount_paise ?? 0) > 0 {
                        Text(SaudaFmt.rupee(o.amountRupees)).font(.system(size: 17, weight: .heavy, design: .rounded)).foregroundStyle(HK.text)
                    }
                }
                HStack(spacing: 6) {
                    if let f = o.fulfilmentLabel ?? o.fulfilment, !f.isEmpty { tag(f) }
                    if let p = o.payLabel ?? o.pay_timing, !p.isEmpty { tag(p) }
                    if let st = o.status, !st.isEmpty { Text(st).font(.system(size: 10, weight: .heavy)).foregroundStyle(HK.textFaint) }
                    Spacer()
                }
                ForEach((o.items ?? []).prefix(8)) { ln in
                    VStack(alignment: .leading, spacing: 1) {
                        HStack {
                            Text(ln.item ?? "—").font(.system(size: 13)).foregroundStyle(HK.textDim).lineLimit(1)
                            Spacer()
                            Text(ln.qtyDisplay).font(.system(size: 12)).foregroundStyle(HK.textFaint)
                            if ln.linePaise > 0 { Text(SaudaFmt.rupee(Double(ln.linePaise)/100)).font(.system(size: 12, weight: .semibold)).foregroundStyle(HK.textDim) }
                        }
                        if let raw = ln.raw, !raw.isEmpty, raw.lowercased() != (ln.item ?? "").lowercased() {
                            Text("from \(raw)").font(.system(size: 10)).foregroundStyle(HK.textFaint).italic()
                        }
                    }
                }
                if (o.items ?? []).count > 8 { Text("+ \((o.items ?? []).count - 8) more").font(.system(size: 11)).foregroundStyle(HK.textFaint) }
            }
        }
    }

    // ════════════════════════════ 4 · TO PAY ════════════════════════════
    private var toPay: some View {
        Group {
            // search + brand chips + status chips always present (PWA filter layer)
            searchField("Search vendor, item, amount...", text: $model.paySearch)
            chipRow([("All","all",nil),("HE","HE",nil),("NCH","NCH",nil),("Both","both",nil)],
                    active: model.payBrand) { model.payBrand = $0 }
            chipRow([("All","all",nil),("Ready","ready",nil),("Needs bill","needsbill",nil),
                     ("Khata","khata",nil),("Manual rail","manual",nil)],
                    active: model.payStatus) { model.payStatus = $0 }
            if let orders = model.payQueue?.orders, !orders.isEmpty {
                let filtered = orders.filter { matchesPayFilter($0) }
                let needs = filtered.filter { $0.needsBill }
                let ready = filtered.filter { !$0.needsBill && ($0.pay ?? "") != "khata_roll" && ($0.payRail ?? "") != "manual" }
                let khata = filtered.filter { !$0.needsBill && ($0.pay ?? "") == "khata_roll" }
                let manual = filtered.filter { !$0.needsBill && ($0.pay ?? "") != "khata_roll" && ($0.payRail ?? "") == "manual" }
                let s = model.payStatus
                if filtered.isEmpty {
                    stateNote("No order matches this filter.")
                } else {
                    if s == "all" || s == "needsbill" { payGroup("Needs bill / rates", needs, HK.running) }
                    if s == "all" || s == "ready" { payGroup("Ready to pay", ready, HK.ready) }
                    if s == "all" || s == "khata" { payGroup("Khata / rolling bill", khata, accent) }
                    if s == "all" || s == "manual" { payGroup("Manual rail", manual, HK.textDim) }
                }
            } else {
                emptyOrLoading(model.payQueue == nil, "Nothing waiting for payment.")
            }
        }
    }
    private func matchesPayFilter(_ o: SaudaOrder) -> Bool {
        // brand
        let b = (o.brand ?? "").lowercased()
        if model.payBrand == "both" { if b != "both" { return false } }
        else if model.payBrand != "all", !(b == model.payBrand.lowercased() || b == "both") { return false }
        // search (vendor / item / amount)
        let q = model.paySearch.trimmingCharacters(in: .whitespaces).lowercased()
        if !q.isEmpty {
            let hay = ([o.vendor_name, o.vendorKey, o.brand].compactMap { $0 }
                       + o.lines.compactMap { $0.item }
                       + [String(o.pay_amount_paise ?? 0), SaudaFmt.rupee(o.amountRupees)]).joined(separator: " ").lowercased()
            if !hay.contains(q) { return false }
        }
        return true
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
                if !showStatus { payActions(o) }
            }
        }
    }
    @ViewBuilder private func payActions(_ o: SaudaOrder) -> some View {
        let needsBill = o.needsBill
        HStack(spacing: 10) {
            if needsBill {
                // receipt / rate entry — no money gate
                actionSmall(o.lines.contains { $0.item?.lowercased().contains("chicken") == true } ? "Record kg / rate" : "Record received", tone: HK.running) {
                    sheet = .receipt(o)
                }
            } else {
                // pay (UPI sheet) or bank/manual record
                if (o.vpa ?? "").isEmpty == false {
                    actionSmall("Pay", tone: accent) { sheet = .pay(o) }
                    actionSmall("Mark paid", tone: HK.ready) {
                        confirmMarkPaid(o, method: "upi")
                    }
                } else if o.bank?.valid == true {
                    actionSmall("Bank details", tone: HK.textDim) { sheet = .manualPay(o) }
                    actionSmall("Record paid", tone: HK.ready) {
                        confirmMarkPaid(o, method: "bank_transfer")
                    }
                } else {
                    actionSmall("Record paid", tone: HK.ready) {
                        confirmMarkPaid(o, method: "manual_bank")
                    }
                }
            }
            Spacer()
        }.padding(.top, 2)
    }
    private func confirmMarkPaid(_ o: SaudaOrder, method: String) {
        let ids = o.ids ?? []
        let amt = o.pay_amount_paise ?? 0
        ask(SaudaConfirm(
            title: "Mark paid — \(o.vendor_name ?? "vendor")",
            message: "Record \(SaudaFmt.rupee(Double(amt)/100)) as paid (\(payMethodLabel(method))). This writes to the vendor ledger.",
            cta: "Mark paid",
            destructive: false,
            action: { await model.markPaid(ids: ids, amountPaise: amt, method: method) }
        ))
    }

    // ════════════════════════════ 5 · VENDOR DIARY ════════════════════════════
    private var vendorDiary: some View {
        Group {
            if let vs = model.ledger?.vendors, !vs.isEmpty {
                searchField("Search vendor, item, invoice... (Afeefa, T-431)", text: $model.diarySearch)
                let filtered = filteredDiary(vs)
                if filtered.isEmpty { stateNote("No vendor matches “\(model.diarySearch)”.") }
                else { ForEach(filtered) { v in vendorLedgerCard(v) } }
            } else { emptyOrLoading(model.ledger == nil, "No vendor diary yet. Place an order or save an invoice and it appears here.") }
        }
    }
    private func filteredDiary(_ vs: [SaudaLedgerVendor]) -> [SaudaLedgerVendor] {
        let q = model.diarySearch.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return vs }
        return vs.filter { v in
            let trailHay = (v.trail ?? []).flatMap { [$0.for_date, $0.status, $0.method, $0.bank_ref].compactMap { $0 } }.joined(separator: " ")
            let hay = ([v.vendor_name, v.cat, v.vpa, v.bankLabel].compactMap { $0 }.joined(separator: " ") + " " + trailHay).lowercased()
            return hay.contains(q)
        }
    }
    private func vendorLedgerCard(_ v: SaudaLedgerVendor) -> some View {
        card {
            VStack(alignment: .leading, spacing: 0) {
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
                actionSmall("Invoice + payment", tone: accent) { sheet = .directPay(v) }
                    .padding(.top, 8)
            }
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
                // green delivery/status pill (PWA .hp-pill) above the instructional banner
                hpDeliveryPill(hp)
                // instructional banner (PWA explainer) — what Open ↗ + tick do
                hpInstructionBanner
                Text(hp.stale == true ? "prices may be a day old" : "prices scraped \(hpAgo(hp.scraped_at))")
                    .font(.system(size: 11)).foregroundStyle(HK.textFaint)
                if hp.stale == true { amberBanner("Prices may be stale — verdicts hidden until the scout refreshes.") }
                // filter field (PWA filter mandi items…)
                searchField("Filter mandi items… (ghee, paneer, oil)", text: $model.hpSearch)
                if let allItems = hp.items, !allItems.isEmpty {
                    let q = model.hpSearch.trimmingCharacters(in: .whitespaces).lowercased()
                    let items = q.isEmpty ? allItems : allItems.filter { (($0.label ?? $0.name ?? "") + " " + ($0.matched ?? "")).lowercased().contains(q) }
                    let groups: [(String, Color, [SaudaHpItem])] = [
                        ("Cheaper on Hyperpure", HK.ready, items.filter { $0.verdict == "cheaper" && $0.verified == true }),
                        ("About the same", HK.textDim, items.filter { $0.verdict == "same" && $0.verified == true }),
                        ("Dearer on Hyperpure", HK.running, items.filter { $0.verdict == "dearer" && $0.verified == true }),
                        ("Couldn't compare", HK.textFaint, items.filter { $0.verified != true }),
                    ]
                    if items.isEmpty { stateNote("No mandi item matches “\(model.hpSearch)”.") }
                    ForEach(groups, id: \.0) { g in
                        if !g.2.isEmpty {
                            hpSectionLabel(g.0.uppercased(), count: g.2.count)
                            ForEach(g.2) { hpRow($0, tone: g.1) }
                        }
                    }
                } else { stateNote("No mandi prices yet. The scout refreshes Hyperpure prices each night.") }
            } else { stateNote(model.statusLine) }
        }
    }
    private func hpDeliveryPill(_ hp: SaudaHyperpure) -> some View {
        let open = hp.window?.open == true
        return HStack(spacing: 8) {
            Image(systemName: "clock.fill").font(.system(size: 11, weight: .bold))
            Text(hpWindow(hp)).font(.system(size: 12, weight: .heavy))
            Spacer()
        }
        .foregroundStyle(open ? HK.ready : HK.running)
        .padding(10).background((open ? HK.ready : HK.running).opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
    }
    private var hpInstructionBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "info.circle.fill").font(.system(size: 13, weight: .bold)).foregroundStyle(accent)
            Text("Each item shows Hyperpure’s price next to your usual. Tap Open ↗ to add it on Hyperpure, then tap ✓ to tick it off. Place & pay in Hyperpure.")
                .font(.system(size: 11.5, weight: .medium)).foregroundStyle(HK.textDim)
            Spacer()
        }.padding(12).background(accent.opacity(0.10), in: RoundedRectangle(cornerRadius: 14))
    }
    private func hpSectionLabel(_ t: String, count: Int) -> some View {
        HStack {
            Text(t).font(.system(size: 11, weight: .heavy)).tracking(0.5).foregroundStyle(HK.textFaint)
            Text("\(count)").font(.system(size: 10, weight: .heavy)).foregroundStyle(accent)
                .padding(.horizontal, 6).padding(.vertical, 1).background(accent.opacity(0.16), in: Capsule())
            Spacer()
        }.padding(.top, 4)
    }
    private func hpRow(_ it: SaudaHpItem, tone: Color) -> some View {
        let k = it.item_key ?? it.id
        let added = model.hpTicked.contains(k)
        return card {
            HStack(spacing: 12) {
                thumb(url: it.photoURL, fallback: it.label ?? it.name, lowPrice: it.lowPrice)
                VStack(alignment: .leading, spacing: 3) {
                    Text(it.label ?? it.name ?? "—").rowTitle()
                    if let m = it.matched, !m.isEmpty { Text(m).body13().lineLimit(1) }
                    // unit price + struck-through usual + pack (PWA .meta)
                    HStack(spacing: 6) {
                        if (it.unit_price_paise ?? 0) > 0 {
                            Text("\(SaudaFmt.rupee(Double(it.unit_price_paise!)/100))/\(it.unit ?? "u")")
                                .font(.system(size: 13, weight: .heavy)).foregroundStyle(HK.text)
                        }
                        if (it.your_unit_paise ?? 0) > 0 {
                            Text("\(SaudaFmt.rupee(Double(it.your_unit_paise!)/100))")
                                .font(.system(size: 11)).foregroundStyle(HK.textFaint).strikethrough()
                        }
                        if let pk = it.pack, !pk.isEmpty { Text("· \(pk)").font(.system(size: 10)).foregroundStyle(HK.textFaint) }
                    }
                    Text(hpVerdict(it)).font(.system(size: 12, weight: .semibold)).foregroundStyle(tone)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 6) {
                    if let url = it.openURL {
                        Link(destination: url) {
                            Text("Open ↗").font(.system(size: 12, weight: .heavy)).foregroundStyle(accent)
                                .padding(.horizontal, 11).padding(.vertical, 6)
                                .overlay(RoundedRectangle(cornerRadius: 9).stroke(accentLineColor, lineWidth: 1))
                        }
                    }
                    // tick-off control (PWA ✓)
                    Button { model.toggleHpTick(k) } label: {
                        Text(added ? "✓ Added" : "✓").font(.system(size: 12, weight: .heavy))
                            .foregroundStyle(added ? .black : HK.ready)
                            .padding(.horizontal, 11).padding(.vertical, 6)
                            .background(added ? HK.ready : HK.ready.opacity(0.14), in: RoundedRectangle(cornerRadius: 9))
                    }.buttonStyle(.plain)
                }
            }
            .opacity(added ? 0.6 : 1)
        }
    }
    private func hpAgo(_ iso: String?) -> String {
        guard let s = iso, !s.isEmpty else { return "—" }
        return String(s.prefix(16)).replacingOccurrences(of: "T", with: " ")
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
                // subtitle line: "N items · your price vs every platform"  +  green "N cheaper online"
                let wins = items.filter { $0.beats_baseline == true }.count
                HStack {
                    Text("\(items.count) items · your price vs every platform")
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(HK.textDim)
                    Spacer()
                    if wins > 0 {
                        Text("\(wins) cheaper online").font(.system(size: 12, weight: .heavy)).foregroundStyle(HK.ready)
                    }
                }
                ForEach(items) { compareRow($0) }
                compareSummary(items)
            } else { emptyOrLoading(model.compare == nil, "No price comparison yet. The scout compares platforms each night.") }
        }
    }
    private func compareRow(_ it: SaudaCompareItem) -> some View {
        let best = it.sources?.first
        return Button { sheet = .compareDetail(it) } label: {
            card {
                HStack(spacing: 12) {
                    thumb(url: it.photoURL, fallback: it.label ?? it.item_key, lowPrice: it.lowPrice)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(it.label ?? it.item_key ?? "—").rowTitle()
                        // platform badge pill + savings, OR best-online price (PWA .src line)
                        if it.beats_baseline == true, let s = it.cheapest_source {
                            HStack(spacing: 6) {
                                platformBadge(s)
                                if (it.save_unit_paise ?? 0) > 0 {
                                    Text("save \(SaudaFmt.rupee(Double(it.save_unit_paise!)/100))/\(it.unit ?? "u")")
                                        .font(.system(size: 12, weight: .heavy)).foregroundStyle(HK.ready)
                                }
                            }
                        } else if let b = best, (b.unit_price_paise ?? 0) > 0 {
                            Text("best online \(SaudaFmt.rupee(Double(b.unit_price_paise!)/100))/\(it.unit ?? "u") · not cheaper")
                                .font(.system(size: 11, weight: .semibold)).foregroundStyle(HK.textFaint)
                        } else {
                            Text("no online price yet").font(.system(size: 11, weight: .semibold)).foregroundStyle(HK.textFaint)
                        }
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("you pay").font(.system(size: 9.5, weight: .semibold)).foregroundStyle(HK.textFaint)
                        Text(SaudaFmt.rupee(Double(it.your_paise ?? 0)/100))
                            .font(.system(size: 16, weight: .heavy, design: .rounded)).foregroundStyle(HK.text)
                        if let pk = it.your_pack, !pk.isEmpty { Text(pk).font(.system(size: 10)).foregroundStyle(HK.textFaint) }
                        Text("compare ›").font(.system(size: 11, weight: .heavy)).foregroundStyle(accent)
                    }
                }
            }
        }.buttonStyle(.plain)
    }
    // bottom platform-breakdown summary card (PWA renderSummary): "N CHEAPER ONLINE · Hyperpure 18 · Zepto 3"
    @ViewBuilder private func compareSummary(_ items: [SaudaCompareItem]) -> some View {
        let wins = items.filter { $0.beats_baseline == true }
        if wins.isEmpty {
            card {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Your prices hold").font(.system(size: 14, weight: .heavy)).foregroundStyle(HK.ready)
                    Text("no platform beats you yet").font(.system(size: 12)).foregroundStyle(HK.textFaint)
                }
            }
        } else {
            card {
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(wins.count) CHEAPER ONLINE").font(.system(size: 14, weight: .heavy)).foregroundStyle(HK.ready)
                    Text(compareBreakdown(wins)).font(.system(size: 12, weight: .semibold)).foregroundStyle(HK.textDim)
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
    private func compareBreakdown(_ wins: [SaudaCompareItem]) -> String {
        var byp: [String: Int] = [:]
        for w in wins { if let s = w.cheapest_source { byp[s, default: 0] += 1 } }
        return byp.sorted { $0.value > $1.value }
            .map { "\(SaudaLabels.sourceLabel($0.key)) \($0.value)" }.joined(separator: " · ")
    }

    // ════════════════════════════ 8 · SETTINGS ════════════════════════════
    private var settings: some View {
        Group {
            Picker("", selection: $model.settingsSeg) {
                Text("Items").tag(0); Text("Vendors").tag(1)
            }.pickerStyle(.segmented).tint(accent)
            // filter field + A4 PDF (PWA settings sub-toolbar)
            HStack(spacing: 8) {
                searchField("Filter items / vendors...", text: $model.setSearch)
                Button { model.openPurchasePdf() } label: {
                    Text("A4 PDF").font(.system(size: 12, weight: .heavy)).foregroundStyle(accent)
                        .padding(.horizontal, 11).padding(.vertical, 10)
                        .overlay(RoundedRectangle(cornerRadius: 11).stroke(accentLineColor, lineWidth: 1))
                }.buttonStyle(.plain)
            }
            if model.settingsSeg == 0 { settingsItemsList } else { settingsVendorsList }
        }
    }
    // ── Items: data-filter chips + stat line + inline-editable rows ──
    @ViewBuilder private var settingsItemsList: some View {
        if let all = model.settings?.items, !all.isEmpty {
            let noVendor = all.filter { !$0.hasVendor }.count
            let noPrice = all.filter { !$0.hasPrice && !$0.isLive }.count
            let confirm = all.filter { $0.isFlagged }.count
            let priced = all.filter { $0.hasPrice }.count
            // data-filter chips (PWA All / No vendor / No price / Confirm)
            chipRow([("All","all",all.count),("No vendor","novendor",noVendor),
                     ("No price","noprice",noPrice),("Confirm","confirm",confirm)],
                    active: model.setChip) { model.setChip = $0 }
            let rows = filteredSettingsItems(all)
            // stat line (PWA: "N shown · N priced · N confirm · N no price · N no vendor")
            settingsStatLine([("\(rows.count) shown", HK.textDim), ("\(priced) priced", HK.ready),
                              ("\(confirm) confirm", HK.running), ("\(noPrice) no price", HK.textFaint),
                              ("\(noVendor) no vendor", HK.running)])
            Button { sheet = .editItem(nil) } label: { actionField("+ Add an item to the master", system: "plus") }
                .buttonStyle(.plain)
            if rows.isEmpty { stateNote("No item matches this filter.") }
            ForEach(rows) { it in settingsItemRow(it) }
        } else { stateNote(model.statusLine) }
    }
    @ViewBuilder private var settingsVendorsList: some View {
        Button { sheet = .editVendor(nil) } label: { actionField("+ Add a vendor", system: "plus") }
            .buttonStyle(.plain)
        if let all = model.settings?.vendors, !all.isEmpty {
            let q = model.setSearch.trimmingCharacters(in: .whitespaces).lowercased()
            let vs = q.isEmpty ? all : all.filter { (($0.name ?? "") + " " + ($0.aliases ?? []).joined(separator: " ")).lowercased().contains(q) }
            let fill = vs.filter { $0.needsFill }.count
            settingsStatLine([("\(vs.count) vendors", HK.textDim), ("\(fill) to fill", HK.running)])
            if vs.isEmpty { stateNote("No vendor matches “\(model.setSearch)”.") }
            ForEach(vs) { v in
                Button { sheet = .editVendor(v) } label: { settingsVendorRow(v) }.buttonStyle(.plain)
            }
        } else { stateNote(model.statusLine) }
    }
    private func filteredSettingsItems(_ all: [SaudaItem]) -> [SaudaItem] {
        let q = model.setSearch.trimmingCharacters(in: .whitespaces).lowercased()
        return all.filter { it in
            switch model.setChip {
            case "novendor": if it.hasVendor { return false }
            case "noprice": if it.hasPrice || it.isLive { return false }
            case "confirm": if !it.isFlagged { return false }
            default: break
            }
            guard !q.isEmpty else { return true }
            let hay = ((it.label ?? "") + " " + (it.aliases ?? []).joined(separator: " ")).lowercased()
            return hay.contains(q)
        }
    }
    private func settingsStatLine(_ parts: [(String, Color)]) -> some View {
        HStack(spacing: 6) {
            ForEach(Array(parts.enumerated()), id: \.offset) { i, p in
                if i > 0 { Text("·").font(.system(size: 11)).foregroundStyle(HK.textFaint) }
                Text(p.0).font(.system(size: 11, weight: .heavy)).foregroundStyle(p.1)
            }
            Spacer()
        }.padding(.vertical, 2)
    }
    // inline-editable item card: ₹ price field + fix button + unit/store (sheet) + SKU/Loose chips (PWA grid)
    private func settingsItemRow(_ it: SaudaItem) -> some View {
        let code = it.item_code ?? ""
        let def = (it.form ?? "") == "defined"
        return card {
            VStack(alignment: .leading, spacing: 9) {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Text(it.label ?? it.item_code ?? "—").rowTitle()
                            brandChip(it.brand)
                            if it.isFlagged { Text("⚠").font(.system(size: 12)).foregroundStyle(HK.running) }
                        }
                        Text(settingsItemSub(it)).body13()
                    }
                    Spacer()
                }
                // inline price row (₹ field + fix), or LIVE toggle (PWA .r1)
                HStack(spacing: 8) {
                    if it.isLive {
                        Button { Task { await model.saveItem(["item_code": code, "price_mode": "fixed"]) } } label: {
                            Text("LIVE").font(.system(size: 11, weight: .heavy)).foregroundStyle(accent)
                                .padding(.horizontal, 10).padding(.vertical, 7).background(accent.opacity(0.16), in: Capsule())
                        }.buttonStyle(.plain)
                    } else {
                        SettingsPriceField(item: it, accent: accent) { rupees in
                            Task { await model.saveItem(["item_code": code, "price_paise": Int((rupees * 100).rounded()), "flagged": 0]) }
                        }
                    }
                    Spacer()
                    Button { sheet = .editItem(it) } label: {
                        Text("edit ›").font(.system(size: 11, weight: .heavy)).foregroundStyle(HK.textDim)
                    }.buttonStyle(.plain)
                }
                // SKU / Loose toggle chips + value subline (PWA .skuline)
                HStack(spacing: 8) {
                    Button { Task { await model.saveItem(["item_code": code, "form": def ? "loose" : "defined"]) } } label: {
                        Text(def ? "SKU" : "Loose").font(.system(size: 10, weight: .heavy)).foregroundStyle(def ? .black : HK.textDim)
                            .padding(.horizontal, 9).padding(.vertical, 4)
                            .background(def ? accent : HK.bgElev, in: Capsule())
                            .overlay(Capsule().stroke(def ? .clear : HK.line, lineWidth: 1))
                    }.buttonStyle(.plain)
                    if def {
                        Text("\((it.brand?.isEmpty == false ? it.brand! + " · " : ""))\(it.pack_label ?? "pack")")
                            .font(.system(size: 11, weight: .semibold)).foregroundStyle(HK.textDim)
                    } else {
                        Text("loose · price is per \(it.unit ?? "unit")").font(.system(size: 11)).foregroundStyle(HK.textFaint)
                    }
                    Spacer()
                }
            }
        }
    }
    private func settingsItemSub(_ it: SaudaItem) -> String {
        var parts: [String] = []
        if let u = it.unit, !u.isEmpty { parts.append(u) }
        parts.append(it.hasVendor ? vendorName(it.default_vendor ?? "") : "no vendor")
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
                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(HK.textFaint)
                }
                Text(settingsVendorSub(v)).body13()
                HStack(spacing: 6) {
                    if !v.fulfilmentText.isEmpty { fulfilTag(v.fulfilmentText) }
                    if !v.payText.isEmpty { tag(v.payText) }
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

    // ════════════════════════════ STICKY BARS (Buy list send · Place) ════════════════════════════
    @ViewBuilder private var stickyBar: some View {
        if model.tab == .buy {
            let keys = model.buyKeys()
            let wl = model.buyWhen == "tomorrow" ? "tomorrow" : "today"
            if keys.isEmpty {
                // PWA: empty bar shows "Add items for today/tomorrow" (disabled prompt)
                stickyButton("Add items for \(wl)", enabled: false) {}
            } else {
                stickyButton("Send \(wl)’s list · \(keys.count) item\(keys.count == 1 ? "" : "s")") {
                    ask(SaudaConfirm(
                        title: "Send buy list",
                        message: "Send \(keys.count) item\(keys.count == 1 ? "" : "s") for \(model.buyWhen) — Sauda finds the cheapest source.",
                        cta: "Send list", destructive: false,
                        action: { await model.sendRequisition() }))
                }
            }
        } else if model.tab == .place {
            // persistent bottom CTA (PWA: always present; disabled until lines staged)
            if model.placeOrder.isEmpty {
                stickyButton("Place order", enabled: false) {}
            } else {
                // PWA updatePlaceBtn: count vendors + sum qty×rate; label shows ₹total when any rate set.
                let vendorCount = Set(model.placeOrder.map { $0.vendorKey }).count
                let total = model.placeOrder.reduce(0.0) { $0 + $1.lineRupees }
                let label = total > 0
                    ? "Place \(vendorCount) order\(vendorCount == 1 ? "" : "s") · \(SaudaFmt.rupee(total))"
                    : "Place \(vendorCount) order\(vendorCount == 1 ? "" : "s") · \(model.placeOrder.count) item\(model.placeOrder.count == 1 ? "" : "s")"
                stickyButton(label) {
                    let blanks = model.placeOrder.filter { $0.qty.trimmingCharacters(in: .whitespaces).isEmpty }.count
                    let noRate = model.placeOrder.filter { $0.pricePaise <= 0 }.count
                    var msg = "Placing fires the vendor WhatsApp for \(model.placeOrder.count) item\(model.placeOrder.count == 1 ? "" : "s") under \(model.placeDate.isEmpty ? model.defaultPurchaseDate : model.placeDate)."
                    if blanks > 0 { msg += " \(blanks) line(s) have no qty — vendor will fill." }
                    if noRate > 0 { msg += " \(noRate) line(s) have no rate (₹0) — vendor will fill the rate." }
                    ask(SaudaConfirm(
                        title: "Place order",
                        message: msg,
                        cta: "Place order", destructive: false,
                        action: { await model.placeStaged() }))
                }
            }
        } else if model.tab == .purchaseDay {
            // sticky "A4 purchase PDF" output (PWA purchase-day primary action)
            stickyButton("A4 purchase PDF", enabled: (model.purchaseDay?.placed_orders?.isEmpty == false)) {
                ask(SaudaConfirm(
                    title: "A4 purchase PDF",
                    message: "Open the printable purchase sheet for \(model.purchaseYMD) — vendor-day lines, bill basis, and Ambar receiving status.",
                    cta: "Open PDF", destructive: false,
                    action: { await MainActor.run { model.openPurchasePdf() } }))
            }
        }
    }
    private func stickyButton(_ title: String, enabled: Bool = true, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Spacer()
                if model.busy { ProgressView().tint(.black) } else { Text(title).font(.system(size: 16, weight: .heavy)) }
                Spacer()
            }
            .foregroundStyle(enabled ? .black : HK.textFaint).padding(.vertical, 16)
            .background(enabled ? accent : HK.card, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(enabled ? .clear : HK.line, lineWidth: 1))
        }
        .buttonStyle(.plain).disabled(model.busy || !enabled)
        .padding(.horizontal, 16).padding(.bottom, 18)
    }

    // ════════════════════════════ SHEETS ════════════════════════════
    @ViewBuilder private func sheetContent(_ s: SaudaSheet) -> some View {
        switch s {
        case .paste:            PasteSheet(model: model, accent: accent) { sheet = nil }
        case .decodeReview:     DecodeReviewSheet(model: model, accent: accent) { sheet = nil; model.showDecodeReview = false }
        case .addPlaceItem:     AddPlaceItemSheet(model: model, accent: accent) { sheet = nil }
        case .vendorCompose(let v): VendorComposeSheet(vendor: v, model: model, accent: accent) { sheet = nil }
        case .pay(let o):       PaySheet(order: o, model: model, accent: accent) { sheet = nil }
        case .manualPay(let o): ManualPaySheet(order: o, model: model, accent: accent) { sheet = nil }
        case .receipt(let o):   ReceiptSheet(order: o, model: model, accent: accent) { sheet = nil }
        case .directPay(let v): DirectPaySheet(vendor: v, model: model, accent: accent) { sheet = nil }
        case .editItem(let it): EditItemSheet(item: it, model: model, accent: accent) { sheet = nil }
        case .editVendor(let v): EditVendorSheet(vendor: v, model: model, accent: accent) { sheet = nil }
        case .compareDetail(let it): CompareDetailSheet(item: it, model: model, accent: accent) { sheet = nil }
        }
    }

    // ════════════════════════════ TOAST ════════════════════════════
    private func toastView(_ t: SaudaToast) -> some View {
        VStack {
            Spacer()
            HStack(spacing: 8) {
                Image(systemName: t.ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                    .foregroundStyle(t.ok ? HK.ready : HK.error)
                Text(t.text).font(.system(size: 14, weight: .semibold)).foregroundStyle(HK.text).lineLimit(2)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(HK.cardHi, in: Capsule())
            .overlay(Capsule().stroke(HK.line, lineWidth: 1))
            .padding(.bottom, 100)
        }
        .transition(.opacity)
        .onAppear { Task { try? await Task.sleep(nanoseconds: 2_600_000_000); model.toast = nil } }
    }

    // ════════════════════════════ shared bits ════════════════════════════
    func card<Content: View>(@ViewBuilder _ c: () -> Content) -> some View {
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

    // Real product photo (PWA .ph background-image) with a letter-avatar fallback and the red
    // "Low Price" corner ribbon when the item carries that flag. One thumbnail, two states.
    private func thumb(url: String?, fallback: String?, lowPrice: Bool = false, size: CGFloat = 46) -> some View {
        let corner: CGFloat = 12
        return ZStack(alignment: .topLeading) {
            if let u = url, let link = URL(string: u) {
                AsyncImage(url: link) { phase in
                    switch phase {
                    case .success(let img):
                        img.resizable().scaledToFill()
                    case .empty:
                        ZStack { accent.opacity(0.08); ProgressView().tint(accent).scaleEffect(0.7) }
                    default:
                        monogramTile(fallback, size: size)
                    }
                }
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: corner))
                .overlay(RoundedRectangle(cornerRadius: corner).stroke(HK.line, lineWidth: 1))
            } else {
                monogramTile(fallback, size: size)
            }
            if lowPrice {
                Text("Low Price").font(.system(size: 7, weight: .heavy)).foregroundStyle(.white)
                    .padding(.horizontal, 4).padding(.vertical, 2)
                    .background(Color(hex: 0xD23B2A))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                    .padding(2)
            }
        }
    }
    private func monogramTile(_ s: String?, size: CGFloat) -> some View {
        let ch = String((s ?? "?").trimmingCharacters(in: .whitespaces).prefix(1)).uppercased()
        return Text(ch.isEmpty ? "•" : ch)
            .font(.system(size: size * 0.4, weight: .heavy)).foregroundStyle(accent)
            .frame(width: size, height: size).background(accent.opacity(0.14), in: RoundedRectangle(cornerRadius: 12))
    }

    // search/filter field — magnifier + placeholder + live-bound text (PWA filter inputs)
    private func searchField(_ placeholder: String, text: Binding<String>) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(accent)
            TextField(placeholder, text: text)
                .font(.system(size: 14)).foregroundStyle(HK.text).autocorrectionDisabled()
            if !text.wrappedValue.isEmpty {
                Button { text.wrappedValue = "" } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 14)).foregroundStyle(HK.textFaint)
                }.buttonStyle(.plain)
            }
        }.padding(11).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 12))
    }

    // a horizontal filter-chip row (brand / status). count optional (Settings shows counts).
    private func chipRow(_ chips: [(label: String, key: String, count: Int?)], active: String, _ pick: @escaping (String) -> Void) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(chips, id: \.key) { c in
                    let on = active == c.key
                    Button { pick(c.key) } label: {
                        HStack(spacing: 5) {
                            Text(c.label).font(.system(size: 12, weight: .heavy))
                            if let n = c.count { Text("\(n)").font(.system(size: 11, weight: .heavy)).foregroundStyle(on ? .black.opacity(0.7) : HK.textFaint) }
                        }
                        .foregroundStyle(on ? .black : HK.textDim)
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(on ? accent : HK.card, in: Capsule())
                        .overlay(Capsule().stroke(on ? .clear : HK.line, lineWidth: 1))
                    }.buttonStyle(.plain)
                }
            }
        }
    }

    // colored platform pill (PWA .src-badge tints) — Hyperpure tan, Zepto purple, etc.
    private func platformBadge(_ source: String?) -> some View {
        let k = (source ?? "").lowercased()
        let tint: Color = {
            switch k {
            case "hyperpure": return Color(hex: 0xC79A4B)
            case "zepto":     return Color(hex: 0x7A3FB0)
            case "blinkit":   return Color(hex: 0xE5B800)
            case "instamart": return Color(hex: 0xF06A1E)
            case "bigbasket": return Color(hex: 0x6BA539)
            default:          return accent
            }
        }()
        return Text(SaudaLabels.sourceLabel(source).uppercased())
            .font(.system(size: 9, weight: .heavy)).foregroundStyle(tint)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(tint.opacity(0.18), in: Capsule())
    }
    private func meta(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value).font(.system(size: 15, weight: .bold, design: .rounded)).foregroundStyle(HK.text)
            Text(label.uppercased()).font(.system(size: 9, weight: .heavy)).foregroundStyle(HK.textFaint)
        }
    }
    private func vendorName(_ key: String) -> String {
        if key.isEmpty { return "no vendor" }
        return model.settings?.vendors?.first { $0.vendor_key == key }?.name ?? key
    }

    // live affordances
    private func actionBanner(_ title: String, system: String, note: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Image(systemName: system).font(.system(size: 15, weight: .semibold)).foregroundStyle(accent)
                Text(title).font(.system(size: 15, weight: .bold)).foregroundStyle(HK.text)
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundStyle(HK.textFaint)
            }
            Text(note).font(.system(size: 11)).foregroundStyle(HK.textFaint)
        }
        .padding(13).frame(maxWidth: .infinity, alignment: .leading)
        .background(accent.opacity(0.10), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(accent.opacity(0.3), lineWidth: 1))
    }
    private func segChip(_ t: String, on: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(t).font(.system(size: 12, weight: .heavy)).foregroundStyle(on ? .black : HK.textDim)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(on ? accent : HK.card, in: Capsule())
                .overlay(Capsule().stroke(on ? .clear : HK.line, lineWidth: 1))
        }.buttonStyle(.plain)
    }
    private func actionField(_ placeholder: String, system: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: system).font(.system(size: 13)).foregroundStyle(accent)
            Text(placeholder).font(.system(size: 14)).foregroundStyle(HK.textDim)
            Spacer()
        }.padding(12).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 12))
    }
    private func actionSmall(_ t: String, tone: Color, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(t).font(.system(size: 12, weight: .heavy)).foregroundStyle(tone)
                .padding(.horizontal, 11).padding(.vertical, 7)
                .background(tone.opacity(0.14), in: Capsule())
        }.buttonStyle(.plain).disabled(model.busy)
    }
    private func qtyStepper(qty: Double, dec: @escaping () -> Void, inc: @escaping () -> Void, add: @escaping () -> Void) -> some View {
        Group {
            if qty <= 0 {
                // square bordered "+" stepper (PWA .add-pill) — not a text "Add" pill
                Button(action: add) {
                    Image(systemName: "plus").font(.system(size: 16, weight: .heavy)).foregroundStyle(accent)
                        .frame(width: 34, height: 34)
                        .background(accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(accentLineColor, lineWidth: 1))
                }.buttonStyle(.plain)
            } else {
                HStack(spacing: 10) {
                    Button(action: dec) { Image(systemName: "minus.circle.fill").font(.system(size: 22)).foregroundStyle(HK.textDim) }.buttonStyle(.plain)
                    Text(qty.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(qty)) : String(qty))
                        .font(.system(size: 15, weight: .heavy, design: .rounded)).foregroundStyle(HK.text).frame(minWidth: 26)
                    Button(action: inc) { Image(systemName: "plus.circle.fill").font(.system(size: 22)).foregroundStyle(accent) }.buttonStyle(.plain)
                }
            }
        }
    }
    private func payMethodLabel(_ m: String) -> String {
        switch m { case "upi": return "UPI"; case "bank_transfer": return "bank transfer"; case "cash": return "cash"; default: return "manual" }
    }
}

// ════════════════════════════ sheet + confirm routing types ════════════════════════════
enum SaudaSheet: Identifiable {
    case paste, decodeReview, addPlaceItem
    case vendorCompose(SaudaSettingsVendor)
    case pay(SaudaOrder), manualPay(SaudaOrder), receipt(SaudaOrder)
    case directPay(SaudaLedgerVendor)
    case editItem(SaudaItem?), editVendor(SaudaSettingsVendor?)
    case compareDetail(SaudaCompareItem)
    var id: String {
        switch self {
        case .paste: return "paste"; case .decodeReview: return "decode"; case .addPlaceItem: return "addItem"
        case .vendorCompose(let v): return "vcompose-\(v.id)"
        case .pay(let o): return "pay-\(o.id)"; case .manualPay(let o): return "manual-\(o.id)"; case .receipt(let o): return "receipt-\(o.id)"
        case .directPay(let v): return "direct-\(v.id)"
        case .editItem(let it): return "edititem-\(it?.id ?? "new")"; case .editVendor(let v): return "editvendor-\(v?.id ?? "new")"
        case .compareDetail(let it): return "cmp-\(it.id)"
        }
    }
}
struct SaudaConfirm {
    let title: String
    let message: String
    let cta: String
    let destructive: Bool
    let action: () async -> Void
}

// Text style helpers (§10 type scale)
extension Text {
    func rowTitle() -> some View { self.font(.system(size: 15, weight: .semibold)).foregroundStyle(HK.text).lineLimit(1) }
    func body13() -> some View { self.font(.system(size: 13)).foregroundStyle(HK.textDim).lineLimit(2) }
}

// ════════════════════════════ Settings inline ₹ price field + fix (PWA .spin + fix) ════════════════════════════
// Local edit buffer so typing never re-renders the whole list; commit on "fix" or return.
struct SettingsPriceField: View {
    let item: SaudaItem
    let accent: Color
    let onCommit: (Double) -> Void
    @State private var text: String = ""
    @FocusState private var focused: Bool
    var body: some View {
        HStack(spacing: 6) {
            Text("₹").font(.system(size: 13, weight: .heavy)).foregroundStyle(HK.textFaint)
            TextField((item.form ?? "") == "defined" ? "pack ₹" : "₹/\(item.unit ?? "unit")", text: $text)
                .font(.system(size: 14, weight: .semibold)).foregroundStyle(HK.text)
                .keyboardType(.decimalPad).frame(width: 80).focused($focused)
            Button { commit() } label: {
                Text("fix").font(.system(size: 11, weight: .heavy)).foregroundStyle(.black)
                    .padding(.horizontal, 10).padding(.vertical, 6).background(accent, in: Capsule())
            }.buttonStyle(.plain)
        }
        .padding(7).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 10))
        .onAppear { text = (item.price_paise ?? 0) > 0 ? String(format: "%g", item.priceRupees) : "" }
    }
    private func commit() {
        focused = false
        let v = Double(text.trimmingCharacters(in: .whitespaces)) ?? 0
        if v > 0 { onCommit(v) }
    }
}

// ════════════════════════════ Compare detail — your price vs every platform (PWA openCompareSheet) ════════════════════════════
struct CompareDetailSheet: View {
    let item: SaudaCompareItem
    @ObservedObject var model: SaudaAppModel
    let accent: Color
    let onClose: () -> Void
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Your price vs each platform. Green means cheaper than you pay now.")
                        .font(.system(size: 12)).foregroundStyle(HK.textFaint)
                    // tier 0 — your current price
                    platformCard(badge: "Your price", badgeTint: HK.textDim, image: nil,
                                 name: "What you pay now", pack: item.your_pack,
                                 unitPaise: item.your_unit_paise, pricePaise: item.your_paise,
                                 kind: "current vendor", best: false, savingNote: nil, url: nil)
                    ForEach(Array((item.sources ?? []).enumerated()), id: \.offset) { _, s in
                        let win = (s.source == item.cheapest_source) && (item.beats_baseline == true)
                        platformCard(badge: SaudaLabels.sourceLabel(s.source), badgeTint: badgeTint(s.source),
                                     image: s.image, name: s.matched ?? item.label, pack: s.pack,
                                     unitPaise: s.unit_price_paise, pricePaise: s.price_paise,
                                     kind: s.source == "hyperpure" ? "next-day" : "instant",
                                     best: win, savingNote: savingNote(s), url: s.url)
                    }
                    if (item.sources ?? []).isEmpty {
                        Text("No online price scraped yet — the scout checks tonight.")
                            .font(.system(size: 13)).foregroundStyle(HK.textFaint)
                            .frame(maxWidth: .infinity).padding(.vertical, 30)
                    }
                }.padding(16)
            }
            .background(HK.bg.ignoresSafeArea())
            .navigationTitle(item.label ?? item.item_key ?? "Compare")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { onClose() }.foregroundStyle(accent) } }
        }
    }
    private func savingNote(_ s: SaudaCompareSource) -> String? {
        guard let yu = item.your_unit_paise, let su = s.unit_price_paise, yu > 0, su > 0 else { return nil }
        return su < yu ? "₹\(Int(Double(yu - su)/100))/\(item.unit ?? "u") cheaper" : "dearer than you"
    }
    private func badgeTint(_ s: String?) -> Color {
        switch (s ?? "").lowercased() {
        case "hyperpure": return Color(hex: 0xC79A4B)
        case "zepto":     return Color(hex: 0x7A3FB0)
        case "blinkit":   return Color(hex: 0xE5B800)
        case "instamart": return Color(hex: 0xF06A1E)
        case "bigbasket": return Color(hex: 0x6BA539)
        default:          return accent
        }
    }
    @ViewBuilder private func platformCard(badge: String, badgeTint: Color, image: String?, name: String?,
                                           pack: String?, unitPaise: Int?, pricePaise: Int?, kind: String,
                                           best: Bool, savingNote: String?, url: String?) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 6) {
                Text(badge.uppercased()).font(.system(size: 9, weight: .heavy)).foregroundStyle(badgeTint)
                    .padding(.horizontal, 7).padding(.vertical, 3).background(badgeTint.opacity(0.18), in: Capsule())
                if best {
                    Text("CHEAPEST").font(.system(size: 9, weight: .heavy)).foregroundStyle(HK.ready)
                        .padding(.horizontal, 7).padding(.vertical, 3).background(HK.ready.opacity(0.18), in: Capsule())
                }
                Spacer()
            }
            HStack(spacing: 12) {
                if let u = image, let link = URL(string: u) {
                    AsyncImage(url: link) { ph in
                        if let img = ph.image { img.resizable().scaledToFill() } else { Color.clear }
                    }.frame(width: 50, height: 50).clipShape(RoundedRectangle(cornerRadius: 12))
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(name ?? "—").font(.system(size: 14, weight: .semibold)).foregroundStyle(HK.text)
                    HStack(spacing: 6) {
                        if let pk = pack, !pk.isEmpty { Text(pk).font(.system(size: 10, weight: .heavy)).foregroundStyle(HK.textDim).padding(.horizontal, 6).padding(.vertical, 2).overlay(Capsule().stroke(HK.line, lineWidth: 1)) }
                        if let up = unitPaise, up > 0 { Text("₹\(Int(Double(up)/100))/\(item.unit ?? "u")").font(.system(size: 10.5)).foregroundStyle(HK.textFaint) }
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 1) {
                    Text(SaudaFmt.rupee(Double(pricePaise ?? 0)/100)).font(.system(size: 17, weight: .heavy, design: .rounded)).foregroundStyle(HK.text)
                    Text(kind).font(.system(size: 9.5)).foregroundStyle(HK.textFaint)
                }
            }
            if let note = savingNote {
                Text(note).font(.system(size: 11, weight: .heavy)).foregroundStyle(note.contains("cheaper") ? HK.ready : HK.textFaint)
            }
            if let u = url, let link = URL(string: u) {
                Link("Open on \(badge) ↗", destination: link).font(.system(size: 12, weight: .heavy)).foregroundStyle(accent)
            }
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(HK.card, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(best ? HK.ready.opacity(0.5) : HK.line, lineWidth: 1))
    }
}
