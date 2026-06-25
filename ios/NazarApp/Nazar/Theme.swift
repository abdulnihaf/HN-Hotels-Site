import SwiftUI

enum HK {
    static let bg        = Color(hex: 0x140A07)
    static let bgElev    = Color(hex: 0x1D0F0B)
    static let card      = Color(hex: 0x241310)
    static let cardHi    = Color(hex: 0x2E1A14)
    static let line      = Color(hex: 0x3A201A)
    static let lineSoft  = Color(hex: 0x2A1610)

    static let text      = Color(hex: 0xF4E9E2)
    static let textDim   = Color(hex: 0xB79A8D)
    static let textFaint = Color(hex: 0x836A5D)

    static let accent     = Color(hex: 0xC8642D)
    static let accentSoft = Color(hex: 0xC8642D, alpha: 0.16)
    static let accentLine = Color(hex: 0xC8642D, alpha: 0.6)

    static let ok    = Color(hex: 0x7FDC8A)
    static let warn  = Color(hex: 0xE0A33C)
    static let error = Color(hex: 0xFFB4A0)
    static let faint = Color(hex: 0x836A5D)

    static let radius: CGFloat   = 14
    static let radiusSm: CGFloat = 10
}

extension Color {
    init(hex: UInt, alpha: Double = 1) {
        self.init(.sRGB,
                  red:   Double((hex >> 16) & 0xff) / 255,
                  green: Double((hex >>  8) & 0xff) / 255,
                  blue:  Double( hex        & 0xff) / 255,
                  opacity: alpha)
    }
}
