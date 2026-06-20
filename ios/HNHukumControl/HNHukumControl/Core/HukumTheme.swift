import SwiftUI

// HN Hukum — dark command-cockpit design system.
// Hukum is the owner's neutral HN "house" identity (not HE brown / NCH kraft — those are the chambers).
enum HK {
    // Surfaces — Hukum's real warm-brown identity (matches the PWA: --bg #140a07 …)
    static let bg       = Color(hex: 0x140A07)
    static let bgElev   = Color(hex: 0x1D0F0B)
    static let card     = Color(hex: 0x241310)
    static let cardHi   = Color(hex: 0x2E1A14)
    static let line     = Color(hex: 0x3A201A)
    static let lineSoft = Color(hex: 0x2A1610)

    // Text
    static let text     = Color(hex: 0xF4E9E2)
    static let textDim  = Color(hex: 0xB79A8D)
    static let textFaint = Color(hex: 0x836A5D)

    // Signal accent — burnt orange (--acc #c8642d)
    static let accent     = Color(hex: 0xC8642D)
    static let accentSoft = Color(hex: 0xC8642D).opacity(0.16)
    static let accentLine = Color(hex: 0xC8642D).opacity(0.6)

    // Status
    static let running = Color(hex: 0xE0A33C)   // working (warm amber, distinct from Codex blue)
    static let ready   = Color(hex: 0x7FDC8A)   // final answer ready (--ok)
    static let idle    = Color(hex: 0x836A5D)   // quiet
    static let error   = Color(hex: 0xFFB4A0)

    // Engine identity — EXACT PWA engine colours
    static func engine(_ app: String?) -> Color {
        switch (app ?? "").lowercased() {
        case "claude": return Color(hex: 0xD97757)   // coral
        case "codex":  return Color(hex: 0x6AA9FF)   // blue
        case "kimi":   return Color(hex: 0x9DF29A)   // green
        default:       return Color(hex: 0xB79A8D)
        }
    }

    static let radius: CGFloat = 18
    static let radiusSm: CGFloat = 12
}

// Lane → presentation helpers.
extension HukumLaneState {
    // A lane is "readable" if it has a meaningful final answer OR the bridge marks it ready.
    var canRead: Bool { isFinalReadable || (healthState ?? "").lowercased() == "ready" }
    var statusColor: Color {
        if isRunning { return HK.running }
        if canRead { return HK.ready }
        return HK.idle
    }
    var statusLabel: String {
        if isRunning { return "Working" }
        if canRead { return "Ready" }
        return (healthState ?? "idle").capitalized
    }
    var engineColor: Color { HK.engine(app) }
    var engineName: String { (app ?? "codex").uppercased() }
}

extension HukumSession {
    var engineColor: Color { HK.engine(app) }
    var engineName: String { (app ?? "codex").uppercased() }
}

extension Color {
    init(hex: UInt, alpha: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xff) / 255,
                  green: Double((hex >> 8) & 0xff) / 255,
                  blue: Double(hex & 0xff) / 255,
                  opacity: alpha)
    }
}
