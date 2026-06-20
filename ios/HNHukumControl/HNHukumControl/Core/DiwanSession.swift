import Foundation
import Combine
import LocalAuthentication

// One unlock for the whole Diwan: Face ID (native, frictionless) with the PIN as the one-time
// setup + fallback. The owner's PIN is entered ONCE to vault every chamber's credential (and mint
// Darbar's token); after that, Face ID alone unlocks the session — no chamber ever gates again.
@MainActor
final class DiwanSession: ObservableObject {
    @Published var unlocked = false
    @Published var working = false
    @Published var error: String?

    private let pinChambers = ["sauda", "hisab", "takht"]

    // Has the owner completed the one-time PIN setup (credentials vaulted)?
    var isSetUp: Bool { DiwanAuth.isUnlocked("owner") }

    var biometryName: String {
        let ctx = LAContext()
        _ = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch ctx.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        default: return ""
        }
    }
    var biometryAvailable: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
    }

    init() {
        // simulator/test hook: pre-seed + unlock so the post-unlock flow is verifiable
        if let seed = ProcessInfo.processInfo.environment["HUKUM_SEED_PIN"], !seed.isEmpty {
            for c in pinChambers + ["darbar", "owner"] { DiwanAuth.setCredential(seed, chamber: c) }
            unlocked = ProcessInfo.processInfo.environment["HUKUM_LOCK"] == nil
        }
    }

    // Auto-called on the unlock screen once setup is done.
    func tryBiometric() async {
        guard isSetUp, biometryAvailable else { return }
        let ctx = LAContext()
        ctx.localizedFallbackTitle = "Use PIN"
        do {
            let ok = try await ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics,
                                                  localizedReason: "Unlock the Diwan")
            if ok { unlocked = true }
        } catch {
            // user cancelled or failed — they can fall back to the PIN
        }
    }

    // PIN path: first time it seeds everything; afterwards it just verifies + unlocks.
    func submitPin(_ pin: String) async {
        working = true; error = nil
        defer { working = false }
        if isSetUp {
            if DiwanAuth.credential("owner") == pin { unlocked = true }
            else { error = "wrong" }
        } else {
            await completeSetup(pin: pin)
            unlocked = true
        }
    }

    private func completeSetup(pin: String) async {
        for c in pinChambers { DiwanAuth.setCredential(pin, chamber: c) }
        if let token = await mintDarbarToken(pin: pin) {
            DiwanAuth.setCredential(token, chamber: "darbar")
        } else {
            DiwanAuth.setCredential(pin, chamber: "darbar")
        }
        DiwanAuth.setCredential(pin, chamber: "owner")
    }

    func signOut() {
        for c in pinChambers + ["darbar", "owner"] { DiwanAuth.clear(c) }
        unlocked = false
    }

    private func mintDarbarToken(pin: String) async -> String? {
        guard let url = URL(string: "https://darbar.hnhotels.in/api/darbar?action=auth") else { return nil }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["pin": pin])
        req.timeoutInterval = 12
        guard let (d, resp) = try? await URLSession.shared.data(for: req),
              let h = resp as? HTTPURLResponse, (200..<300).contains(h.statusCode),
              let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let token = obj["token"] as? String else { return nil }
        return token
    }
}
