import SwiftUI

// Inlined from the shared Hukum kit so the standalone Sauda app has zero dependency on it.
struct ChamberHeader: View {
    let title: String
    let subtitle: String
    var accent: Color = HK.accent
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 26, weight: .heavy, design: .rounded)).foregroundStyle(HK.text)
                Text(subtitle).font(.system(size: 13, weight: .medium)).foregroundStyle(HK.textDim).lineLimit(1)
            }
            Spacer()
            Circle().fill(accent).frame(width: 10, height: 10)
        }
        .padding(.horizontal, 18).padding(.top, 8).padding(.bottom, 12)
    }
}

enum SaudaFmt {
    static func rupee(_ v: Double?) -> String {
        let n = v ?? 0
        let f = NumberFormatter(); f.numberStyle = .decimal; f.maximumFractionDigits = 0
        return "₹" + (f.string(from: NSNumber(value: n)) ?? "0")
    }
}
