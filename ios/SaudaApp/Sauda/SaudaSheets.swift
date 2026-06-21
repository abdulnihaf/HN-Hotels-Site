import SwiftUI

// Sauda sheets — every PWA modal ported native. Each owns its working state, calls the model's
// mutation (already confirm-gated where money/outward-send is involved), then dismisses. Shared
// dark-cockpit styling from HK. Money is entered in rupees and converted to paise at the call site.

// MARK: reusable sheet field bits
struct SheetField: View {
    let label: String
    @Binding var text: String
    var placeholder: String = ""
    var keyboard: UIKeyboardType = .default
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label.uppercased()).font(.system(size: 10, weight: .heavy)).tracking(0.5).foregroundStyle(HK.textFaint)
            TextField(placeholder, text: $text)
                .font(.system(size: 16)).foregroundStyle(HK.text)
                .padding(11).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 11))
                .overlay(RoundedRectangle(cornerRadius: 11).stroke(HK.line, lineWidth: 1))
                .keyboardType(keyboard).autocorrectionDisabled()
        }
    }
}
struct SheetScaffold<Content: View>: View {
    let title: String
    let accent: Color
    let onClose: () -> Void
    @ViewBuilder let content: () -> Content
    var body: some View {
        ZStack {
            HK.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                HStack {
                    Text(title).font(.system(size: 20, weight: .heavy)).foregroundStyle(HK.text)
                    Spacer()
                    Button { onClose() } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 24)).foregroundStyle(HK.textFaint) }
                        .buttonStyle(.plain)
                }.padding(.horizontal, 18).padding(.top, 18).padding(.bottom, 8)
                ScrollView { VStack(alignment: .leading, spacing: 13) { content() }.padding(18) }
            }
        }
        .preferredColorScheme(.dark)
    }
}
func sheetPrimary(_ title: String, accent: Color, busy: Bool = false, _ action: @escaping () -> Void) -> some View {
    Button(action: action) {
        HStack { Spacer(); if busy { ProgressView().tint(.black) } else { Text(title).font(.system(size: 16, weight: .heavy)) }; Spacer() }
            .foregroundStyle(.black).padding(.vertical, 15)
            .background(accent, in: RoundedRectangle(cornerRadius: 14))
    }.buttonStyle(.plain).disabled(busy)
}

// ════════════════════════════ PASTE → DECODE ════════════════════════════
struct PasteSheet: View {
    @ObservedObject var model: SaudaAppModel
    let accent: Color
    let onClose: () -> Void
    @State private var brand = "HE"
    @State private var text = ""

    var body: some View {
        SheetScaffold(title: "Paste the WhatsApp order", accent: accent, onClose: onClose) {
            HStack(spacing: 8) {
                brandPick("Hamza Express", "HE"); brandPick("Nawabi Chai House", "NCH"); Spacer()
            }
            Text("Pick the brand, then paste the items from WhatsApp — names and times are not needed. Claude cleans and structures it.")
                .font(.system(size: 12)).foregroundStyle(HK.textFaint)
            TextEditor(text: $text)
                .font(.system(size: 15)).foregroundStyle(HK.text).scrollContentBackground(.hidden)
                .frame(height: 180).padding(8).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(HK.line, lineWidth: 1))
            sheetPrimary(model.decoding ? "Decoding… (a few seconds)" : "Decode", accent: accent, busy: model.decoding) {
                let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !t.isEmpty else { model.toast = SaudaToast(text: "Paste the text first", ok: false); return }
                Task { await model.decode(text: t, image: nil, brand: brand); if model.showDecodeReview { onClose() } }
            }
        }
    }
    private func brandPick(_ label: String, _ b: String) -> some View {
        Button { brand = b } label: {
            Text(label).font(.system(size: 12, weight: .heavy)).foregroundStyle(brand == b ? .black : HK.textDim)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(brand == b ? accent : HK.card, in: Capsule())
                .overlay(Capsule().stroke(brand == b ? .clear : HK.line, lineWidth: 1))
        }.buttonStyle(.plain)
    }
}

// ════════════════════════════ DECODE REVIEW → save-po ════════════════════════════
struct DecodeReviewSheet: View {
    @ObservedObject var model: SaudaAppModel
    let accent: Color
    let onClose: () -> Void

