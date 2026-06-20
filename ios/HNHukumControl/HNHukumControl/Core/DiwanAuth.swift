import Foundation

// Per-chamber credential vault (Keychain-backed). The intelligence is emphatic: auth is NOT unified —
// each chamber authenticates independently and the credentials do NOT interchange:
//   anbar  → Darbar staff_pin (?pin=)        sauda → X-Ops-Pin / ?pin=
//   hisaab → own PIN (?pin=)                 darbar → minted 12h HMAC token (x-darbar-token)
//   takht  → rectify verify-staff PIN (RUPEES, not paise)
//   naam   → soft PIN (data is public)       nazar → none (tailnet)
// The one SHARED primitive is the Darbar staff_pin as cross-chamber IDENTITY (verify-pin → role).
enum DiwanAuth {
    private static let service = "HN-Diwan"

    static func setCredential(_ value: String, chamber: String) {
        KeychainStore.set(value, service: service, account: "cred-\(chamber)")
    }

    static func credential(_ chamber: String) -> String? {
        let v = KeychainStore.get(service: service, account: "cred-\(chamber)")
        return (v?.isEmpty == false) ? v : nil
    }

    static func clear(_ chamber: String) {
        KeychainStore.set("", service: service, account: "cred-\(chamber)")
    }

    static func isUnlocked(_ chamber: String) -> Bool { credential(chamber) != nil }
}
