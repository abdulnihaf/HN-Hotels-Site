import SwiftUI
import WebKit

struct NazarCamerasView: View {
    @State private var brand: String = "HE"
    @State private var selectedCam: NazarCamera?

    private var filtered: [NazarCamera] { allCameras.filter { $0.brand == brand } }

    var body: some View {
        VStack(spacing: 0) {
            brandPicker
            ScrollView {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    ForEach(filtered) { cam in
                        CameraThumbView(cam: cam)
                            .onTapGesture { selectedCam = cam }
                    }
                }
                .padding(12)
            }
        }
        .background(HK.bg.ignoresSafeArea())
        .fullScreenCover(item: $selectedCam) { cam in
            NazarLiveFullscreen(startCam: cam) { selectedCam = nil }
        }
    }

    private var brandPicker: some View {
        HStack(spacing: 0) {
            ForEach(["HE", "NCH"], id: \.self) { b in
                Button { brand = b } label: {
                    Text(b)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(brand == b ? HK.text : HK.textDim)
                        .frame(maxWidth: .infinity).padding(.vertical, 10)
                        .background(brand == b ? HK.card : Color.clear)
                }
            }
        }
        .background(HK.bgElev)
        .overlay(Rectangle().frame(height: 1).foregroundColor(HK.line), alignment: .bottom)
    }
}

// MARK: — Thumbnail card (auto-loads a live JPEG snapshot)
struct CameraThumbView: View {
    let cam: NazarCamera
    @State private var image: UIImage?
    @State private var loadError = false

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Group {
                if let img = image {
                    Image(uiImage: img).resizable().aspectRatio(16.0/9.0, contentMode: .fill)
                } else if loadError {
                    Rectangle().fill(HK.card)
                        .overlay(Image(systemName: "camera.fill").foregroundColor(HK.line).font(.system(size: 24)))
                        .aspectRatio(16.0/9.0, contentMode: .fill)
                } else {
                    Rectangle().fill(HK.card)
                        .overlay(ProgressView().tint(HK.accent))
                        .aspectRatio(16.0/9.0, contentMode: .fill)
                }
            }
            .clipped()

            VStack(alignment: .leading, spacing: 2) {
                if cam.isDead {
                    Text("DEAD → BACKUP")
                        .font(.system(size: 8, weight: .black)).foregroundColor(HK.error)
                        .padding(.horizontal, 5).padding(.vertical, 2)
                        .background(Capsule().fill(HK.error.opacity(0.25)))
                }
                Text(cam.label)
                    .font(.system(size: 11, weight: .semibold)).foregroundColor(HK.text).lineLimit(1)
            }
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(LinearGradient(colors: [.black.opacity(0.7), .clear], startPoint: .bottom, endPoint: .top))
        }
        .clipShape(RoundedRectangle(cornerRadius: HK.radiusSm))
        .overlay(RoundedRectangle(cornerRadius: HK.radiusSm).stroke(cam.isDead ? HK.error.opacity(0.4) : HK.line, lineWidth: 1))
        .task { await fetchFrame() }
    }

    private func fetchFrame() async {
        do {
            let data = try await NazarClient.shared.fetchFrame(cam: cam.liveFeedId)
            image = UIImage(data: data)
        } catch {
            loadError = true
        }
    }
}

// MARK: — Fullscreen live (WebRTC player) — landscape, swipe carousel, rewind
struct NazarLiveFullscreen: View {
    let startCam: NazarCamera
    let onClose: () -> Void

    var body: some View {
        NazarPlayerWebView(startCam: startCam, onClose: onClose)
            .ignoresSafeArea()
            .background(Color.black.ignoresSafeArea())
            .onAppear { OrientationGate.set(.landscapeRight) }
            .onDisappear { OrientationGate.set(.portrait) }
    }
}

// MARK: — WKWebView hosting the bundled go2rtc adaptive player
struct NazarPlayerWebView: UIViewRepresentable {
    let startCam: NazarCamera
    let onClose: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onClose: onClose) }

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true                       // keep video in our layout, not Apple's player
        cfg.mediaTypesRequiringUserActionForPlayback = []          // autoplay live
        cfg.allowsAirPlayForMediaPlayback = false

        // Inject the player config (camera list + RTX endpoints) before the page script runs.
        let userContent = WKUserContentController()
        userContent.add(context.coordinator, name: "nazar")
        userContent.addUserScript(WKUserScript(source: configJS(),
                                               injectionTime: .atDocumentStart,
                                               forMainFrameOnly: true))
        cfg.userContentController = userContent

        let web = WKWebView(frame: .zero, configuration: cfg)
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        context.coordinator.web = web

        // Player is a compiled string (not a bundle resource) — avoids the codesign provenance-xattr
        // deadlock on App Store export. baseURL gives a sane http origin for the WebSocket/WebRTC.
        web.loadHTMLString(nazarPlayerHTML, baseURL: URL(string: NazarURL.appBase))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        // Guarantee teardown on ANY dismiss (close button OR swipe-down): stop rewind + drop all stream consumers.
        uiView.evaluateJavaScript("window.nazarTeardown && window.nazarTeardown()")
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "nazar")
    }

    // Build window.__nazarConfig with the full 16-camera carousel + the tapped camera as start index.
    private func configJS() -> String {
        let cams = allCameras.map { c -> [String: String] in
            [
                "id": c.id,
                "label": c.label,
                "liveId": c.liveFeedId,
                "note": c.isDead ? "Primary \(c.label) offline — showing backup feed" : ""
            ]
        }
        let startIndex = allCameras.firstIndex(where: { $0.id == startCam.id }) ?? 0
        let cfg: [String: Any] = [
            "liveWs":        "\(NazarURL.streamBase)/api/ws",
            "rewindWs":      "\(NazarURL.rewindBase)/api/ws",
            "snap":          "\(NazarURL.appBase)/nz/latest.jpg",
            "rewindApi":     "\(NazarURL.appBase)/nz/rewind",
            "rewindStopApi": "\(NazarURL.appBase)/nz/rewind/stop",
            "cams": cams,
            "startIndex": startIndex
        ]
        let json = (try? JSONSerialization.data(withJSONObject: cfg))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return "window.__nazarConfig = \(json);"
    }

    final class Coordinator: NSObject, WKScriptMessageHandler {
        let onClose: () -> Void
        weak var web: WKWebView?
        init(onClose: @escaping () -> Void) { self.onClose = onClose }

        func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "nazar",
                  let body = message.body as? [String: Any],
                  (body["action"] as? String) == "close" else { return }
            DispatchQueue.main.async { self.onClose() }
        }
    }
}

// MARK: — Orientation (scoped to the player; restored on dismiss)
enum OrientationGate {
    static func set(_ mask: UIInterfaceOrientationMask) {
        guard let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive }) else { return }
        if #available(iOS 16.0, *) {
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { _ in }
        }
    }
}
