import SwiftUI

enum TakhtTheme {
    static let bg       = Color(hex: 0x0A0A07)
    static let bgElev   = Color(hex: 0x141208)
    static let card     = Color(hex: 0x1C1A0E)
    static let cardHi   = Color(hex: 0x252210)
    static let line     = Color(hex: 0x3A361A)
    static let text     = Color(hex: 0xF4EEE0)
    static let textDim  = Color(hex: 0xB0A378)
    static let textFaint = Color(hex: 0x7A6E4A)
    static let accent   = Color(hex: 0xC8964A)
    static let green    = Color(hex: 0x7FDC8A)
    static let amber    = Color(hex: 0xE0A33C)
    static let red      = Color(hex: 0xFFB4A0)
    static let radius: CGFloat = 18
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

extension String {
    func capForDisplay(_ max: Int = 60) -> String {
        count > max ? String(prefix(max)) + "…" : self
    }
}
