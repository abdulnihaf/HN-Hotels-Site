import Foundation
import LocalAuthentication

// Face ID / Touch ID unlock for the owner's Takht.
// First login is by PIN (it establishes WHICH Darbar identity you are); after that
// the PIN is held in the keychain and Face ID re-opens the app — no retyping.
//
// This file is in TakhtShared (compiles into the Watch target too), so the
// iOS-only LocalAuthentication APIs are guarded behind #if os(iOS).
enum TakhtBiometric {
    static var kind: String {
        #if os(iOS)
        let c = LAContext()
        _ = c.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch c.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        default: return "biometrics"
        }
        #else
        return "biometrics"
        #endif
    }

    static var available: Bool {
        var err: NSError?
        // .deviceOwnerAuthentication = biometrics with device-passcode fallback (both platforms).
        return LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: &err)
    }

    static func authenticate(_ reason: String) async -> Bool {
        let ctx = LAContext()
        #if os(iOS)
        ctx.localizedFallbackTitle = "Enter PIN"
        #endif
        return await withCheckedContinuation { cont in
            ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, _ in
                cont.resume(returning: ok)
            }
        }
    }
}
