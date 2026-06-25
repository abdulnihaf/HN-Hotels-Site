import SwiftUI
import AVKit

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
            CameraFullscreenView(cam: cam)
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

// MARK: — Thumbnail card
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

// MARK: — Fullscreen live view + DVR rewind
struct CameraFullscreenView: View {
    let cam: NazarCamera
    @Environment(\.dismiss) private var dismiss

    @State private var streamURL: URL?
    @State private var rewindLabel: String?     // non-nil while watching a rewind
    @State private var busy = false
    @State private var errorText: String?

    private let rewindOptions: [(String, Int)] = [("-1m", 1), ("-5m", 5), ("-15m", 15)]

    var body: some View {
        ZStack(alignment: .topTrailing) {
            HK.bg.ignoresSafeArea()

            if let url = streamURL {
                VideoPlayerView(url: url).ignoresSafeArea().id(url)
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle").font(.system(size: 40)).foregroundColor(HK.warn)
                    Text(errorText ?? "No stream URL").foregroundColor(HK.text)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            // Top bar: name + close
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    if cam.isDead {
                        Text("DEAD → BACKUP").font(.system(size: 10, weight: .black)).foregroundColor(HK.error)
                    }
                    Text(cam.label).font(.system(size: 16, weight: .semibold)).foregroundColor(HK.text)
                    if let r = rewindLabel {
                        Text("REWIND · from \(r)").font(.system(size: 11, weight: .semibold)).foregroundColor(HK.warn)
                    }
                }
                .padding(12)
                .background(Color.black.opacity(0.5))
                .clipShape(RoundedRectangle(cornerRadius: HK.radiusSm))

                Spacer()

                Button { Task { await stopAndClose() } } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 28)).foregroundColor(HK.text.opacity(0.85))
                }
                .padding(16)
            }
            .padding(.top, 60)

            // Bottom: rewind controls
            VStack {
                Spacer()
                HStack(spacing: 8) {
                    rewindButton(title: "LIVE", isLive: true) { await goLive() }
                    ForEach(rewindOptions, id: \.0) { opt in
                        rewindButton(title: opt.0, isLive: false) { await rewind(mins: opt.1) }
                    }
                    if busy { ProgressView().tint(HK.accent).scaleEffect(0.8).padding(.leading, 4) }
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(Capsule().fill(Color.black.opacity(0.55)))
                .padding(.bottom, 40)
                if let e = errorText {
                    Text(e).font(.system(size: 11)).foregroundColor(HK.warn)
                        .padding(.bottom, 24).multilineTextAlignment(.center).padding(.horizontal, 30)
                }
            }
        }
        .onAppear { streamURL = NazarURL.streamURL(for: cam.liveFeedId) }
    }

    private func rewindButton(title: String, isLive: Bool, _ action: @escaping () async -> Void) -> some View {
        let isActiveLive = isLive && rewindLabel == nil
        let color: Color = isActiveLive ? HK.ok : (isLive ? HK.textDim : HK.warn)
        return Button { Task { await action() } } label: {
            Text(title)
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .foregroundColor(color)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(Capsule().fill(color.opacity(0.16)))
        }
        .disabled(busy)
    }

    private func rewind(mins: Int) async {
        busy = true; errorText = nil
        do {
            let from = try await NazarClient.shared.rewindStart(cam: cam.liveFeedId, mins: mins)
            rewindLabel = from
            streamURL = NazarURL.rewindStreamURL
        } catch {
            errorText = error.localizedDescription
        }
        busy = false
    }

    private func goLive() async {
        guard rewindLabel != nil else { return }
        busy = true
        await NazarClient.shared.rewindStop()
        rewindLabel = nil
        streamURL = NazarURL.streamURL(for: cam.liveFeedId)
        busy = false
    }

    private func stopAndClose() async {
        if rewindLabel != nil { await NazarClient.shared.rewindStop() }
        dismiss()
    }
}

// MARK: — AVPlayer wrapper
struct VideoPlayerView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let vc = AVPlayerViewController()
        vc.player = AVPlayer(url: url)
        vc.showsPlaybackControls = false
        vc.videoGravity = .resizeAspectFill
        vc.player?.play()
        return vc
    }

    func updateUIViewController(_ vc: AVPlayerViewController, context: Context) {
        let current = (vc.player?.currentItem?.asset as? AVURLAsset)?.url
        if current != url {
            vc.player?.replaceCurrentItem(with: AVPlayerItem(url: url))
            vc.player?.play()
        }
    }
}