    var body: some View {
        SheetScaffold(title: "Review the order", accent: accent, onClose: onClose) {
            Text("Cleaned and split by brand. Fix a quantity, drop a line with ×, then confirm. Amber means it needs your eye.")
                .font(.system(size: 12)).foregroundStyle(HK.textFaint)
            ForEach(model.decodeNotes, id: \.self) { n in
                HStack(spacing: 6) { Text("⚠ \(n)").font(.system(size: 12, weight: .semibold)).foregroundStyle(HK.running) }
            }
            ForEach(model.decodeOrders.indices, id: \.self) { oi in
                decodeOrderCard(oi)
            }
            sheetPrimary("Confirm & save", accent: accent, busy: model.busy) {
                Task { await model.saveDecodedPO(); if !model.showDecodeReview { onClose() } }
            }
        }
    }
    private func decodeOrderCard(_ oi: Int) -> some View {
        let o = model.decodeOrders[oi]
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(o.brand ?? "").font(.system(size: 14, weight: .heavy)).foregroundStyle(HK.text)
                if let s = o.sender, !s.isEmpty {
                    Text(s).font(.system(size: 10, weight: .heavy)).foregroundStyle(accent)
                        .padding(.horizontal, 6).padding(.vertical, 2).background(accent.opacity(0.16), in: Capsule())
                }
                Spacer()
                Text("\((o.items ?? []).count) items").font(.system(size: 11)).foregroundStyle(HK.textFaint)
            }
            ForEach((o.items ?? []).indices, id: \.self) { ii in decodeItemRow(oi, ii) }
        }
        .padding(13).background(HK.card, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(HK.line, lineWidth: 1))
    }
    private func decodeItemRow(_ oi: Int, _ ii: Int) -> some View {
        let it = model.decodeOrders[oi].items![ii]
        let qtyBinding = Binding<String>(
            get: { model.decodeOrders[oi].items?[ii].qty?.text ?? "" },
            set: { model.decodeOrders[oi].items?[ii].qty = AnyQty($0) }
        )
        return HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(it.item ?? "").font(.system(size: 14, weight: .semibold)).foregroundStyle(HK.text)
                let sub = [ (it.raw != nil && it.raw?.lowercased() != (it.item ?? "").lowercased()) ? "from “\(it.raw!)”" : "", it.category ?? "" ].filter { !$0.isEmpty }.joined(separator: " · ")
                if !sub.isEmpty { Text(sub).font(.system(size: 10)).foregroundStyle(HK.textFaint) }
                if let f = it.flag, !f.isEmpty { Text("⚠ \(f)").font(.system(size: 10, weight: .heavy)).foregroundStyle(HK.running) }
            }
            Spacer()
            TextField("qty", text: qtyBinding)
                .font(.system(size: 14)).multilineTextAlignment(.trailing).frame(width: 54)
                .padding(7).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 9)).keyboardType(.decimalPad)
            Text(it.unit ?? "").font(.system(size: 11)).foregroundStyle(HK.textFaint).frame(width: 28)
            Button { model.decodeOrders[oi].items?.remove(at: ii) } label: {
                Image(systemName: "xmark.circle.fill").font(.system(size: 18)).foregroundStyle(HK.textFaint)
            }.buttonStyle(.plain)
        }
    }
}

// ════════════════════════════ ADD ITEM TO PLACE BASKET ════════════════════════════
struct AddPlaceItemSheet: View {
    @ObservedObject var model: SaudaAppModel
    let accent: Color
    let onClose: () -> Void
    @State private var q = ""

