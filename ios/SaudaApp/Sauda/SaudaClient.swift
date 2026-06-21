import Foundation

// Sauda API client — https://sauda.hnhotels.in/api/sauda. Shared Diwan token via header
// x-darbar-token (minted once with the seeded PIN; the coordinator owns the unlock). READ-ONLY:
// the ONLY POST is the auth handshake — every other call is a GET. Mutations (place/pay/decode)
// are owner-approve and wired by the coordinator, never here.
actor SaudaClient {
    static let shared = SaudaClient()
    private let base = "https://sauda.hnhotels.in/api/sauda"
    private let decoder = JSONDecoder()

    // POST ?action=auth {pin} → { token }
    func auth(pin: String) async throws -> String {
        guard let url = URL(string: "\(base)?action=auth") else { throw SaudaError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 12
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["pin": pin])
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let h = resp as? HTTPURLResponse, !(200..<300).contains(h.statusCode) {
            throw SaudaError.unauthorized
        }
        let a = try decoder.decode(SaudaAuthResponse.self, from: data)
        guard let t = a.token, !t.isEmpty else { throw SaudaError.unauthorized }
        return t
    }

    func settings(token: String) async throws -> SaudaSettings {
        try await get("settings", token: token)
    }
    func open(forDate: String?, token: String) async throws -> SaudaOpen {
        var q: [String: String] = [:]
        if let d = forDate, !d.isEmpty { q["for_date"] = d }
        return try await get("open", query: q, token: token)
    }
    func compare(token: String) async throws -> SaudaCompare {
        try await get("compare", token: token)
    }
    func vendorLedger(token: String) async throws -> SaudaVendorLedger {
        try await get("vendor-ledger", token: token)
    }
    func hyperpure(token: String) async throws -> SaudaHyperpure {
        try await get("hyperpure-feed", token: token)
    }

    // ── MUTATIONS — exact action + payload mirrored from the deployed PWA (app-v62.js).
    //    Every one is owner-CONFIRM gated in the View before it is ever called. After a
    //    success the View refreshes the affected screen. Each returns the raw decoded
    //    response so the View can show the PWA's own toast text. ──

    // POST ?action=requisition {items:[{item_key,qty}], need_by} — Buy list "Send today's list".
    func requisition(items: [SaudaReqItem], needBy: String, token: String) async throws -> SaudaMutationResponse {
        try await post("requisition", body: ["items": items.map { ["item_key": $0.item_key, "qty": $0.qty] },
                                             "need_by": needBy], token: token)
    }

    // POST ?action=place {for_date, lines:[…]} — Place tab "Place order" → fires vendor WhatsApp.
    func place(forDate: String, lines: [[String: Any]], token: String) async throws -> SaudaMutationResponse {
        try await post("place", body: ["for_date": forDate, "lines": lines], token: token)
    }

    // POST ?action=decode {text?, image?, brand} — paste → Claude decode → review.
    func decode(text: String?, image: String?, brand: String, token: String) async throws -> SaudaDecodeResponse {
        var body: [String: Any] = ["brand": brand]
        if let t = text, !t.isEmpty { body["text"] = t }
        if let i = image, !i.isEmpty { body["image"] = i }
        return try await postDecodable("decode", body: body, token: token)
    }

    // POST ?action=save-po {orders, need_by} — confirm the decoded PO into the trail.
    func savePO(orders: [[String: Any]], needBy: String, token: String) async throws -> SaudaSavePoResponse {
        try await postDecodable("save-po", body: ["orders": orders, "need_by": needBy], token: token)
    }

    // POST ?action=request-pay {ids, amount_paise} — owner asks for the payment (To pay).
    func requestPay(ids: [Int], amountPaise: Int, token: String) async throws -> SaudaMutationResponse {
        try await post("request-pay", body: ["ids": ids, "amount_paise": amountPaise], token: token)
    }

    // POST ?action=mark-paid {ids, amount_paise, method} — record the payment (To pay).
    func markPaid(ids: [Int], amountPaise: Int, method: String, token: String) async throws -> SaudaMutationResponse {
        try await post("mark-paid", body: ["ids": ids, "amount_paise": amountPaise, "method": method], token: token)
    }

    // POST ?action=purchase-receipt {lines:[{id,line_idx,yielded_kg,delivered_kg,received_pieces?,received_note}]}
    //    — chicken/live receipt (kg only, no rate). No money gate.
    func purchaseReceipt(lines: [[String: Any]], token: String) async throws -> SaudaMutationResponse {
        try await post("purchase-receipt", body: ["lines": lines], token: token)
    }

    // POST ?action=purchase-prices {lines:[{id,line_idx,price_paise} | {…,daily_rate_paise}], receipt_ref?}
    //    — receipt rates / MN daily rate → recalculates the bill. No money gate.
    func purchasePrices(lines: [[String: Any]], receiptRef: String?, token: String) async throws -> SaudaMutationResponse {
        var body: [String: Any] = ["lines": lines]
        if let r = receiptRef, !r.isEmpty { body["receipt_ref"] = r }
        return try await post("purchase-prices", body: body, token: token)
    }

    // POST ?action=vendor-event {vendorKey, events:[…]} — direct invoice + payment (Vendor diary).
    func vendorEvent(vendorKey: String, events: [[String: Any]], token: String) async throws -> SaudaMutationResponse {
        try await post("vendor-event", body: ["vendorKey": vendorKey, "events": events], token: token)
    }

    // POST ?action=settings-item {item_code, …fields} — upsert the item master.
    func settingsItem(_ fields: [String: Any], token: String) async throws -> SaudaMutationResponse {
        try await post("settings-item", body: fields, token: token)
    }

    // POST ?action=settings-vendor {vendor_key, …fields} — upsert the vendor master.
    func settingsVendor(_ fields: [String: Any], token: String) async throws -> SaudaSettingsVendorResponse {
        try await postDecodable("settings-vendor", body: fields, token: token)
    }

    // generic POST → SaudaMutationResponse {ok, error?, …}
    private func post(_ action: String, body: [String: Any], token: String) async throws -> SaudaMutationResponse {
        try await postDecodable(action, body: body, token: token)
    }

    private func postDecodable<T: Decodable>(_ action: String, body: [String: Any], token: String) async throws -> T {
        guard let url = URL(string: "\(base)?action=\(action)") else { throw SaudaError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 45        // decode calls Claude — needs headroom
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.setValue(token, forHTTPHeaderField: "x-darbar-token")
        req.setValue("Mozilla/5.0", forHTTPHeaderField: "User-Agent")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let h = resp as? HTTPURLResponse {
            if h.statusCode == 401 || h.statusCode == 403 { throw SaudaError.unauthorized }
            // server returns 4xx with a JSON {error} body for validation — surface that, not the code
            if !(200..<300).contains(h.statusCode) {
                if let j = try? decoder.decode(SaudaMutationResponse.self, from: data), let e = j.error {
                    throw SaudaError.server(e)
                }
                throw SaudaError.server("Sauda HTTP \(h.statusCode)")
            }
        }
        if data.isEmpty { throw SaudaError.server("Empty Sauda response") }
        return try decoder.decode(T.self, from: data)
    }

    private func get<T: Decodable>(_ action: String, query: [String: String] = [:], token: String) async throws -> T {
        guard var c = URLComponents(string: base) else { throw SaudaError.badURL }
        var items = [URLQueryItem(name: "action", value: action)]
        items += query.map { URLQueryItem(name: $0.key, value: $0.value) }
        c.queryItems = items
        guard let url = c.url else { throw SaudaError.badURL }
        var req = URLRequest(url: url)
        req.timeoutInterval = 12
        req.setValue(token, forHTTPHeaderField: "x-darbar-token")
        req.setValue("Mozilla/5.0", forHTTPHeaderField: "User-Agent")
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let h = resp as? HTTPURLResponse {
            if h.statusCode == 401 || h.statusCode == 403 { throw SaudaError.unauthorized }
            if !(200..<300).contains(h.statusCode) { throw SaudaError.server("Sauda HTTP \(h.statusCode)") }
        }
        if data.isEmpty { throw SaudaError.server("Empty Sauda response") }
        return try decoder.decode(T.self, from: data)
    }
}

enum SaudaError: LocalizedError {
    case badURL, unauthorized, locked, server(String)
    var errorDescription: String? {
        switch self {
        case .badURL: return "Bad Sauda URL"
        case .unauthorized: return "Sauda token rejected"
        case .locked: return "Unlock from the Diwan home"
        case .server(let m): return m
        }
    }
}
