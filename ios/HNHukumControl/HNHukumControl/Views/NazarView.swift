import SwiftUI

struct NazarView: View {
    @EnvironmentObject private var settings: HukumSettings
    @EnvironmentObject private var nazar: NazarAppModel
    @Environment(\.openURL) private var openURL

    private let columns = [
        GridItem(.adaptive(minimum: 150), spacing: 10)
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    summaryPanel
                    quickActions
                    priorityCameras
                    degradedPanel
                    allCameras
                }
                .padding()
            }
            .navigationTitle("Nazar")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await nazar.refresh(includeFrames: true) }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(nazar.isRefreshing)
                }
            }
        }
    }

    private var summaryPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Circle()
                    .fill(statusColor)
                    .frame(width: 12, height: 12)
                Text(nazar.statusLine)
                    .font(.headline)
                Spacer()
            }
            Text(settings.isSecureNazar ? "Public Nazar" : "RTX private Nazar")
                .font(.caption)
                .foregroundStyle(settings.isSecureNazar ? .green : .orange)
            HStack(spacing: 10) {
                metric("HE", value: heMetric)
                metric("NCH", value: nchMetric)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color.secondary.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var quickActions: some View {
        HStack(spacing: 10) {
            Button {
                openBrand(.he)
            } label: {
                Label("Open HE", systemImage: "rectangle.inset.filled.and.person.filled")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            Button {
                openBrand(.nch)
            } label: {
                Label("Open NCH", systemImage: "cup.and.saucer.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
    }

    private var priorityCameras: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Priority Cameras")
                .font(.headline)
            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(NazarCamera.catalog.filter { $0.priority }) { camera in
                    cameraButton(camera)
                }
            }
        }
    }

    private var degradedPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Degraded Cameras")
                .font(.headline)
            if nazar.degradedStatuses.isEmpty && nazar.frozenCameraIds.isEmpty {
                Text("No degraded camera reported.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(degradedCameras) { camera in
                    Button {
                        openCamera(camera)
                    } label: {
                        HStack {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(.orange)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(camera.displayLabel)
                                    .font(.subheadline)
                                Text(nazar.status(for: camera))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "arrow.up.right.square")
                                .foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color.orange.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var allCameras: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("All Cameras")
                .font(.headline)
            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(NazarCamera.catalog) { camera in
                    cameraButton(camera)
                }
            }
        }
    }

    private func cameraButton(_ camera: NazarCamera) -> some View {
        Button {
            openCamera(camera)
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                cameraThumbnail(camera)
                HStack(spacing: 6) {
                    Image(systemName: nazar.isCameraDegraded(camera) ? "exclamationmark.triangle.fill" : "video.fill")
                        .font(.caption)
                        .foregroundStyle(nazar.isCameraDegraded(camera) ? .orange : .green)
                    Text(camera.displayLabel)
                        .font(.subheadline)
                        .lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "arrow.up.right.square")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(nazar.status(for: camera))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.secondary.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    // Live still-frame thumbnail. VERIFIED: /nz/latest.jpg?cam=<id> returns a
    // cached JPEG from the RTX box. Honest-degraded: when the camera is degraded
    // or frozen, we overlay its real state chip and dim the frame — we NEVER
    // present a stale/frozen frame as if it were live.
    @ViewBuilder
    private func cameraThumbnail(_ camera: NazarCamera) -> some View {
        let degraded = nazar.isCameraDegraded(camera)
        ZStack {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(Color.black.opacity(0.35))
            if let url = NazarClient.snapshotURL(for: camera, bust: nazar.frameTick) {
                AsyncImage(url: url, transaction: Transaction(animation: .easeInOut(duration: 0.2))) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .grayscale(degraded ? 1 : 0)
                            .opacity(degraded ? 0.45 : 1)
                    case .failure:
                        thumbPlaceholder(systemName: "wifi.slash", tint: .orange)
                    case .empty:
                        ProgressView()
                            .controlSize(.small)
                    @unknown default:
                        thumbPlaceholder(systemName: "video.slash", tint: .secondary)
                    }
                }
            } else {
                thumbPlaceholder(systemName: "video.slash", tint: .secondary)
            }
            if degraded {
                VStack {
                    Spacer()
                    HStack(spacing: 4) {
                        Image(systemName: "exclamationmark.triangle.fill")
                        Text(nazar.status(for: camera))
                            .lineLimit(1)
                    }
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .frame(maxWidth: .infinity)
                    .background(Color.orange.opacity(0.85))
                }
            }
        }
        .frame(height: 90)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }

    private func thumbPlaceholder(systemName: String, tint: Color) -> some View {
        Image(systemName: systemName)
            .font(.title3)
            .foregroundStyle(tint)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func metric(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.black.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var degradedCameras: [NazarCamera] {
        let statusIds = Set(nazar.degradedStatuses.map(\.camera.id))
        let ids = statusIds.union(nazar.frozenCameraIds)
        return NazarCamera.catalog.filter { ids.contains($0.id) }
    }

    private var heMetric: String {
        let people = nazar.heLive?.livePeople ?? 0
        let bills = nazar.heLive?.billsTotal ?? 0
        return "\(people) live, \(bills) bills"
    }

    private var nchMetric: String {
        let orders = nazar.nchLive?.orders ?? 0
        let sales = nazar.nchLive?.sales ?? 0
        return "\(orders) orders, Rs \(sales)"
    }

    private var statusColor: Color {
        switch nazar.healthColorName {
        case "green": return .green
        case "orange": return .orange
        default: return .gray
        }
    }

    private func openCamera(_ camera: NazarCamera) {
        guard let url = NazarClient.deepLinkURL(for: camera) else { return }
        openURL(url)
    }

    private func openBrand(_ brand: NazarBrand) {
        guard let url = NazarClient.brandURL(brand) else { return }
        openURL(url)
    }
}