    var body: some View {
        SheetScaffold(title: "Add an item", accent: accent, onClose: onClose) {
            SheetField(label: "Search the master", text: $q, placeholder: "carrot, oil, coke")
            ForEach(filtered) { it in
                Button {
                    model.addPlaceLine(it)
                    model.toast = SaudaToast(text: "Added \(it.label ?? "")", ok: true)
                    onClose()
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(it.label ?? it.item_code ?? "—").font(.system(size: 15, weight: .semibold)).foregroundStyle(HK.text)
                            Text("\(it.unit ?? "") · \(vendorName(it.default_vendor ?? ""))").font(.system(size: 12)).foregroundStyle(HK.textFaint)
                        }
                        Spacer()
                        Image(systemName: "plus.circle.fill").font(.system(size: 20)).foregroundStyle(accent)
                    }
                    .padding(12).background(HK.card, in: RoundedRectangle(cornerRadius: 12))
                }.buttonStyle(.plain)
            }
        }
    }
    private var filtered: [SaudaItem] {
        let items = model.settings?.items ?? []
        let brandFiltered = model.brand == "both" ? items : items.filter { ($0.brand ?? "").lowercased() == model.brand.lowercased() || ($0.brand ?? "").lowercased() == "both" }
        guard !q.isEmpty else { return Array(brandFiltered.prefix(40)) }
        return brandFiltered.filter { ($0.label ?? "").lowercased().contains(q.lowercased()) }
    }
    private func vendorName(_ key: String) -> String {
        if key.isEmpty { return "no vendor" }
        return model.settings?.vendors?.first { $0.vendor_key == key }?.name ?? key
    }
}

// ════════════════════════════ PAY (UPI) ════════════════════════════
struct PaySheet: View {
    let order: SaudaOrder
    @ObservedObject var model: SaudaAppModel
    let accent: Color
    let onClose: () -> Void
    @State private var amount: String = ""
    @State private var requested = false

    private var amountPaise: Int { Int((Double(amount) ?? 0) * 100) }

    var body: some View {
        SheetScaffold(title: "Pay \(order.vendor_name ?? "vendor")", accent: accent, onClose: onClose) {
            Text("₹\(amount.isEmpty ? rupees(order.pay_amount_paise ?? 0) : amount)")
                .font(.system(size: 34, weight: .heavy, design: .rounded)).foregroundStyle(HK.text)
            Text("Open PhonePe at this vendor, type the amount and pay. Then tap “I’ve paid”. Up to ₹1,00,000, no ₹2,000 cap.")
                .font(.system(size: 12)).foregroundStyle(HK.textFaint)
            SheetField(label: "Amount ₹", text: $amount, placeholder: rupees(order.pay_amount_paise ?? 0), keyboard: .decimalPad)
            if let vpa = order.vpa, !vpa.isEmpty {
                if let url = URL(string: payLink("phonepe", vpa, order.vendor_name)) {
                    Link(destination: url) {
                        HStack { Spacer(); Text("Open PhonePe").font(.system(size: 15, weight: .heavy)); Spacer() }
                            .foregroundStyle(.black).padding(.vertical, 13).background(accent, in: RoundedRectangle(cornerRadius: 13))
                    }.simultaneousGesture(TapGesture().onEnded { requestOnce() })
                }
                HStack(spacing: 10) {
                    upiAppLink("Google Pay", "gpay", vpa)
                    upiAppLink("Paytm", "paytm", vpa)
                }
                Button { UIPasteboard.general.string = vpa; model.toast = SaudaToast(text: "UPI ID copied", ok: true) } label: {
                    Text(vpa).font(.system(size: 13, weight: .semibold)).foregroundStyle(accent)
                }.buttonStyle(.plain)
            }
            Divider().background(HK.line)
            // confirm-gated mark-paid
            sheetPrimary("I’ve paid — mark paid", accent: accent, busy: model.busy) {
                let ids = order.ids ?? []
                let amt = amountPaise > 0 ? amountPaise : (order.pay_amount_paise ?? 0)
                Task { await model.markPaid(ids: ids, amountPaise: amt, method: "upi"); onClose() }
            }
        }
        .onAppear { amount = rupees(order.pay_amount_paise ?? 0) }
    }
    private func requestOnce() {
        guard !requested else { return }; requested = true
        let amt = amountPaise > 0 ? amountPaise : (order.pay_amount_paise ?? 0)
        Task { await model.requestPay(ids: order.ids ?? [], amountPaise: amt) }
    }
    private func upiAppLink(_ label: String, _ scheme: String, _ vpa: String) -> some View {
        Group {
            if let url = URL(string: payLink(scheme, vpa, order.vendor_name)) {
                Link(label, destination: url)
                    .font(.system(size: 13, weight: .heavy)).foregroundStyle(HK.textDim)
                    .frame(maxWidth: .infinity).padding(.vertical, 11)
                    .background(HK.card, in: RoundedRectangle(cornerRadius: 11))
                    .overlay(RoundedRectangle(cornerRadius: 11).stroke(HK.line, lineWidth: 1))
            }
        }
    }
    private func payLink(_ scheme: String, _ vpa: String, _ vn: String?) -> String {
        let pn = (vn ?? "Vendor").addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "Vendor"
        let pa = vpa.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? vpa
        let q = "pa=\(pa)&pn=\(pn)&cu=INR&tn=Sauda"
        switch scheme {
        case "phonepe": return "phonepe://pay?\(q)"
        case "gpay":    return "tez://upi/pay?\(q)"
        case "paytm":   return "paytmmp://pay?\(q)"
        default:        return "upi://pay?\(q)"
        }
    }
}

