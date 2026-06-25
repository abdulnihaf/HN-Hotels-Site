import SwiftUI
import AVKit

struct NazarCamerasView: View {
    @State private var brand: String = "HE"
    @State private var selectedCam: NazarCamera?

    private var filtered: [NazarCamera] {
        allCameras.filter { $0.brand == brand }
    }

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
                Button {
                    brand = b
                } label: {
                    Text(b)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(brand == b ? HK.text : HK.textDim)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
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
                    Image(uiImage: img)
                        .resizable()
                        .aspectRatio(16.0/9.0, contentMode: .fill)
                } else if loadError {
                    Rectangle()
                        .fill(HK.card)
                        .overlay(Image(systemName: "camera.fill").foregroundColor(HK.line).font(.system(size: 24)))
                        .aspectRatio(16.0/9.0, contentMode: .fill)
                } else {
                    Rectangle()
                        .fill(HK.card)
                        .overlay(ProgressView().tint(HK.accent))
                        .aspectRatio(16.0/9.0, contentMode: .fill)
                }
            }
            .clipped()

            // Label overlay
            VStack(alignment: .leading, spacing: 2) {
                if cam.isDead {
                    Text("DEAD")
                        .font(.system(size: 8, weight: .black))
                        .foregroundColor(HK.error)
                        .padding(.horizontal, 5).padding(.vertical, 2)
                        .background(Capsule().fill(HK.error.opacity(0.25)))
                }
                Text(cam.label)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(HK.text)
                    .lineLimit(1)
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
            let data = try await NazarClient.shared.fetchFrame(cam: cam.id)
            image = UIImage(data: data)
        } catch {
            loadError = true
        }
    }
}

// MARK: — Fullscreen live view (AVPlayer on go2rtc MP4 stream)
struct CameraFullscreenView: View {
    let cam: NazarCamera
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack(alignment: .topTrailing) {
            HK.bg.ignoresSafeArea()

            if let url = NazarURL.streamURL(for: cam.isDead ? backupId : cam.id) {
                VideoPlayerView(url: url)
                    .ignoresSafeArea()
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 40))
                        .foregroundColor(HK.warn)
                    Text("No stream URL")
                        .foregroundColor(HK.text)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            // Overlay: name + close
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    if cam.isDead {
                        Text("DEAD → BACKUP")
                            .font(.system(size: 10, weight: .black))
                            .foregroundColor(HK.error)
                    }
                    Text(cam.label)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(HK.text)
                }
                .padding(12)
                .background(Color.black.opacity(0.5))
                .clipShape(RoundedRectangle(cornerRadius: HK.radiusSm))

                Spacer()

                Button { dismiss() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 28))
                        .foregroundColor(HK.text.opacity(0.8))
                }
                .padding(16)
            }
            .padding(.top, 60)
        }
    }

    private var backupId: String {
        // Known dead→backup mappings
        switch cam.id {
        case "he_first_floor_dinein": return "he_first_floor_dinein_2"
        case "nch_outdoor_chai":      return "nch_outdoor_2"
        default: return cam.id
        }
    }
}

// MARK: — AVPlayer wrapper
struct VideoPlayerView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let vc = AVPlayerViewController()
        let player = AVPlayer(url: url)
        vc.player = player
        vc.showsPlaybackControls = false
        vc.videoGravity = .resizeAspectFill
        player.play()
        return vc
    }

    func updateUIViewController(_ uiViewController: AVPlayerViewController, context: Context) {
        if uiViewController.player?.currentItem?.asset is AVURLAsset {
            let asset = uiViewController.player?.currentItem?.asset as? AVURLAsset
            if asset?.url != url {
                uiViewController.player?.replaceCurrentItem(with: AVPlayerItem(url: url))
                uiViewController.player?.play()
            }
        }
    }
}
