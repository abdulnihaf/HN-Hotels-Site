import Foundation

// Sauda buy board — GET /api/buy?action=today&pin=… (modelled from the live payload + buy.js schema).
// Money fields are PAISE (INTEGER) per buy.js — divide by 100 at display.
struct SaudaTodayResponse: Codable, Hashable {
    var ok: Bool?
    var date: String?
    var placed: String?
    var lines: [SaudaLine]?
    var requests: [SaudaRequest]?
    var vendors: [String]?
    var registry: [SaudaVendor]?
    var catalog: [String]?
    // `vpa` is a vendor→handle map; not needed for the read-only board, so we skip decoding it.

    enum CodingKeys: String, CodingKey {
        case ok, date, placed, lines, requests, vendors, registry, catalog
    }
}

// A purchase line — buy_lines row. qty_ordered/qty_received are TEXT in D1; money is paise.
struct SaudaLine: Codable, Identifiable, Hashable {
    var id: Int
    var bizDate: String?
    var brand: String?
    var vendor: String?
    var channel: String?       // "go" (counter-buy) | "delivered"
    var item: String?
    var uom: String?
    var qtyOrdered: String?
    var qtyReceived: String?
    var unitCostPaise: Int?
    var lineTotalPaise: Int?
    var status: String?        // logged | paid | …

    enum CodingKeys: String, CodingKey {
        case id, brand, vendor, channel, item, uom, status
        case bizDate = "biz_date"
        case qtyOrdered = "qty_ordered"
        case qtyReceived = "qty_received"
        case unitCostPaise = "unit_cost_paise"
        case lineTotalPaise = "line_total_paise"
    }

    var qtyDisplay: String {
        let r = (qtyReceived ?? "").trimmingCharacters(in: .whitespaces)
        let o = (qtyOrdered ?? "").trimmingCharacters(in: .whitespaces)
        let q = r.isEmpty ? o : r
        let u = (uom ?? "").trimmingCharacters(in: .whitespaces)
        if q.isEmpty { return u.isEmpty ? "—" : u }
        return u.isEmpty ? q : "\(q) \(u)"
    }

    var rupees: Double { Double(lineTotalPaise ?? 0) / 100 }
    var hasAmount: Bool { (lineTotalPaise ?? 0) > 0 }
}

// A pending pay-request — buy_requests row. amount_paise is paise.
struct SaudaRequest: Codable, Identifiable, Hashable {
    var id: Int
    var bizDate: String?
    var brand: String?
    var vendor: String?
    var vpa: String?
    var amountPaise: Int?
    var status: String?        // requested | paid | …

    enum CodingKeys: String, CodingKey {
        case id, brand, vendor, vpa, status
        case bizDate = "biz_date"
        case amountPaise = "amount_paise"
    }

    var rupees: Double { Double(amountPaise ?? 0) / 100 }
}

// Vendor registry row — buy_vendors.
struct SaudaVendor: Codable, Identifiable, Hashable {
    var id: Int
    var name: String
    var phone: String?
    var vpa: String?
    var materials: String?
    var brand: String?         // HE | NCH | both
    var channel: String?       // go | delivered

    enum CodingKeys: String, CodingKey {
        case id, name, phone, vpa, materials, brand, channel
    }
}