// ════════════════════════════ MANUAL / BANK PAY ════════════════════════════
struct ManualPaySheet: View {
    let order: SaudaOrder
    @ObservedObject var model: SaudaAppModel
    let accent: Color
    let onClose: () -> Void
    @State private var amount: String = ""

    private var amountPaise: Int { Int((Double(amount) ?? 0) * 100) }

    var body: some View {
        SheetScaffold(title: "Record \(order.vendor_name ?? "vendor")", accent: accent, onClose: onClose) {
            Text("₹\(amount.isEmpty ? rupees(order.pay_amount_paise ?? 0) : amount)")
                .font(.system(size: 34, weight: .heavy, design: .rounded)).foregroundStyle(HK.text)
            Text("Transfer to the saved bank account (or pay by cash / Porter), then record it here. Reopening this same payment will not create a duplicate bill.")
                .font(.system(size: 12)).foregroundStyle(HK.textFaint)
            if let b = order.bank, b.valid { bankBox(b) }
            SheetField(label: "Amount ₹", text: $amount, placeholder: rupees(order.pay_amount_paise ?? 0), keyboard: .decimalPad)
            sheetPrimary("Payment done — record paid", accent: accent, busy: model.busy) {
                let ids = order.ids ?? []
                let amt = amountPaise > 0 ? amountPaise : (order.pay_amount_paise ?? 0)
                let method = (order.bank?.valid == true) ? "bank_transfer" : "manual_bank"
                Task { await model.markPaid(ids: ids, amountPaise: amt, method: method); onClose() }
            }
        }
        .onAppear { amount = rupees(order.pay_amount_paise ?? 0) }
    }
    private func bankBox(_ b: SaudaBank) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            bankLine("Name", b.account_name ?? order.vendor_name ?? "")
            bankLine("Account", b.account_number ?? "")
            bankLine("IFSC", b.ifsc ?? "")
            if let br = b.branch, !br.isEmpty { bankLine("Branch", br) }
        }.padding(12).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 12))
    }
    private func bankLine(_ k: String, _ v: String) -> some View {
        HStack { Text(k).font(.system(size: 12, weight: .heavy)).foregroundStyle(HK.textFaint); Spacer()
            Button { UIPasteboard.general.string = v } label: { Text(v).font(.system(size: 13, weight: .semibold)).foregroundStyle(HK.text) }.buttonStyle(.plain) }
    }
}

// ════════════════════════════ RECEIPT (kg / rate entry) ════════════════════════════
struct ReceiptSheet: View {
    let order: SaudaOrder
    @ObservedObject var model: SaudaAppModel
    let accent: Color
    let onClose: () -> Void

    // chicken path: per-line yielded/delivered + a single daily rate
    @State private var dailyRate = ""
    @State private var lineState: [String: (yielded: String, delivered: String, pieces: String, note: String, rate: String)] = [:]
    @State private var receiptRef = ""

    private var isChicken: Bool { order.lines.contains { $0.item?.lowercased().contains("chicken") == true } }

