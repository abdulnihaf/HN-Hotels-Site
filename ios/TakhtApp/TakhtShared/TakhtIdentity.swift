import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// IDENTITY — the person behind the PIN.
//
// Darbar (hr_employees, D1 hn-hiring) is the SINGLE identity source. Takht owns
// no people. A typed staff_pin is resolved by hnhotels.in/api/takht-auth into a
// scoped identity: who they are, which brand they belong to, what they may do.
//
// This is the spine of the rebuild: login is an IDENTITY, not a lock. The board
// a person sees is decided by their role + brand, not by a shared default.
// ─────────────────────────────────────────────────────────────────────────────

// Brand the person works under. Drives BOTH the accent colour AND the data host.
enum TakhtBrand: String, Codable {
    case nch = "NCH"
    case he  = "HE"
    case hq  = "HQ"

    // The brand's own POS/settlement host. HQ has no data of its own — an HQ
    // manager picks a counter (NCH or HE) and works that brand's host.
    var dataHost: String {
        switch self {
        case .nch: return "https://nawabichaihouse.com"
        case .he:  return "https://hamzaexpress.in"
        case .hq:  return "https://nawabichaihouse.com" // never used directly — picker resolves it
        }
    }

    var fullName: String {
        switch self {
        case .nch: return "Nawabi Chai House"
        case .he:  return "Hamza Express"
        case .hq:  return "HN Hotels"
        }
    }

    var shortName: String { rawValue }

    // Accent — matches the live Takht web routing (NCH red, HE copper, HQ gold).
    var accent: Color {
        switch self {
        case .nch: return Color(hex: 0xC93838)
        case .he:  return Color(hex: 0xC2703A)
        case .hq:  return Color(hex: 0xD4A24C)
        }
    }
}

// What a role may see + do. Mirrors takht-auth `classifyRole`.
struct TakhtScope: Codable {
    var view: String          // manager | cashier | runner | captain | counter | none
    var foh: Bool
    var canFix: Bool
    var canSettle: Bool
    var crossBrand: Bool

    enum CodingKeys: String, CodingKey {
        case view, foh
        case canFix = "can_fix"
        case canSettle = "can_settle"
        case crossBrand = "cross_brand"
    }

    enum View: String { case manager, cashier, runner, captain, counter, none }
    var role: View { View(rawValue: view) ?? .none }
}

// The wire shape of GET /api/takht-auth?action=verify-pin&pin=
struct TakhtAuthResponse: Codable {
    var ok: Bool?
    var id: Int?
    var name: String?
    var brand: String?
    var role: String?
    var scope: TakhtScope?
    var error: String?
}

// The resolved person, non-optional and ready to route.
struct TakhtIdentity {
    let id: Int
    let name: String
    let brand: TakhtBrand
    let role: String          // the human job title, e.g. "Cashier"
    let scope: TakhtScope

    init?(_ r: TakhtAuthResponse) {
        guard r.ok == true, let id = r.id, let name = r.name,
              let b = TakhtBrand(rawValue: (r.brand ?? "").uppercased()),
              let scope = r.scope else { return nil }
        self.id = id
        self.name = name
        self.brand = b
        self.role = r.role ?? ""
        self.scope = scope
    }

    var initial: String { String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased() }
}
