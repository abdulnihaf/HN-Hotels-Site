import Foundation
import Combine

// Drives the native shell around the embedded Darbar PWA. Its only work: resolve a valid Diwan
// token + the {name,role,fin} the web app expects, so DarbarView can inject them into the page's
// sessionStorage at load and the PWA opens straight into the Court — no per-chamber PIN screen.
//
// AUTH = the ONE Diwan unlock (DIWAN-IOS-CONTRACT §4). DiwanSession seeds the credential for
// "darbar" (a minted token in prod, the raw owner PIN in sim / mint-failed fallback) and always the
// owner PIN under "owner". We prefer minting fresh from that PIN (gives token + user in one call);
// if only a token is vaulted we decode its payload for the user fields. No credential → honest
// locked state. Network down → honest offline state with a retry. NEVER a keypad here.
@MainActor
final class DarbarAppModel: ObservableObject {
    enum Phase { case loading, ready, locked, offline }

    @Published var phase: Phase = .loading
    @Published var token: String?
    @Published var userJSONBase64: String?   // base64 of {"name":…,"role":…,"fin":…} — injected via atob()
    @Published var statusLine = "Opening the court…"

    var appURL: String { DarbarClient.appURL }

    // MARK: - prepare the authenticated session for the webview

    func prepare() async {
        phase = .loading
        statusLine = "Opening the court…"

        // 1 — mint fresh from the one-unlock PIN (the normal path; gives token + user/role/fin).
        if let pin = ownerPin() {
            do {
                let res = try await DarbarClient.shared.auth(pin: pin)
                token = res.token
                userJSONBase64 = encodeUser(name: res.user, role: res.role, fin: res.fin)
                phase = .ready
                return
            } catch DarbarError.badPIN {
                // seeded PIN rejected — fall through to any vaulted token below
            } catch {
                // network / server down → if we also have no usable vaulted token, we're offline
                if let injected = injectedToken() {
                    token = injected
                    userJSONBase64 = decodeUser(fromToken: injected)
                    phase = .ready
                } else {
                    phase = .offline
                    statusLine = "Can't reach the court — check the connection."
                }
                return
            }
        }

        // 2 — no PIN, but the coordinator injected a ready token → consume it directly.
        if let injected = injectedToken() {
            token = injected
            userJSONBase64 = decodeUser(fromToken: injected)
            phase = .ready
            return
        }

        // 3 — nothing vaulted yet. Honest, calm, no keypad.
        phase = .locked
        statusLine = "Locked · unlock from the Diwan home"
    }

    func retry() async { await prepare() }

    // The webview reported a load failure (page itself couldn't load).
    func markOffline() {
        phase = .offline
        statusLine = "Can't reach the court — check the connection."
    }

    // MARK: - credential resolution

    private func ownerPin() -> String? {
        let numeric = "^[0-9]{3,8}$"
        if let o = DiwanAuth.credential("owner"), o.range(of: numeric, options: .regularExpression) != nil { return o }
        if let d = DiwanAuth.credential("darbar"), d.range(of: numeric, options: .regularExpression) != nil { return d }
        return nil
    }

    // A minted HMAC token is `base64url(payload).signature` → contains a dot. A bare PIN does not.
    private func injectedToken() -> String? {
        if let c = DiwanAuth.credential("darbar"), c.contains(".") { return c }
        return nil
    }

    // MARK: - build the PWA's darbar_user, base64'd so injection needs no escaping

    private func encodeUser(name: String?, role: String?, fin: Bool?) -> String? {
        let obj: [String: Any] = [
            "name": name ?? "Owner",
            "role": role ?? "admin",
            "fin": fin ?? true,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return nil }
        return data.base64EncodedString()
    }

    // Fallback: pull {u,r,f} out of the token payload (`base64url(JSON).sig`) when we only have a token.
    private func decodeUser(fromToken t: String) -> String? {
        let part = t.split(separator: ".").first.map(String.init) ?? t
        var b64 = part.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        guard let data = Data(base64Encoded: b64),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return encodeUser(name: nil, role: nil, fin: nil)
        }
        return encodeUser(name: obj["u"] as? String, role: obj["r"] as? String, fin: obj["f"] as? Bool)
    }
}