    var body: some View {
        SheetScaffold(title: "Record received — \(order.vendor_name ?? "")", accent: accent, onClose: onClose) {
            if isChicken {
                Text("Chicken: enter yielded kg, delivered kg per line, then the day's rate. Saving the rate updates the bill.")
                    .font(.system(size: 12)).foregroundStyle(HK.textFaint)
                ForEach(order.lines) { ln in chickenLine(ln) }
                SheetField(label: "Daily rate ₹/kg", text: $dailyRate, placeholder: "e.g. 180", keyboard: .decimalPad)
                SheetField(label: "Bill ref (optional)", text: $receiptRef, placeholder: "")
                sheetPrimary("Save yielded/delivered kg", accent: accent, busy: model.busy) {
                    Task { await model.saveChickenKg(lines: chickenLines(withBill: false)); onClose() }
                }
                sheetPrimary("Save MN daily rate + bill", accent: accent, busy: model.busy) {
                    guard (Double(dailyRate) ?? 0) > 0 else { model.toast = SaudaToast(text: "Enter the daily rate", ok: false); return }
                    Task { await model.saveReceiptRates(lines: chickenLines(withBill: true), receiptRef: receiptRef.isEmpty ? nil : receiptRef, isChicken: true); onClose() }
                }
            } else {
                Text("Enter every live rate received (₹/unit). Saving updates the bill amount.")
                    .font(.system(size: 12)).foregroundStyle(HK.textFaint)
                ForEach(order.lines) { ln in rateLine(ln) }
                SheetField(label: "Receipt ref (optional)", text: $receiptRef, placeholder: "")
                sheetPrimary("Save receipt rates", accent: accent, busy: model.busy) {
                    let lines = rateLinesPayload()
                    guard !lines.isEmpty else { model.toast = SaudaToast(text: "Enter every live rate first", ok: false); return }
                    Task { await model.saveReceiptRates(lines: lines, receiptRef: receiptRef.isEmpty ? nil : receiptRef, isChicken: false); onClose() }
                }
            }
        }
    }

    private func st(_ id: String) -> (yielded: String, delivered: String, pieces: String, note: String, rate: String) {
        lineState[id] ?? ("", "", "", "", "")
    }
    private func bind(_ id: String, _ kp: WritableKeyPath<(yielded: String, delivered: String, pieces: String, note: String, rate: String), String>) -> Binding<String> {
        Binding(get: { st(id)[keyPath: kp] }, set: { var s = st(id); s[keyPath: kp] = $0; lineState[id] = s })
    }

    private func chickenLine(_ ln: SaudaLine) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(ln.item ?? "—").font(.system(size: 14, weight: .semibold)).foregroundStyle(HK.text)
            HStack(spacing: 8) {
                SheetField(label: "Yielded kg", text: bind(ln.id, \.yielded), placeholder: "0", keyboard: .decimalPad)
                SheetField(label: "Delivered kg", text: bind(ln.id, \.delivered), placeholder: "0", keyboard: .decimalPad)
            }
        }
        .padding(12).background(HK.card, in: RoundedRectangle(cornerRadius: 12))
    }
    private func chickenLines(withBill: Bool) -> [[String: Any]] {
        order.lines.map { ln -> [String: Any] in
            let s = st(ln.id)
            var d: [String: Any] = ["id": ln.order_id ?? 0, "line_idx": ln.line_idx ?? 0,
                                    "yielded_kg": s.yielded, "delivered_kg": s.delivered, "received_note": s.note]
            if !s.pieces.isEmpty { d["received_pieces"] = s.pieces }
            if withBill { d["daily_rate_paise"] = Int((Double(dailyRate) ?? 0) * 100) }
            return d
        }
    }

    private func rateLine(_ ln: SaudaLine) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(ln.item ?? "—").font(.system(size: 14, weight: .semibold)).foregroundStyle(HK.text)
                Text(ln.qtyDisplay).font(.system(size: 11)).foregroundStyle(HK.textFaint)
            }
            Spacer()
            TextField("₹/unit", text: bind(ln.id, \.rate))
                .font(.system(size: 15)).multilineTextAlignment(.trailing).frame(width: 80)
                .padding(9).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 10)).keyboardType(.decimalPad)
        }
        .padding(12).background(HK.card, in: RoundedRectangle(cornerRadius: 12))
    }
    private func rateLinesPayload() -> [[String: Any]] {
        order.lines.compactMap { ln -> [String: Any]? in
            let r = Double(st(ln.id).rate) ?? 0
            guard r > 0 else { return nil }
            return ["id": ln.order_id ?? 0, "line_idx": ln.line_idx ?? 0, "price_paise": Int(r * 100)]
        }
    }
}

