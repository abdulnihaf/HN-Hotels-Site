import SwiftUI

@MainActor
final class WatchModel: ObservableObject {
    @Published var balance: TakhtBalance?
    @Published var shift: TakhtShift?
    @Published var status = "Loading…"

    var handTotal: Double { balance?.total ?? 0 }

    var stateColor: Color {
        guard balance != nil else { return WatchTheme.textDim }
        return handTotal > 0 ? WatchTheme.green : WatchTheme.accent
    }

    func load() async {
        do {
            async let b = WatchTakhtClient.shared.balance()
            async let s = WatchTakhtClient.shared.shift()
            balance = (try? await b)?.balance
            shift   = (try? await s)?.current
            if let name = shift?.name {
                status = name
            } else if balance != nil {
                status = "NCH · settlement"
            } else {
                status = "Offline"
            }
        }
    }
}

struct WatchRootView: View {
    @StateObject private var model = WatchModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text("Takht")
                    .font(.system(size: 20, weight: .heavy, design: .serif))
                    .foregroundStyle(WatchTheme.accent)
                Text(model.status)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(WatchTheme.textDim)

                // Hand total — the number that matters
                handCard

                // Cashier / shift state
                if let sh = model.shift {
                    shiftCard(sh)
                }
            }
            .padding(10)
        }
        .background(WatchTheme.bg.ignoresSafeArea())
        .task { await model.load() }
    }

    private var handCard: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("In hand")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(WatchTheme.textDim)
            Text(TakhtFmt.rupee(model.handTotal))
                .font(.system(size: 26, weight: .heavy, design: .rounded))
                .foregroundStyle(model.stateColor)
            if let r = model.balance?.runnerCash, let c = model.balance?.counterCash {
                HStack(spacing: 4) {
                    Text("Run \(TakhtFmt.rupee(r))")
                    Text("·")
                    Text("Cash \(TakhtFmt.rupee(c))")
                }
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(WatchTheme.textDim)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WatchTheme.card, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(WatchTheme.line, lineWidth: 1))
    }

    private func shiftCard(_ sh: TakhtShift) -> some View {
        let days = (sh.shiftMinutes ?? 0) / 1440
        let c: Color = days > 1 ? WatchTheme.red : WatchTheme.green
        return VStack(alignment: .leading, spacing: 3) {
            Text(sh.name ?? "—")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(WatchTheme.text)
                .lineLimit(1)
            Text(days > 1 ? "POS open \(days)d — CLOSE" : "POS ok")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(c)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WatchTheme.card, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(c.opacity(0.5), lineWidth: 1))
    }
}
