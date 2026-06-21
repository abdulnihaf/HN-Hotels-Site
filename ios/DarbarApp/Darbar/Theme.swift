import SwiftUI

// HN chamber — dark command-cockpit design system (copied from the Hukum kit).
enum HK {
    // Surfaces — warm-brown identity (--bg #140a07 …)
    static let bg       = Color(hex: 0x140A07)
    static let bgElev   = Color(hex: 0x1D0F0B)
    static let card     = Color(hex: 0x241310)
    static let cardHi   = Color(hex: 0x2E1A14)
    static let line     = Color(hex: 0x3A201A)
    static let lineSoft = Color(hex: 0x2A1610)

    // Text
    static let text      = Color(hex: 0xF4E9E2)
    static let textDim   = Color(hex: 0xB79A8D)
    static let textFaint = Color(hex: 0x836A5D)

    // Signal accent — burnt orange (--acc #c8642d)
    static let accent     = Color(hex: 0xC8642D)
    static let accentSoft = Color(hex: 0xC8642D).opacity(0.16)
    static let accentLine = Color(hex: 0xC8642D).opacity(0.6)

    // Status
    static let running = Color(hex: 0xE0A33C)
    static let ready   = Color(hex: 0x7FDC8A)
    static let idle    = Color(hex: 0x836A5D)
    static let error   = Color(hex: 0xFFB4A0)

    static let radius: CGFloat = 18
    static let radiusSm: CGFloat = 12
}

// Darbar PWA palette — the deployed web app (darbar.hnhotels.in) is the source of truth.
// These mirror its CSS custom properties exactly so the native screens are 1:1.
enum DK {
    static let gold      = Color(hex: 0xD4A24C)   // --gold  (primary accent)
    static let goldSoft  = Color(hex: 0xD4A24C).opacity(0.16)
    static let goldText  = Color(hex: 0x1A1206)   // dark text on a gold fill (--btn.primary color)
    static let green     = Color(hex: 0x37D399)   // --green (working now / present)
    static let greenSoft = Color(hex: 0x37D399).opacity(0.14)
    static let red       = Color(hex: 0xFF5C5C)   // --red   (silent/absent/destructive)
    static let redSoft   = Color(hex: 0xFF5C5C).opacity(0.14)
    static let yellow    = Color(hex: 0xFBBF24)   // --yellow (chronic / 14d+)
    static let yellowSoft = Color(hex: 0xFBBF24).opacity(0.15)
    static let purple    = Color(hex: 0xA78BFA)   // --purple (HE / no-roster / off)
    static let purpleSoft = Color(hex: 0xA78BFA).opacity(0.15)
    static let blue      = Color(hex: 0x5E9EFF)   // --blue   (HQ / open / never-punched)
    static let blueSoft  = Color(hex: 0x5E9EFF).opacity(0.14)
    static let dim       = Color(hex: 0x9A9AA3)   // --dim
    static let mute      = Color(hex: 0x5C5C66)   // --mute (no-punches / 7d+)
    static let segOn     = Color(hex: 0x24242F)   // --e3 (active seg/chip subtle grey, NOT gold)

    // Brand badge colors (PWA: .pill.he=purple .pill.nch=green .pill.hq=blue)
    static func brandColor(_ b: String?) -> Color {
        switch (b ?? "").uppercased() {
        case "HE": return purple
        case "NCH": return green
        case "HQ": return blue
        default: return mute
        }
    }
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
