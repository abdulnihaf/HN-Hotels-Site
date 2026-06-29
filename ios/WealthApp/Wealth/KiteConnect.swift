import SwiftUI

/// "Connect Kite" button. Opens Zerodha's login via the SYSTEM opener (openURL) so iOS
/// hands off DIRECTLY to the installed Kite app — one-tap "Authorize", no typing — and
/// only falls back to Safari if the Kite app isn't installed. (The previous version used
/// an in-app SFSafariViewController, which by design can never hand off to another app, so
/// it always showed the web login.) The access token is stored SERVER-SIDE the instant you
/// authorize, so the app just POLLS connection status and flips to "connected" on return.
struct KiteConnectButton: View {
    @ObservedObject var vm: WealthVM
    var label: String = "Connect Kite"
    @Environment(\.openURL) private var openURL
    @State private var loading = false
    @State private var poll: Task<Void, Never>?

    var body: some View {
        Button {
            loading = true
            Task {
                let resolved = await WealthClient.shared.kiteLoginURL()
                let url = resolved ?? URL(string: "https://trade.hnhotels.in/wealth/auth/login")!
                await MainActor.run {
                    loading = false
                    openURL(url)          // system open → hands off to the Kite app if installed
                    startPolling()
                }
            }
        } label: {
            Text(loading ? "Opening…" : label)
                .font(.system(size: 15, weight: .bold)).foregroundColor(HK.bg)
                .frame(maxWidth: .infinity).padding(.vertical, 12)
                .background(RoundedRectangle(cornerRadius: HK.radiusSm).fill(HK.accent))
        }
    }

    /// After you tap Authorize in the Kite app, the token is stored server-side. Poll status
    /// every 2s for ~5 min; the moment Kite reports connected, refresh the UI. The poll pauses
    /// while you're in the Kite app and resumes when you return to Wealth.
    private func startPolling() {
        poll?.cancel()
        poll = Task {
            for _ in 0..<150 {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                if Task.isCancelled { return }
                if let st = try? await WealthClient.shared.kiteStatus(), st.connected == true {
                    await vm.refresh()
                    return
                }
            }
        }
    }
}
