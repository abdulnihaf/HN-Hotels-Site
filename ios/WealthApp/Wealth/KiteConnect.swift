import SwiftUI
import SafariServices

struct KiteURLItem: Identifiable { let id = UUID(); let url: URL }

/// In-app Safari shares Safari cookies, so an already logged-in Kite session is usually
/// one tap, but it does not dump the owner into Chrome/default browser.
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let c = SFSafariViewController.Configuration()
        c.entersReaderIfAvailable = false
        let vc = SFSafariViewController(url: url, configuration: c)
        vc.dismissButtonStyle = .done
        return vc
    }

    func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}

/// "Connect Kite" opens Zerodha's required OAuth page inside Wealth, then polls the
/// server and auto-closes the sheet the moment the backend stores a valid Kite token.
struct KiteConnectButton: View {
    @ObservedObject var vm: WealthVM
    var label: String = "Connect Kite"
    @State private var sheet: KiteURLItem?
    @State private var loading = false
    @State private var poll: Task<Void, Never>?

    var body: some View {
        Button {
            loading = true
            Task {
                let resolved = await WealthClient.shared.kiteLoginURL()
                await MainActor.run {
                    loading = false
                    sheet = KiteURLItem(url: resolved ?? URL(string: "https://trade.hnhotels.in/wealth/auth/login")!)
                    startPolling()
                }
            }
        } label: {
            Text(loading ? "Opening…" : label)
                .font(.system(size: 15, weight: .bold)).foregroundColor(HK.bg)
                .frame(maxWidth: .infinity).padding(.vertical, 12)
                .background(RoundedRectangle(cornerRadius: HK.radiusSm).fill(HK.accent))
        }
        .sheet(item: $sheet, onDismiss: {
            poll?.cancel()
            Task { await vm.refresh() }
        }) { item in
            SafariView(url: item.url).ignoresSafeArea()
        }
    }

    /// Poll while the login sheet is open; dismiss as soon as the server has a live Kite token.
    private func startPolling() {
        poll?.cancel()
        poll = Task {
            for _ in 0..<150 {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                if Task.isCancelled { return }
                if let st = try? await WealthClient.shared.kiteStatus(), st.connected == true {
                    await MainActor.run { sheet = nil }
                    return
                }
            }
        }
    }
}
