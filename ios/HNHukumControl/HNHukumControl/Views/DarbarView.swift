import SwiftUI
import WebKit

// Darbar — "the Court". The native chamber is a thin shell hosting the LIVE deployed PWA
// (https://darbar.hnhotels.in/ops/darbar/). Owner-directed (2026-06-20): tapping Darbar in the
// Diwan must open EXACTLY the deployed app — all four tabs (Today / Attendance / Pay / Roster),
// every sheet and action (settle · advance · set-pay · onboard · fix-punch · mark-left …), salary
// recording included. We reuse the real build instead of re-porting it, so nothing is lost or
// mis-copied.
//
// The one native job: mint the shared Diwan token (DarbarAppModel) and inject it into the page's
// sessionStorage BEFORE its scripts run, so the PWA's auto() enters straight past its own PIN gate.
// No per-chamber login screen (DIWAN-IOS-CONTRACT §4). The full screen is the PWA; the only native
// chrome is a back affordance to return to the Diwan, sized to sit in the PWA's empty top-left slot.
struct DarbarView: View {
    @StateObject private var model = DarbarAppModel()
    @Environment(\.dismiss) private var dismiss
    private let accent = Color(hex: 0x5B86C9)   // Darbar blue

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.ignoresSafeArea()   // matches the PWA's black so there is no seam

            switch model.phase {
            case .loading:
                loadingState
            case .locked:
                lockedState
            case .offline:
                offlineState
            case .ready:
                if let token = model.token, let user = model.userJSONBase64 {
                    DarbarWebHost(url: model.appURL, token: token, userJSONBase64: user,
                                  onLoadFailed: { model.markOffline() })
                        .ignoresSafeArea()
                } else {
                    lockedState
                }
            }

            backButton   // always reachable — returns to the Diwan
        }
        .navigationBarHidden(true)
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.prepare() }
    }

    // The single piece of native chrome — a small back chip in the PWA's empty top-left nav slot.
    private var backButton: some View {
        Button { dismiss() } label: {
            Image(systemName: "chevron.left")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .background(.black.opacity(0.38), in: Circle())
                .overlay(Circle().stroke(.white.opacity(0.18), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .padding(.leading, 8)
        .padding(.top, 4)
        .accessibilityLabel("Back to Diwan")
    }

    // MARK: native states (black, to blend with the PWA — the only moments without the web app)

    private var loadingState: some View {
        VStack(spacing: 14) {
            Spacer()
            Text("Darbar")
                .font(.system(size: 30, weight: .heavy, design: .rounded))
                .foregroundStyle(.white)
            ProgressView().tint(accent)
            Text(model.statusLine).font(.system(size: 13)).foregroundStyle(.white.opacity(0.55))
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var lockedState: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "lock.fill").font(.system(size: 30)).foregroundStyle(accent)
            Text("Court locked").font(.system(size: 17, weight: .bold)).foregroundStyle(.white)
            Text("Unlock from the Diwan home to hold court.")
                .font(.system(size: 13)).foregroundStyle(.white.opacity(0.6))
                .multilineTextAlignment(.center)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity).padding(.horizontal, 36)
    }

    private var offlineState: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "wifi.exclamationmark").font(.system(size: 30)).foregroundStyle(HK.error)
            Text("Can't reach the court").font(.system(size: 17, weight: .bold)).foregroundStyle(.white)
            Text(model.statusLine).font(.system(size: 13)).foregroundStyle(.white.opacity(0.6))
                .multilineTextAlignment(.center)
            Button { Task { await model.retry() } } label: {
                Text("Retry").font(.system(size: 14, weight: .semibold)).foregroundStyle(.black)
                    .padding(.horizontal, 22).padding(.vertical, 10)
                    .background(accent, in: Capsule())
            }
            .padding(.top, 4)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity).padding(.horizontal, 36)
    }
}

// Hosts the deployed PWA. A document-start user-script seeds the minted token + user into
// sessionStorage so the page's own auto() enters past the gate; the page then makes every API call
// itself (same-origin, token in the x-darbar-token header). base64 injection avoids all escaping.
struct DarbarWebHost: UIViewRepresentable {
    let url: String
    let token: String
    let userJSONBase64: String
    let onLoadFailed: () -> Void

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true

        let inject = """
        (function(){try{
          sessionStorage.setItem('darbar_token','\(token)');
          sessionStorage.setItem('darbar_user', atob('\(userJSONBase64)'));
        }catch(e){}})();
        """
        cfg.userContentController.addUserScript(
            WKUserScript(source: inject, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )

        let wv = WKWebView(frame: .zero, configuration: cfg)
        wv.navigationDelegate = context.coordinator
        wv.isOpaque = false
        wv.backgroundColor = .black
        wv.scrollView.backgroundColor = .black
        wv.scrollView.contentInsetAdjustmentBehavior = .never   // the PWA owns its safe-area insets
        wv.allowsBackForwardNavigationGestures = false          // leave edge-swipe for the NavigationStack
        if let u = URL(string: url) { wv.load(URLRequest(url: u)) }
        return wv
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onFail: onLoadFailed) }

    final class Coordinator: NSObject, WKNavigationDelegate {
        let onFail: () -> Void
        init(onFail: @escaping () -> Void) { self.onFail = onFail }

        func webView(_ w: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            if (error as NSError).code != NSURLErrorCancelled { onFail() }
        }
        func webView(_ w: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            if (error as NSError).code != NSURLErrorCancelled { onFail() }
        }
    }
}
