import SwiftUI

struct CommsBackdrop: View {
    var body: some View {
        ZStack {
            platformGroupedBackground
            LinearGradient(
                colors: [
                    Color.teal.opacity(0.18),
                    Color.indigo.opacity(0.12),
                    Color.orange.opacity(0.10),
                    platformGroupedBackground
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
        }
    }
}

private var platformGroupedBackground: Color {
    #if os(macOS)
    Color(nsColor: .windowBackgroundColor)
    #else
    Color(.systemGroupedBackground)
    #endif
}

struct CommsGlassModifier: ViewModifier {
    let cornerRadius: CGFloat
    let tint: Color
    let interactive: Bool

    func body(content: Content) -> some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            content
                .glassEffect(
                    interactive
                    ? .regular.tint(tint.opacity(0.18)).interactive()
                    : .regular.tint(tint.opacity(0.14)),
                    in: .rect(cornerRadius: cornerRadius)
                )
        } else {
            content
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .stroke(tint.opacity(0.18), lineWidth: 1)
                }
        }
    }
}

extension View {
    func commsGlass(cornerRadius: CGFloat = 20, tint: Color = .teal, interactive: Bool = false) -> some View {
        modifier(CommsGlassModifier(cornerRadius: cornerRadius, tint: tint, interactive: interactive))
    }

    @ViewBuilder
    func commsGlassContainer<Content: View>(
        spacing: CGFloat = 16,
        @ViewBuilder content: () -> Content
    ) -> some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) {
                content()
            }
        } else {
            content()
        }
    }
}

func brandColor(for brand: String) -> Color {
    switch brand {
    case "he": .indigo
    case "nch": .green
    case "sparksol": .orange
    default: .teal
    }
}

func brandInitials(for brand: String) -> String {
    switch brand {
    case "he": "HE"
    case "nch": "NCH"
    case "sparksol": "SP"
    default: String(brand.prefix(2)).uppercased()
    }
}
