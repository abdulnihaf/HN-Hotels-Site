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

// ─────────────────────────────────────────────────────────────────────────────
//  LIQUID GLASS (iOS 26) — with a flat warm-brown fallback for iOS < 26.
//  The whole point: glass is the FLOATING control/hero layer that refracts the
//  light behind it. It is NOT a skin for dense teaching text (that stays solid
//  + legible). One availability guard lives here so the cockpit degrades to the
//  original solid card on older OS / unsupported render — NO regression.
// ─────────────────────────────────────────────────────────────────────────────

@available(iOS 26.0, *)
private func hkGlassConfig(tint: Color?, interactive: Bool) -> Glass {
    var g: Glass = .regular
    if let tint { g = g.tint(tint) }
    if interactive { g = g.interactive() }
    return g
}

extension View {
    /// Liquid Glass over an arbitrary shape (iOS 26), else the flat solid card.
    @ViewBuilder
    func hkGlass<S: Shape>(_ shape: S,
                           tint: Color? = nil,
                           interactive: Bool = false,
                           fallbackFill: Color = HK.card,
                           fallbackStroke: Color = HK.line,
                           fallbackStrokeWidth: CGFloat = 1) -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(hkGlassConfig(tint: tint, interactive: interactive), in: shape)
        } else {
            self.background(shape.fill(fallbackFill))
                .overlay(shape.stroke(fallbackStroke, lineWidth: fallbackStrokeWidth))
        }
    }

    /// Convenience: rounded-rectangle glass (the common card / tile case).
    @ViewBuilder
    func hkGlass(cornerRadius: CGFloat = HK.radius,
                 tint: Color? = nil,
                 interactive: Bool = false,
                 fallbackFill: Color = HK.card,
                 fallbackStroke: Color = HK.line,
                 fallbackStrokeWidth: CGFloat = 1) -> some View {
        hkGlass(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous),
                tint: tint, interactive: interactive,
                fallbackFill: fallbackFill, fallbackStroke: fallbackStroke,
                fallbackStrokeWidth: fallbackStrokeWidth)
    }
}

/// Groups adjacent glass so they blend / morph and render as one batch (perf).
/// Pass-through on iOS < 26.
@ViewBuilder
func HKGlassGroup<Content: View>(spacing: CGFloat = 10, @ViewBuilder _ content: () -> Content) -> some View {
    if #available(iOS 26.0, *) {
        GlassEffectContainer(spacing: spacing) { content() }
    } else {
        content()
    }
}

/// A faint luminance wash so glass has light to refract over the near-black
/// cockpit. Respects Reduce Transparency (collapses to the plain bg).
struct HKAurora: View {
    var tint: Color = HK.accent
    var secondary: Color = HK.running
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    var body: some View {
        ZStack {
            HK.bg
            if !reduceTransparency {
                RadialGradient(colors: [tint.opacity(0.22), .clear],
                               center: .topLeading, startRadius: 6, endRadius: 380)
                RadialGradient(colors: [secondary.opacity(0.12), .clear],
                               center: .bottomTrailing, startRadius: 6, endRadius: 460)
            }
        }
    }
}
