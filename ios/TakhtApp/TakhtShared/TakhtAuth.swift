import Foundation
import Security

// Stores the verified Takht PIN in Keychain (device-only, not synced).
// The gate is the NCH settlement verify-pin handshake — only this module writes the credential.
enum TakhtAuth {
    private static let service = "HN-Takht"
    private static let account = "pin"

    static var isUnlocked: Bool { TakhtAuth.get() != nil }

    static func set(_ pin: String) {
        let data = Data(pin.utf8)
        let q: [String: Any] = [
            kSecClass as String:    kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(q as CFDictionary)
        var add = q
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let st = SecItemAdd(add as CFDictionary, nil)
        if st != errSecSuccess {
            UserDefaults.standard.set(pin, forKey: "\(service).\(account)")
        } else {
            UserDefaults.standard.removeObject(forKey: "\(service).\(account)")
        }
    }

    static func get() -> String? {
        let q: [String: Any] = [
            kSecClass as String:       kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String:  true,
            kSecMatchLimit as String:  kSecMatchLimitOne
        ]
        var out: AnyObject?
        if SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
           let d = out as? Data, let s = String(data: d, encoding: .utf8) { return s }
        return UserDefaults.standard.string(forKey: "\(service).\(account)")
    }

    static func clear() {
        let q: [String: Any] = [
            kSecClass as String:    kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(q as CFDictionary)
        UserDefaults.standard.removeObject(forKey: "\(service).\(account)")
    }
}
