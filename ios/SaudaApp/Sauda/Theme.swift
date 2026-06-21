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

extension Color {
    init(hex: UInt, alpha: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xff) / 255,
                  green: Double((hex >> 8) & 0xff) / 255,
                  blue: Double(hex & 0xff) / 255,
                  opacity: alpha)
    }
}