// ════════════════════════════ DIRECT INVOICE + PAYMENT (Vendor diary) ════════════════════════════
struct DirectPaySheet: View {
    let vendor: SaudaLedgerVendor
    @ObservedObject var model: SaudaAppModel
    let accent: Color
    let onClose: () -> Void
    @State private var amount = ""
    @State private var ref = ""
    @State private var date = ""
    @State private var paid = true

    var body: some View {
        SheetScaffold(title: "Invoice + payment", accent: accent, onClose: onClose) {
            Text("For a \(vendor.vendor_name ?? "vendor") bill not already in To pay. Pick the purchase date so a late-entered bill lands on the right business day.")
                .font(.system(size: 12)).foregroundStyle(HK.textFaint)
            HStack(spacing: 8) {
                dateChip("Today", model.ymdIST(0)); dateChip("Yesterday", model.ymdIST(-1)); Spacer()
            }
            SheetField(label: "Purchase date", text: $date, placeholder: model.ymdIST(0))
            SheetField(label: "Invoice amount ₹", text: $amount, placeholder: "0", keyboard: .decimalPad)
            SheetField(label: "Reference / note", text: $ref, placeholder: "optional")
            Toggle(isOn: $paid) { Text("Payment already done").font(.system(size: 14, weight: .semibold)).foregroundStyle(HK.textDim) }.tint(accent)
            sheetPrimary("Save invoice + payment", accent: accent, busy: model.busy) {
                let amt = Int((Double(amount) ?? 0) * 100)
                guard amt > 0 else { model.toast = SaudaToast(text: "Enter an amount", ok: false); return }
                let d = date.isEmpty ? model.ymdIST(0) : date
                Task { await model.directInvoice(vendorKey: vendor.vendorKey ?? "", amountPaise: amt, eventDate: d, ref: ref, paid: paid); onClose() }
            }
        }
        .onAppear { date = model.ymdIST(0) }
    }
    private func dateChip(_ label: String, _ ymd: String) -> some View {
        Button { date = ymd } label: {
            Text(label).font(.system(size: 12, weight: .heavy)).foregroundStyle(date == ymd ? .black : HK.textDim)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(date == ymd ? accent : HK.card, in: Capsule())
                .overlay(Capsule().stroke(date == ymd ? .clear : HK.line, lineWidth: 1))
        }.buttonStyle(.plain)
    }
}

// ════════════════════════════ EDIT ITEM MASTER ════════════════════════════
struct EditItemSheet: View {
    let item: SaudaItem?
    @ObservedObject var model: SaudaAppModel
    let accent: Color
    let onClose: () -> Void
    @State private var label = ""
    @State private var unit = ""
    @State private var price = ""
    @State private var live = false
    @State private var brand = "both"
    @State private var vendorKey = ""
    @State private var form = "loose"
    @State private var packLabel = ""

