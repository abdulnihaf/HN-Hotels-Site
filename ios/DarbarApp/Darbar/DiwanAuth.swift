import Foundation

// Standalone Darbar credential vault — a thin shim over the scaffold's KeychainStore so the ported
// DarbarAppModel (which reads DiwanAuth.credential("owner")/("darbar")) works unchanged.
// The gate (DarbarSession) stores the verified PIN at account "owner-pin"; the model mints the
// 12h Diwan token from it. "darbar" maps to a separate slot for an injected token (unused here).
enum DiwanAuth {
    private static func account(_ chamber: String) -> String {
        chamber == "owner" ? "owner-pin" : "\(chamber)-cred"
    }
    static func credential(_ chamber: String) -> String? {
        let v = KeychainStore.get(account(chamber))
        return (v?.isEmpty == false) ? v : nil
    }
    static func setCredential(_ value: String, chamber: String) { KeychainStore.set(value, for: account(chamber)) }
    static func clear(_ chamber: String) { KeychainStore.clear(account(chamber)) }
    static func isUnlocked(_ chamber: String) -> Bool { credential(chamber) != nil }
}
