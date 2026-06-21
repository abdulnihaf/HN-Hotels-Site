import Foundation
import Combine
#if canImport(UIKit)
import UIKit
#endif

// Sauda chamber model. ONE shared Diwan token (minted from the seeded PIN — NO per-chamber gate).
// Read-only: loads each tab's live data on demand, honest loading/empty/error states, never a fake
// number. Mutations (place/pay/decode) are inert — the coordinator wires them behind the owner's tap.
@MainActor
final class SaudaAppModel: ObservableObject {

    enum Tab: String, CaseIterable, Identifiable {
        case buy, place, purchaseDay, pay, vendors, hyperpure, compare, settings
        var id: String { rawValue }
        var title: String {
            switch self {
            case .buy: return "Buy list"
            case .place: return "Place"
            case .purchaseDay: return "Purchase day"
            case .pay: return "To pay"
            case .vendors: return "Vendor diary"
            case .hyperpure: return "Hyperpure"
            case .compare: return "Compare"
            case .settings: return "Settings"
            }
        }
    }

    @Published var tab: Tab = .buy
    @Published var statusLine = "Loading…"
    @Published var isRefreshing = false
    @Published var locked = false

    // per-tab data
    @Published var compare: SaudaCompare?            // Buy list + Compare
    @Published var settings: SaudaSettings?          // Place + Settings master
    @Published var payQueue: SaudaOpen?              // To pay (today's open orders)
    @Published var purchaseDay: SaudaPurchaseDay?    // Purchase day (picked date): PO inputs + placed
    @Published var ledger: SaudaVendorLedger?        // Vendor diary
    @Published var hyperpure: SaudaHyperpure?        // Hyperpure feed

    @Published var purchaseDate: Date = Date()       // Purchase-day date picker (drives open&for_date)
    @Published var settingsSeg: Int = 0              // 0 = Items, 1 = Vendors

    // ── interaction working state (mirrors the PWA's S.*) ──
    @Published var buyQty: [String: Double] = [:]    // item_key -> qty  (Buy list basket)
    @Published var buyWhen: String = "today"         // today | tomorrow
    @Published var brand: String = "both"            // both | HE | NCH  (Place add-item filter)
    @Published var placeOrder: [SaudaPlaceLine] = [] // staged lines for the Place tab
    @Published var placeDate: String = ""            // for_date the Place batch goes under
    private var placeSeq: Int = 0                     // monotonic line id (PWA's S.seq)
    @Published var paySearch: String = ""            // To-pay filter text
    @Published var payBrand: String = "all"          // all | HE | NCH
    @Published var histSearch: String = ""           // Purchase-day trail search
    @Published var histBrand: String = "all"         // all | HE | NCH (Purchase-day brand chips)
    @Published var diarySearch: String = ""          // Vendor-diary trail search
    @Published var buySearch: String = ""             // Buy-list item filter (PWA #buySearch)
    @Published var payStatus: String = "all"          // all | ready | needsbill | khata | manual (To-pay status chips)
    @Published var hpSearch: String = ""              // Hyperpure mandi filter (PWA filter mandi items…)
    @Published var hpTicked: Set<String> = []         // Hyperpure 3-state tick-off (added) keyed by item_key
    @Published var setSearch: String = ""             // Settings filter items / vendors
    @Published var setChip: String = "all"            // all | novendor | noprice | confirm (Settings data chips)
    func toggleHpTick(_ key: String) { if hpTicked.contains(key) { hpTicked.remove(key) } else { hpTicked.insert(key) } }

