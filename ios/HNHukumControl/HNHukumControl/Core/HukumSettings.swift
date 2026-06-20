import Foundation
import Combine
import Security

final class HukumSettings: ObservableObject {
    static let shared = HukumSettings()

    private let defaults: UserDefaults
    private let bridgeKey = "hukum.bridgeURL"
    private let nazarKey = "hukum.nazarURL"
    private let selectedLaneKey = "hukum.selectedLane"
    private let autoReadKey = "hukum.autoRead"
    private let autoReadModeKey = "hukum.autoReadMode"
    private let anbarURLKey = "hukum.anbarURL"
    private let naamURLKey = "hukum.naamURL"

    @Published var bridgeURL: String {
        didSet { defaults.set(bridgeURL, forKey: bridgeKey) }
    }

    @Published var authToken: String {
        didSet { KeychainStore.set(authToken, service: "HN-Hukum", account: "bridge-token") }
    }

    @Published var nazarURL: String {
        didSet { defaults.set(nazarURL, forKey: nazarKey) }
    }

    @Published var selectedLanePhrase: String {
        didSet { defaults.set(selectedLanePhrase, forKey: selectedLaneKey) }
    }

    // Auto-read: speak each new final answer aloud as it finishes (hands-free).
    @Published var autoRead: Bool {
        didSet { defaults.set(autoRead, forKey: autoReadKey) }
    }
    // "sticky" = read every new answer · "oneshot" = read one then turn off.
    @Published var autoReadMode: String {
        didSet { defaults.set(autoReadMode, forKey: autoReadModeKey) }
    }

    // Per-chamber base URLs (each chamber's backend is independent).
    @Published var anbarURL: String { didSet { defaults.set(anbarURL, forKey: anbarURLKey) } }
    @Published var naamURL: String { didSet { defaults.set(naamURL, forKey: naamURLKey) } }

    private init() {
        defaults = UserDefaults(suiteName: "group.com.hnhotels.hukum") ?? .standard
        bridgeURL = defaults.string(forKey: bridgeKey) ?? "http://100.75.28.7:8790"
        nazarURL = defaults.string(forKey: nazarKey) ?? "http://100.107.54.16:8080"
        authToken = KeychainStore.get(service: "HN-Hukum", account: "bridge-token") ?? ""
        selectedLanePhrase = defaults.string(forKey: selectedLaneKey) ?? "selected"
        autoRead = defaults.object(forKey: autoReadKey) == nil ? true : defaults.bool(forKey: autoReadKey)
        autoReadMode = defaults.string(forKey: autoReadModeKey) ?? "sticky"
        anbarURL = defaults.string(forKey: anbarURLKey) ?? "https://anbar.hnhotels.in"
        naamURL = defaults.string(forKey: naamURLKey) ?? "https://naam.hnhotels.in"
    }

    var isSecureBridge: Bool {
        URL(string: bridgeURL)?.scheme?.lowercased() == "https"
    }

    var isSecureNazar: Bool {
        URL(string: nazarURL)?.scheme?.lowercased() == "https"
    }
}

enum KeychainStore {
    // Keychain is primary (secure, used on device). When the Keychain is unavailable — notably the
    // iOS simulator, where SecItemAdd fails with errSecMissingEntitlement (-34018) — we fall back to
    // UserDefaults so the app still functions. On device the fallback is never written.
    private static func dkey(_ service: String, _ account: String) -> String { "kc.\(service).\(account)" }

    static func set(_ value: String, service: String, account: String) {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
        let key = dkey(service, account)
        guard !value.isEmpty else { UserDefaults.standard.removeObject(forKey: key); return }
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        if status == errSecSuccess {
            UserDefaults.standard.removeObject(forKey: key)
        } else {
            UserDefaults.standard.set(value, forKey: key)   // fallback (simulator / no entitlement)
        }
    }

    static func get(service: String, account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecSuccess, let data = result as? Data, let s = String(data: data, encoding: .utf8) {
            return s
        }
        return UserDefaults.standard.string(forKey: dkey(service, account))
    }
}
