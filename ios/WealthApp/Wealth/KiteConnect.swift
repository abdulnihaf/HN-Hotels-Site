import SwiftUI
import SafariServices

struct KiteURLItem: Identifiable { let id = UUID(); let url: URL }

/// In-app Safari that SHARES cookies with Safari — so if you're already logged into
/// kite.zerodha.com it's a one-tap Authorize.
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

/// "Connect Kite" button. Opens Zerodha's login (the one unavoidable web step), then
/// POLLS the server connection status while the sheet is open and AUTO-CLOSES the sheet
/// the instant the token is stored — so you never land on the web dashboard / key page.
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

    /// While the login sheet is open, check status every 2s (up to ~5 min). The moment Kite
    /// reports connected (token stored server-side after Authorize), dismiss the sheet.
    private func startPolling() {
        poll?.cancel()
        poll = Task {
            for _ in 0..<150 {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                if Task.isCancelled { return }
                if let st = try? await WealthClient.shared.kiteStatus(), st.connected == true {
                    await MainActor.run { sheet = nil }   // dismiss → onDismiss refreshes
                    return
                }
            }
        }
    }
}
