import Foundation

// Darbar — HR / staff-identity chamber. Modelled from the LIVE payload (curl-verified 2026-06-20),
// NOT the description. Source: GET https://darbar.hnhotels.in/api/darbar?action=home
//
// LAWS (chamber soul): presence pays a FULL day · no fused math · an open day closes at 04:00 IST.
// READ-ONLY: this surface shows the exception inbox. Resolve / exit / pay are execution (out of scope).

// POST /api/darbar?action=auth  body {"pin":"…"} → token mint.
struct DarbarAuthResponse: Codable {
    var token: String
    var user: String?
    var role: String?
    var fin: Bool?
}

// GET /api/darbar?action=home  (header x-darbar-token).
struct DarbarHome: Codable, Hashable {
    var businessDay: String?
    var istNow: String?
    var stats: DarbarStats?
    var exceptionCount: Int?
    var exceptions: [DarbarException]?
    var health: DarbarHealth?

    enum CodingKeys: String, CodingKey {
        case stats, exceptions, health
        case businessDay = "business_day"
        case istNow = "ist_now"
        case exceptionCount = "exception_count"
    }
}

struct DarbarStats: Codable, Hashable {
    var expected: Int?
    var present: Int?
    var inProgress: Int?
    var missingPunch: Int?
    var absent: Int?
    var off: Int?

    enum CodingKeys: String, CodingKey {
        case expected, present, absent, off
        case inProgress = "in_progress"
        case missingPunch = "missing_punch"
    }
}

// The exception inbox is a heterogeneous list keyed by `type`:
//   ghost          → a CAMS device identity punching with no matching roster employee
//   chronic_missed → a rostered employee with repeated odd/missed-punch days
//   pay_missing    → a rostered employee with no pay record
struct DarbarException: Codable, Identifiable, Hashable {
    var type: String?
    var id: Int?                 // roster employee id (chronic_missed / pay_missing); absent for ghost
    var pin: String?             // CAMS pin (may be null for some pay_missing rows)
    var name: String?            // rostered name (chronic_missed / pay_missing)
    var deviceName: String?      // CAMS device-stored name (ghost)
    var brand: String?           // HE | NCH | HQ
    var punches: Int?            // ghost: punch count in window
    var days: Int?               // ghost: distinct days seen
    var lastPunch: String?       // ghost: last punch timestamp
    var daysSilent: Int?         // ghost: days since last punch
    var active: Bool?            // ghost: still punching
    var shape: String?           // ghost: e.g. "split (morning+evening)"
    var oddDays: Int?            // chronic_missed: count of odd days

    // Stable identity for SwiftUI — pin is the natural key; fall back to id/name when absent.
    var uid: String {
        "\(type ?? "x")-\(pin ?? id.map(String.init) ?? name ?? UUID().uuidString)"
    }

    enum CodingKeys: String, CodingKey {
        case type, id, pin, name, brand, punches, days, active, shape
        case deviceName = "device_name"
        case lastPunch = "last_punch"
        case daysSilent = "days_silent"
        case oddDays = "odd_days"
    }

    // The human label to show — device name for ghosts, roster name otherwise.
    var displayName: String { name ?? deviceName ?? (pin.map { "PIN \($0)" } ?? "Unknown") }
}

struct DarbarHealth: Codable, Hashable {
    var camsLastPunchAgeMin: Int?
    var camsQuietHours: Bool?
    var camsOk: Bool?
    var ghostCount: Int?

    enum CodingKeys: String, CodingKey {
        case camsLastPunchAgeMin = "cams_last_punch_age_min"
        case camsQuietHours = "cams_quiet_hours"
        case camsOk = "cams_ok"
        case ghostCount = "ghost_count"
    }
}

// Darbar-local error (own enum so we don't touch the shared HukumError).
enum DarbarError: LocalizedError {
    case badURL
    case unauthorized          // 401 — token expired/invalid → re-gate
    case server(String)
    case badPIN

    var errorDescription: String? {
        switch self {
        case .badURL: return "Darbar URL is invalid."
        case .unauthorized: return "Session expired — re-enter PIN."
        case .server(let m): return m
        case .badPIN: return "Wrong PIN."
        }
    }
}
