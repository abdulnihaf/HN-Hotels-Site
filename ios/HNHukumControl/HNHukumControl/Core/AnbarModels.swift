import Foundation

// Anbar conservation board — GET /api/anbar?action=live (public read; the live conservation engine).
// Per item per location:  last_count + received + issued − sold(from POS) − waste = EXPECTED.
// Modelled from the REAL live payload — NOT action=board (the thin TV summary the stub used).
struct AnbarLiveResponse: Codable, Hashable {
    var success: Bool?
    var odooOk: Bool?
    var items: [AnbarLiveItem]?

    enum CodingKeys: String, CodingKey {
        case success, items
        case odooOk = "odoo_ok"
    }
}

// Brand scope, derived from the canonical code prefix. The PWA splits into /ops/anbar/nch/ + /he/;
// the server does NOT (yet) honour ?brand=, so we split client-side by prefix (verified live).
enum AnbarBrand: String, CaseIterable, Hashable {
    case nch, he, shared

    var chip: String {
        switch self {
        case .nch: return "NCH"
        case .he: return "HE"
        case .shared: return "BOTH"
        }
    }
    var title: String {
        switch self {
        case .nch: return "Nawabi Chai House"
        case .he: return "Hamza Express"
        case .shared: return "Shared"
        }
    }
}

struct AnbarPack: Codable, Hashable {
    var name: String?
    var size: Double?
}

struct AnbarLiveItem: Codable, Identifiable, Hashable {
    var code: String                 // CROSS-REF: the canonical join key across chambers — never drop it.
    var name: String?
    var uom: String?
    var locs: [String]?
    var pack: AnbarPack?
    var ccase: AnbarPack?
    var madeInHouse: Bool?
    var counter: AnbarCounter?
    var store: AnbarStore?

    var id: String { code }

    // CROSS-REF: brand derived from the code prefix (nch | he | shared). HN-RM-* = shared raw material.
    var brand: AnbarBrand {
        if code.hasPrefix("HN-RM") { return .shared }
        if code.hasPrefix("HE") { return .he }
        return .nch
    }
    var displayName: String { name ?? code }

    // Needs a recount if any tracked location sold beyond its last count (expected < 0)
    // or has no baseline at all (never counted).
    var needsRecount: Bool {
        (counter?.needsRecount ?? false) || (store?.needsRecount ?? false)
    }

    enum CodingKeys: String, CodingKey {
        case code, name, uom, locs, pack, ccase, counter, store
        case madeInHouse = "made_in_house"
    }
}

// Counter lane:  last_count + received + issued_in − sold − waste = expected  (sold is POS-derived).
struct AnbarCounter: Codable, Hashable {
    var lastCount: Double?
    var countedAt: String?
    var received: Double?
    var issuedIn: Double?
    var sold: Double?
    var waste: Double?
    var expected: Double?            // CROSS-REF: the reconcilable stock figure (can go negative)
    var odooOk: Bool?                // CROSS-REF: POS feed health behind the sold figure

    var needsRecount: Bool {
        if lastCount == nil { return true }
        if let e = expected, e < 0 { return true }
        return false
    }

    enum CodingKeys: String, CodingKey {
        case received, sold, waste, expected
        case lastCount = "last_count"
        case countedAt = "counted_at"
        case issuedIn = "issued_in"
        case odooOk = "odoo_ok"
    }
}

// Store lane:  last_count + received − issued_out = expected. May carry a "not counted yet" note.
struct AnbarStore: Codable, Hashable {
    var lastCount: Double?
    var countedAt: String?
    var received: Double?
    var issuedOut: Double?
    var expected: Double?
    var note: String?

    var needsRecount: Bool {
        if lastCount == nil { return true }
        if let e = expected, e < 0 { return true }
        return false
    }

    enum CodingKeys: String, CodingKey {
        case received, expected, note
        case lastCount = "last_count"
        case countedAt = "counted_at"
        case issuedOut = "issued_out"
    }
}