    // header subtitle: "Nihaf · Sun, 21 Jun" (PWA identity line). User name from the seeded PIN.
    var userName: String { "Nihaf" }
    var headerDate: String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = TimeZone(identifier: "Asia/Kolkata")
        f.locale = Locale(identifier: "en_IN")
        f.dateFormat = "EEE, d MMM"
        return f.string(from: Date())
    }
    var headerSubtitle: String { "\(userName) · \(headerDate)" }

    // ── mutation status (honest, never a fake success) ──
    @Published var busy = false
    @Published var toast: SaudaToast?

    private var token: String?
    private var loaded: Set<Tab> = []
    private var pollTask: Task<Void, Never>?
    private let cal = Calendar(identifier: .gregorian)

    static let ymd: DateFormatter = {
        let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = TimeZone(identifier: "Asia/Kolkata"); f.locale = Locale(identifier: "en_IN_POSIX")
        f.dateFormat = "yyyy-MM-dd"; return f
    }()
    var purchaseYMD: String { Self.ymd.string(from: purchaseDate) }

    // MARK: token — shared Diwan token, minted from the seeded PIN (cred "sauda" = 0305)
    private func ensureToken() async throws -> String {
        if let t = token { return t }
        if let cached = KeychainStore.get("sauda-token") { token = cached; return cached }
        guard let pin = KeychainStore.get("owner-pin") else { throw SaudaError.locked }
        let t = try await SaudaClient.shared.auth(pin: pin)
        KeychainStore.set(t, for: "sauda-token")
        token = t
        return t
    }
    private func remint() async throws -> String {
        token = nil
        KeychainStore.clear("sauda-token")
        return try await ensureToken()
    }

    // MARK: lifecycle
    func bootstrap() async {
        guard KeychainStore.get("owner-pin") != nil else {
            locked = true; statusLine = "Unlock from the Diwan home"; return
        }
        // sim/test routing hook (same idea as HUKUM_SEED_PIN) — no effect in production
        let env = ProcessInfo.processInfo.environment
        if let t = env["HUKUM_SAUDA_TAB"], let tt = Tab(rawValue: t) { tab = tt }
        if let d = env["HUKUM_SAUDA_DATE"], let dd = Self.ymd.date(from: d) { purchaseDate = dd }
        await load(tab, force: true)
        startPolling()
    }

    func refresh() async { await load(tab, force: true) }

    // header power icon — drop the chamber token (the owner-pin stays in the keychain for the Diwan).
    func signOut() {
        token = nil
        KeychainStore.clear("sauda-token")
        loaded.removeAll()
        locked = true
        statusLine = "Signed out — unlock from the Diwan home"
    }

    func switchTo(_ t: Tab) {
        tab = t
        if !loaded.contains(t) { Task { await load(t, force: false) } }
        else { updateStatus() }
    }

    // MARK: per-tab loaders (with one auto-remint on 401)
    func load(_ t: Tab, force: Bool) async {
        if !force && loaded.contains(t) { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            try await fetch(t, token: try await ensureToken())
            loaded.insert(t)
            locked = false
            updateStatus()
        } catch SaudaError.unauthorized {
            do { try await fetch(t, token: try await remint()); loaded.insert(t); updateStatus() }
            catch { statusLine = "Sauda: \(error.localizedDescription)" }
        } catch SaudaError.locked {
            locked = true; statusLine = "Unlock from the Diwan home"
        } catch {
            statusLine = "Sauda unreachable: \(error.localizedDescription)"
        }
    }

    private func fetch(_ t: Tab, token: String) async throws {
        switch t {
        case .buy, .compare:
            compare = try await SaudaClient.shared.compare(token: token)
        case .place, .settings:
            settings = try await SaudaClient.shared.settings(token: token)
        case .pay:
            payQueue = try await SaudaClient.shared.open(forDate: nil, token: token)
        case .purchaseDay:
            purchaseDay = try await SaudaClient.shared.purchaseDay(forDate: purchaseYMD, token: token)
        case .vendors:
            ledger = try await SaudaClient.shared.vendorLedger(token: token)
        case .hyperpure:
            hyperpure = try await SaudaClient.shared.hyperpure(token: token)
        }
    }

    func reloadPurchaseDay() { loaded.remove(.purchaseDay); Task { await load(.purchaseDay, force: true) } }

    // Purchase-day date stepper (PWA ‹/› + Today/Tomorrow)
    func shiftPurchaseDate(_ days: Int) {
        if let d = cal.date(byAdding: .day, value: days, to: purchaseDate) { purchaseDate = d; reloadPurchaseDay() }
    }
    func setPurchaseYMD(_ ymd: String) {
        if let d = Self.ymd.date(from: ymd) { purchaseDate = d; reloadPurchaseDay() }
    }
    // relative-day label e.g. "Tomorrow · Mon 22 Jun" / "Today · …" / "Wed · 19 Jun"
    var purchaseRelativeLabel: String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian); f.timeZone = TimeZone(identifier: "Asia/Kolkata")
        f.locale = Locale(identifier: "en_IN"); f.dateFormat = "EEE, d MMM"
        let dateStr = f.string(from: purchaseDate)
        if purchaseYMD == ymdIST(0) { return "Today · \(dateStr)" }
        if purchaseYMD == ymdIST(1) { return "Tomorrow · \(dateStr)" }
        if purchaseYMD == ymdIST(-1) { return "Yesterday · \(dateStr)" }
        return dateStr
    }

    // A4 purchase PDF — the export is generated client-side in the deployed PWA (window.print on an
    // A4-landscape HTML view). Native opens that Purchase-day web view so the owner prints/saves it.
    func openPurchasePdf() {
        guard let url = URL(string: "https://sauda.hnhotels.in/ops/sauda/") else { return }
        #if canImport(UIKit)
        UIApplication.shared.open(url)
        #endif
    }

    // MARK: honest status line per active tab
    private func updateStatus() {
        switch tab {
        case .buy:
            let n = compare?.items?.count ?? 0
            statusLine = n == 0 ? "No items yet" : "\(n) items · need-first buy list"
        case .compare:
            let n = compare?.items?.count ?? 0
            let cheaper = compare?.items?.filter { $0.beats_baseline == true }.count ?? 0
            statusLine = n == 0 ? "No comparison yet" : "\(n) items · \(cheaper) cheaper online"
        case .place:
            let v = settings?.vendors?.count ?? 0
            statusLine = v == 0 ? "No vendors yet" : "\(v) vendors · blank every morning"
        case .settings:
            let c = settings?.counts
            statusLine = "\(c?.items ?? 0) items · \(c?.vendors ?? 0) vendors"
        case .pay:
            let o = payQueue?.orders ?? []
            let total = o.reduce(0) { $0 + ($1.pay_amount_paise ?? 0) }
            statusLine = o.isEmpty ? "Nothing waiting for payment" : "\(o.count) payable · \(SaudaFmt.rupee(Double(total)/100))"
        case .purchaseDay:
            let placed = purchaseDay?.placed_orders ?? []
            let po = purchaseDay?.po_orders ?? []
            let total = purchaseDay?.summary?.expected_amount_paise ?? placed.reduce(0) { $0 + ($1.expected_amount_paise ?? 0) }
            if placed.isEmpty && po.isEmpty { statusLine = "No orders for this day" }
            else { statusLine = "\(placed.count) vendor purchase\(placed.count == 1 ? "" : "s") · \(po.count) input\(po.count == 1 ? "" : "s") · \(SaudaFmt.rupee(Double(total)/100))" }
        case .vendors:
            let v = ledger?.vendors ?? []
            let due = v.reduce(0) { $0 + ($1.outstanding_paise ?? 0) }
            statusLine = v.isEmpty ? "No vendor diary yet" : "\(v.count) vendors · \(SaudaFmt.rupee(Double(due)/100)) due"
        case .hyperpure:
            let n = hyperpure?.items?.count ?? 0
            if hyperpure?.stale == true { statusLine = "\(n) items · prices may be old" }
            else { statusLine = n == 0 ? "No mandi prices yet" : "\(n) mandi items · tomorrow's basket" }
        }
    }

    // MARK: IST business-day helpers (mirror ymdIST / defaultPurchaseDateIST in app-v62.js)
    func ymdIST(_ offsetDays: Int = 0) -> String {
        let d = Date().addingTimeInterval(Double(offsetDays) * 86400)
        return Self.ymd.string(from: d)
    }
    var defaultPurchaseDate: String { ymdIST(buyWhen == "tomorrow" ? 1 : 0) }

    private func toastNow(_ text: String, ok: Bool) { toast = SaudaToast(text: text, ok: ok) }

    // MARK: token exposed for mutations (one auto-remint on unauthorized)
    private func runMutation(_ op: @escaping (String) async throws -> Void) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            try await op(try await ensureToken())
        } catch SaudaError.unauthorized {
            do { try await op(try await remint()) }
            catch { toastNow(mutErr(error), ok: false) }
        } catch {
            toastNow(mutErr(error), ok: false)
        }
    }
    private func mutErr(_ e: Error) -> String { (e as? SaudaError)?.errorDescription ?? "No connection" }

    // ════════════════════════════ BUY LIST · requisition ════════════════════════════
    func buyKeys() -> [String] { buyQty.filter { $0.value > 0 }.map { $0.key } }
    func setBuyQty(_ key: String, _ qty: Double) { if qty > 0 { buyQty[key] = qty } else { buyQty[key] = nil } }
    func bumpBuy(_ key: String, _ delta: Double) { setBuyQty(key, max(0, ((buyQty[key] ?? 0) + delta * 100).rounded() / 100)) }

    func sendRequisition() async {
        let keys = buyKeys(); guard !keys.isEmpty else { return }
        let items = keys.map { SaudaReqItem(item_key: $0, qty: buyQty[$0] ?? 0) }
        let when = buyWhen
        await runMutation { [weak self] token in
            guard let self else { return }
            let r = try await SaudaClient.shared.requisition(items: items, needBy: when, token: token)
            await MainActor.run {
                if r.ok == true {
                    self.toastNow("Sent \(r.count ?? items.count) items for \(r.for_date ?? when) — finding cheapest", ok: true)
                    self.buyQty = [:]
                } else { self.toastNow(r.error ?? "Send failed", ok: false) }
            }
        }
    }

    // ════════════════════════════ PLACE · place ════════════════════════════
    // Staging mirrors the PWA's addLine/vSetQty: a line is pushed with a NEW seq id, qty blank ("")
    // and price seeded from the item master in RUPEES (editable). The SAME item can stage under two
    // vendors. NO bridge from the buy basket exists in the PWA — the owner builds the order here.
    private func priceRupeesSeed(_ paise: Int?) -> String {
        guard let p = paise, p > 0 else { return "" }
        let r = Double(p) / 100
        return r.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(r)) : String(r)
    }
    // add from the master search (PWA addLine) — uses the item's default vendor + seeded price.
    func addPlaceLine(_ it: SaudaItem) {
        if placeDate.isEmpty { placeDate = defaultPurchaseDate }
        placeSeq += 1
        placeOrder.append(SaudaPlaceLine(
            seq: placeSeq, item: it.label ?? "", item_code: it.item_code ?? it.label ?? "",
            qty: "", price: priceRupeesSeed(it.price_paise), unit: it.unit ?? "",
            vendorKey: it.default_vendor ?? "unassigned", brand: it.brand ?? brand, live: it.isLive))
    }
    // vendor-first composer (PWA vSetQty): set qty for an item UNDER a specific vendor; 0 → remove.
    func setVendorQty(vendorKey: String, item: SaudaItem, qty: Double) {
        if placeDate.isEmpty { placeDate = defaultPurchaseDate }
        let name = (item.label ?? "").lowercased()
        let idx = placeOrder.firstIndex { $0.vendorKey == vendorKey && $0.item.lowercased() == name }
        if qty > 0 {
            if let i = idx { placeOrder[i].qty = trimQty(qty) }
            else {
                placeSeq += 1
                placeOrder.append(SaudaPlaceLine(
                    seq: placeSeq, item: item.label ?? "", item_code: item.item_code ?? item.label ?? "",
                    qty: trimQty(qty), price: priceRupeesSeed(item.price_paise), unit: item.unit ?? "",
                    vendorKey: vendorKey, brand: item.brand ?? brand, live: item.isLive))
            }
        } else if let i = idx { placeOrder.remove(at: i) }
    }
    // add a free-text item not in the master, under a vendor (PWA vNewAdd).
    func addVendorFreeItem(vendorKey: String, name: String) {
        let nm = name.trimmingCharacters(in: .whitespaces); guard !nm.isEmpty else { return }
        if placeDate.isEmpty { placeDate = defaultPurchaseDate }
        if placeOrder.contains(where: { $0.vendorKey == vendorKey && $0.item.lowercased() == nm.lowercased() }) { return }
        placeSeq += 1
        placeOrder.append(SaudaPlaceLine(
            seq: placeSeq, item: nm, item_code: "", qty: "1", price: "", unit: "",
            vendorKey: vendorKey, brand: brand, live: false))
    }
    func vendorLineQty(vendorKey: String, itemName: String) -> Double {
        let n = itemName.lowercased()
        return placeOrder.first { $0.vendorKey == vendorKey && $0.item.lowercased() == n }?.qtyNumber ?? 0
    }
    func setPlaceQty(_ seq: Int, _ v: String) { if let i = placeOrder.firstIndex(where: { $0.seq == seq }) { placeOrder[i].qty = v } }
    func setPlacePrice(_ seq: Int, _ v: String) { if let i = placeOrder.firstIndex(where: { $0.seq == seq }) { placeOrder[i].price = v } }
    func removePlaceLine(_ seq: Int) { placeOrder.removeAll { $0.seq == seq } }
    private func trimQty(_ d: Double) -> String { d.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(d)) : String(d) }

    func placeStaged() async {
        guard !placeOrder.isEmpty else { return }
        let forDate = placeDate.isEmpty ? defaultPurchaseDate : placeDate
        let lines: [[String: Any]] = placeOrder.map { l in
            ["item": l.item, "sku": l.item_code.isEmpty ? l.item : l.item_code,
             "qty": l.qty, "unit": l.unit, "vendorKey": l.vendorKey, "brand": l.brand,
             "price_paise": l.pricePaise]
        }
        await runMutation { [weak self] token in
            guard let self else { return }
            let r = try await SaudaClient.shared.place(forDate: forDate, lines: lines, token: token)
            await MainActor.run {
                if r.ok == true {
                    let dup = r.duplicates ?? 0
                    let msg = (r.placed ?? 0) > 0
                        ? "Placed \(r.placed!) vendor order\((r.placed! > 1) ? "s" : "")\(dup > 0 ? " · skipped \(dup) duplicate" : "")"
                        : (dup > 0 ? "Already placed — duplicate skipped" : "No new order placed")
                    self.toastNow("\(msg) · \(r.for_date ?? forDate)", ok: true)
                    self.placeOrder = []
                } else { self.toastNow(r.error ?? "Place failed", ok: false) }
            }
            await self.load(.pay, force: true)
            await self.load(.purchaseDay, force: true)
        }
    }

    // ════════════════════════════ DECODE · paste → Claude → review → save-po ════════════════════════════
    @Published var decodeOrders: [SaudaDecodeOrder] = []
    @Published var decodeNotes: [String] = []
    @Published var decoding = false
    @Published var showDecodeReview = false

    func decode(text: String?, image: String?, brand: String) async {
        guard !decoding else { return }
        decoding = true; defer { decoding = false }
        do {
            let token = try await ensureToken()
            let r = try await SaudaClient.shared.decode(text: text, image: image, brand: brand, token: token)
            if r.ok == true {
                decodeOrders = r.orders ?? []
                decodeNotes = r.notes ?? []
                showDecodeReview = true
            } else { toastNow(r.detail ?? r.error ?? "Decode failed", ok: false) }
        } catch { toastNow(mutErr(error), ok: false) }
    }

    func saveDecodedPO() async {
        let orders = decodeOrders.filter { !($0.items ?? []).isEmpty }
        guard !orders.isEmpty else { toastNow("Nothing to save", ok: false); return }
        let payload: [[String: Any]] = orders.map { o in
            ["brand": o.brand ?? "", "sender": o.sender ?? "",
             "items": (o.items ?? []).map { it -> [String: Any] in
                var d: [String: Any] = ["item": it.item ?? "", "qty": it.qty?.text ?? "", "unit": it.unit ?? ""]
                if let r = it.raw { d["raw"] = r }
                if let c = it.category { d["category"] = c }
                return d
             }]
        }
        let when = buyWhen
        await runMutation { [weak self] token in
            guard let self else { return }
            let r = try await SaudaClient.shared.savePO(orders: payload, needBy: when, token: token)
            await MainActor.run {
                if r.ok == true {
                    self.toastNow("Recorded \(r.items ?? 0) items · \(r.orders ?? 0) order\((r.orders ?? 0) > 1 ? "s" : "") for \(r.for_date ?? "tomorrow")", ok: true)
                    self.decodeOrders = []; self.decodeNotes = []; self.showDecodeReview = false
                } else { self.toastNow(r.error ?? "Save failed", ok: false) }
            }
        }
    }

    // ════════════════════════════ TO PAY · request-pay / mark-paid / receipt / prices ════════════════════════════
    func requestPay(ids: [Int], amountPaise: Int) async {
        guard !ids.isEmpty, amountPaise > 0 else { return }
        await runMutation { token in _ = try await SaudaClient.shared.requestPay(ids: ids, amountPaise: amountPaise, token: token) }
    }

    func markPaid(ids: [Int], amountPaise: Int, method: String) async {
        guard !ids.isEmpty, amountPaise > 0 else { return }
        await runMutation { [weak self] token in
            guard let self else { return }
            let r = try await SaudaClient.shared.markPaid(ids: ids, amountPaise: amountPaise, method: method, token: token)
            await MainActor.run {
                if r.ok == true { self.toastNow(r.reconciled == true ? "✓ Bank-confirmed paid" : "Marked paid · bank not seen yet", ok: true) }
                else { self.toastNow(r.error ?? "Failed", ok: false) }
            }
            await self.load(.pay, force: true)
        }
    }

    func saveChickenKg(lines: [[String: Any]]) async {
        await runMutation { [weak self] token in
            guard let self else { return }
            let r = try await SaudaClient.shared.purchaseReceipt(lines: lines, token: token)
            await MainActor.run {
                if r.ok == true { self.toastNow("Chicken kg saved", ok: true) }
                else { self.toastNow(r.error ?? "receipt save failed", ok: false) }
            }
            await self.load(.pay, force: true)
        }
    }

    func saveReceiptRates(lines: [[String: Any]], receiptRef: String?, isChicken: Bool) async {
        await runMutation { [weak self] token in
            guard let self else { return }
            let r = try await SaudaClient.shared.purchasePrices(lines: lines, receiptRef: receiptRef, token: token)
            await MainActor.run {
                if r.ok == true { self.toastNow(isChicken ? "MN bill saved · amount updated" : "Receipt rates saved · bill updated", ok: true) }
                else { self.toastNow(r.error ?? "rate save failed", ok: false) }
            }
            await self.load(.pay, force: true)
        }
    }

    // ════════════════════════════ VENDOR DIARY · vendor-event (invoice + payment) ════════════════════════════
    func directInvoice(vendorKey: String, amountPaise: Int, eventDate: String, ref: String, paid: Bool) async {
        guard amountPaise > 0 else { toastNow("Enter an amount", ok: false); return }
        let note = ref.isEmpty ? "" : "Invoice \(ref)"
        var events: [[String: Any]] = [
            ["vendorKey": vendorKey, "event_type": "bill", "event_date": eventDate,
             "amount_paise": amountPaise, "ref": ref, "note": note, "source": "manual_ui"]
        ]
        if paid {
            events.append(["vendorKey": vendorKey, "event_type": "payment", "amount_paise": amountPaise,
                           "ref": ref, "note": note.isEmpty ? "Manual payment" : note, "source": "manual_ui"])
        }
        await runMutation { [weak self] token in
            guard let self else { return }
            let r = try await SaudaClient.shared.vendorEvent(vendorKey: vendorKey, events: events, token: token)
            await MainActor.run {
                if r.ok == true {
                    let payEvt = r.events?.first { $0.event_type == "payment" }
                    var msg = "Invoice saved"
                    if paid { msg += (payEvt?.reconciled == true) ? " · payment bank-confirmed" : " · payment recorded" }
                    self.toastNow(msg, ok: true)
                } else { self.toastNow(r.error ?? "Failed", ok: false) }
            }
            await self.load(.vendors, force: true)
        }
    }

    // ════════════════════════════ SETTINGS · settings-item / settings-vendor ════════════════════════════
    func saveItem(_ fields: [String: Any]) async {
        await runMutation { [weak self] token in
            guard let self else { return }
            let r = try await SaudaClient.shared.settingsItem(fields, token: token)
            await MainActor.run {
                if r.ok == true { self.toastNow("saved ✓", ok: true) } else { self.toastNow(r.error ?? "save failed", ok: false) }
            }
            await self.load(.settings, force: true)
        }
    }
    func saveVendor(_ fields: [String: Any]) async {
        await runMutation { [weak self] token in
            guard let self else { return }
            let r = try await SaudaClient.shared.settingsVendor(fields, token: token)
            await MainActor.run {
                if r.ok == true { self.toastNow("saved ✓", ok: true) } else { self.toastNow(r.error ?? "save failed", ok: false) }
            }
            await self.load(.settings, force: true)
        }
    }

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60_000_000_000)
                await self?.refresh()
            }
        }
    }
    deinit { pollTask?.cancel() }
}