    var body: some View {
        SheetScaffold(title: item == nil ? "Add an item" : "Edit \(item?.label ?? "item")", accent: accent, onClose: onClose) {
            SheetField(label: "Name", text: $label, placeholder: "Boneless chicken")
            HStack(spacing: 8) {
                segPick("Loose", form == "loose") { form = "loose" }
                segPick("Defined SKU", form == "defined") { form = "defined" }
                Spacer()
            }
            if form == "defined" { SheetField(label: "Pack", text: $packLabel, placeholder: "500 g") }
            SheetField(label: "Unit", text: $unit, placeholder: "kg / pc / ltr")
            Toggle(isOn: $live) { Text("Live price (no fixed rate)").font(.system(size: 14, weight: .semibold)).foregroundStyle(HK.textDim) }.tint(accent)
            if !live { SheetField(label: "Price ₹", text: $price, placeholder: "0", keyboard: .decimalPad) }
            brandRow
            vendorRow
            sheetPrimary("Save item", accent: accent, busy: model.busy) {
                guard !label.trimmingCharacters(in: .whitespaces).isEmpty else { model.toast = SaudaToast(text: "Item name?", ok: false); return }
                let p = Int((Double(price) ?? 0) * 100)
                var fields: [String: Any] = [
                    "item_code": item?.item_code ?? "NEW", "label": label, "form": form,
                    "unit": unit, "brand": brand, "default_vendor": vendorKey,
                    "price_paise": live ? 0 : p, "price_mode": (live || p == 0) ? "live" : "fixed"
                ]
                if form == "defined" { fields["pack_label"] = packLabel }
                Task { await model.saveItem(fields); onClose() }
            }
        }
        .onAppear { hydrate() }
    }
    private var brandRow: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("BRAND").font(.system(size: 10, weight: .heavy)).foregroundStyle(HK.textFaint)
            HStack(spacing: 8) {
                segPick("Both", brand == "both") { brand = "both" }
                segPick("HE", brand == "HE") { brand = "HE" }
                segPick("NCH", brand == "NCH") { brand = "NCH" }
                Spacer()
            }
        }
    }
    private var vendorRow: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("DEFAULT VENDOR").font(.system(size: 10, weight: .heavy)).foregroundStyle(HK.textFaint)
            Menu {
                Button("— none —") { vendorKey = "" }
                ForEach(model.settings?.vendors ?? []) { v in Button(v.name ?? v.vendor_key ?? "") { vendorKey = v.vendor_key ?? "" } }
            } label: {
                HStack { Text(vendorKey.isEmpty ? "Choose a vendor" : (model.settings?.vendors?.first { $0.vendor_key == vendorKey }?.name ?? vendorKey))
                        .foregroundStyle(vendorKey.isEmpty ? HK.textFaint : HK.text)
                    Spacer(); Image(systemName: "chevron.up.chevron.down").font(.system(size: 12)).foregroundStyle(HK.textFaint) }
                    .font(.system(size: 15)).padding(11).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 11))
                    .overlay(RoundedRectangle(cornerRadius: 11).stroke(HK.line, lineWidth: 1))
            }
        }
    }
    private func hydrate() {
        guard let it = item else { return }
        label = it.label ?? ""; unit = it.unit ?? ""; brand = it.brand ?? "both"
        vendorKey = it.default_vendor ?? ""; form = it.form ?? "loose"; packLabel = it.pack_label ?? ""
        live = it.isLive
        if it.hasPrice && !it.isLive { price = String(Int(it.priceRupees)) }
    }
    private func segPick(_ t: String, _ on: Bool, _ a: @escaping () -> Void) -> some View {
        Button(action: a) {
            Text(t).font(.system(size: 12, weight: .heavy)).foregroundStyle(on ? .black : HK.textDim)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(on ? accent : HK.card, in: Capsule())
                .overlay(Capsule().stroke(on ? .clear : HK.line, lineWidth: 1))
        }.buttonStyle(.plain)
    }
}

// ════════════════════════════ EDIT VENDOR MASTER ════════════════════════════
struct EditVendorSheet: View {
    let vendor: SaudaSettingsVendor?
    @ObservedObject var model: SaudaAppModel
    let accent: Color
    let onClose: () -> Void
    @State private var name = ""
    @State private var phone = ""
    @State private var vpa = ""
    @State private var cat = ""
    @State private var brand = "both"
    @State private var fulfilment = "deliver"
    @State private var pay = "per"
    @State private var bankName = ""
    @State private var bankAcc = ""
    @State private var bankIfsc = ""

