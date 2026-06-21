import Foundation
import Security

// Keychain primary, UserDefaults fallback on simulator (SecItemAdd -34018). Service "HN-Sauda".
// Accounts: "owner-pin" (the seeded/entered PIN) and "sauda-token" (the minted Diwan token).
enum KeychainStore {
    private static let service = "HN-Sauda"

    static func set(_ value: String, for account: String) {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        let status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecMissingEntitlement || status == -34018 {
            UserDefaults.standard.set(value, forKey: "\(service).\(account)")
        }
    }

    static func get(_ account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        if status == errSecSuccess, let d = out as? Data, let s = String(data: d, encoding: .utf8) { return s }
        return UserDefaults.standard.string(forKey: "\(service).\(account)")
    }

    static func clear(_ account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        UserDefaults.standard.removeObject(forKey: "\(service).\(account)")
    }
}
