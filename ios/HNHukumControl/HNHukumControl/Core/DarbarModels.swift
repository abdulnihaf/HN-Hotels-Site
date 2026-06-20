import Foundation

// Darbar — the HR / staff-identity chamber ("the Court").
//
// METHOD (owner-directed 2026-06-20): Darbar inside the native app must be EXACTLY the deployed PWA
// at darbar.hnhotels.in — every tab, every action, salary recording, the lot. The whole app is
// already built and battle-tested as a PWA; re-porting it to SwiftUI by hand is the BLIND path that
// silently drops execution screens. So we don't re-port — we host the live deployed PWA in a native
// WKWebView (DarbarView) and feed it the Diwan token so it opens straight past its own PIN gate.
// Zero context lost, zero re-implementation surface to get wrong.
//
// These models cover only the ONE native job that remains: minting the shared Diwan token so the
// web app can authenticate. Everything the user sees and does is the real PWA.

// POST /api/darbar?action=auth  body {"pin":"…"} → token mint. NOTE: `action` MUST be a query
// param — the live server returns 401 if it is sent in the body (curl-verified 2026-06-20).
struct DarbarAuthResponse: Codable {
    var token: String
    var user: String?
    var role: String?
    var fin: Bool?
}

// Darbar-local error (own enum so we never touch shared HukumError).
enum DarbarError: LocalizedError {
    case badURL
    case badPIN
    case server(String)

    var errorDescription: String? {
        switch self {
        case .badURL:        return "Darbar URL is invalid."
        case .badPIN:        return "Wrong PIN."
        case .server(let m): return m
        }
    }
}