    var body: some View {
        SheetScaffold(title: vendor == nil ? "Add vendor" : "Edit \(vendor?.name ?? "vendor")", accent: accent, onClose: onClose) {
            SheetField(label: "Vendor name", text: $name, placeholder: "shop / person")
            SheetField(label: "Phone", text: $phone, placeholder: "10 digit mobile", keyboard: .phonePad)
            SheetField(label: "UPI ID", text: $vpa, placeholder: "name@bank")
            SheetField(label: "Supplies", text: $cat, placeholder: "tissues / packaging")
            brandRow
            HStack(spacing: 8) {
                pickMenu("Fulfilment", $fulfilment, ["deliver", "collect"])
                pickMenu("Payment", $pay, ["per", "khata_roll", "khata_weekly", "advance"])
            }
            Text("BANK (for transfer vendors)").font(.system(size: 10, weight: .heavy)).foregroundStyle(HK.textFaint)
            SheetField(label: "Account name", text: $bankName, placeholder: "")
            SheetField(label: "Account number", text: $bankAcc, placeholder: "", keyboard: .numberPad)
            SheetField(label: "IFSC", text: $bankIfsc, placeholder: "")
            sheetPrimary("Save vendor", accent: accent, busy: model.busy) { save() }
        }
        .onAppear { hydrate() }
    }
    private func save() {
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else { model.toast = SaudaToast(text: "Vendor name required", ok: false); return }
        let bankValid = !bankAcc.isEmpty && !bankIfsc.isEmpty
        let phoneOk = phone.filter(\.isNumber).count >= 10
        let vpaOk = vpa.contains("@")
        guard phoneOk || bankValid else { model.toast = SaudaToast(text: "Phone required unless bank vendor", ok: false); return }
        guard vpaOk || bankValid else { model.toast = SaudaToast(text: "UPI or bank account required", ok: false); return }
        var fields: [String: Any] = [
            "vendor_key": vendor?.vendor_key ?? "NEW", "name": name, "phone": phone,
            "vpas": vpaOk ? [vpa] : [], "cat": cat, "brand": brand,
            "fulfilment": fulfilment, "pay": pay
        ]
        if bankValid {
            fields["bank"] = ["account_name": bankName.isEmpty ? name : bankName,
                              "account_number": bankAcc.replacingOccurrences(of: " ", with: ""),
                              "ifsc": bankIfsc.uppercased().replacingOccurrences(of: " ", with: "")]
        }
        Task { await model.saveVendor(fields); onClose() }
    }
    private var brandRow: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("BRAND").font(.system(size: 10, weight: .heavy)).foregroundStyle(HK.textFaint)
            HStack(spacing: 8) {
                seg("Both", brand == "both") { brand = "both" }
                seg("HE", brand == "HE") { brand = "HE" }
                seg("NCH", brand == "NCH") { brand = "NCH" }
                Spacer()
            }
        }
    }
    private func pickMenu(_ title: String, _ sel: Binding<String>, _ opts: [String]) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title.uppercased()).font(.system(size: 10, weight: .heavy)).foregroundStyle(HK.textFaint)
            Menu {
                ForEach(opts, id: \.self) { o in Button(o.replacingOccurrences(of: "khata_", with: "khata ")) { sel.wrappedValue = o } }
            } label: {
                HStack { Text(sel.wrappedValue.replacingOccurrences(of: "khata_", with: "khata ")).foregroundStyle(HK.text)
                    Spacer(); Image(systemName: "chevron.up.chevron.down").font(.system(size: 11)).foregroundStyle(HK.textFaint) }
                    .font(.system(size: 14)).padding(11).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 11))
                    .overlay(RoundedRectangle(cornerRadius: 11).stroke(HK.line, lineWidth: 1))
            }
        }
    }
    private func hydrate() {
        guard let v = vendor else { return }
        name = v.name ?? ""; phone = v.phone ?? ""; vpa = v.primaryVpa ?? ""; cat = v.cat ?? ""
        brand = v.brand ?? "both"; fulfilment = v.fulfilment ?? "deliver"; pay = v.pay ?? "per"
        bankName = v.bank?.account_name ?? ""; bankAcc = v.bank?.account_number ?? ""; bankIfsc = v.bank?.ifsc ?? ""
    }
    private func seg(_ t: String, _ on: Bool, _ a: @escaping () -> Void) -> some View {
        Button(action: a) {
            Text(t).font(.system(size: 12, weight: .heavy)).foregroundStyle(on ? .black : HK.textDim)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(on ? accent : HK.card, in: Capsule())
                .overlay(Capsule().stroke(on ? .clear : HK.line, lineWidth: 1))
        }.buttonStyle(.plain)
    }
}

// shared rupee formatter (paise → integer rupee string)
func rupees(_ paise: Int) -> String {
    let f = NumberFormatter(); f.numberStyle = .decimal; f.maximumFractionDigits = 0
    return f.string(from: NSNumber(value: paise / 100)) ?? "0"
}
