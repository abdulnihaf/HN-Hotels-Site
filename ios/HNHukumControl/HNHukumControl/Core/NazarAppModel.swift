import Foundation
import Combine

@MainActor
final class NazarAppModel: ObservableObject {
    @Published var health: NazarHealthResponse?
    @Published var heLive: NazarHELiveResponse?
    @Published var nchLive: NazarNCHLiveResponse?
    @Published var flags: NazarFlagsResponse?
    @Published var frameStatuses: [String: NazarFrameStatus] = [:]
    @Published var statusLine = "Nazar not checked"
    @Published var isRefreshing = false
    // Monotonic tick bumped on every refresh — used to cache-bust thumbnail
    // AsyncImage loads so they re-fetch a fresh frame instead of a stale cache.
    @Published var frameTick = 0

    private var pollTask: Task<Void, Never>?
    private var lastDegradedSignature = UserDefaults.standard.string(forKey: "nazar.lastDegradedSignature") ?? ""

    var frozenCameraIds: Set<String> {
        Set(health?.frozen ?? [])
    }

    var degradedStatuses: [NazarFrameStatus] {
        frameStatuses.values
            .filter { $0.isDegraded || frozenCameraIds.contains($0.camera.id) }
            .sorted { $0.camera.displayLabel < $1.camera.displayLabel }
    }

    var healthColorName: String {
        if health?.camsOk == true && degradedStatuses.isEmpty { return "green" }
        if health == nil { return "gray" }
        return "orange"
    }

    var degradedCameraCount: Int {
        var ids = Set(degradedStatuses.map(\.camera.id))
        ids.formUnion(frozenCameraIds)
        return ids.count
    }

    func bootstrap() async {
        await refresh(includeFrames: true)
        startPolling()
    }

    func refresh(includeFrames: Bool = true) async {
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            async let healthTask = NazarClient.shared.health()
            async let heTask = NazarClient.shared.heLive()
            async let nchTask = NazarClient.shared.nchLive()
            async let flagsTask = NazarClient.shared.heFlags()
            health = try await healthTask
            heLive = try await heTask
            nchLive = try await nchTask
            flags = try await flagsTask
            if includeFrames {
                await refreshFrames()
                frameTick &+= 1
            }
            statusLine = makeStatusLine()
            processDegradedNotifications()
            HukumLiveActivityController.shared.updateNazar(state: healthColorName.uppercased(), event: statusLine)
        } catch {
            statusLine = "Nazar error: \(error.localizedDescription)"
            HukumLog.shared.add(statusLine)
            HukumLiveActivityController.shared.updateNazar(state: "RED", event: "Nazar unreachable")
        }
    }

    func status(for camera: NazarCamera) -> String {
        if frozenCameraIds.contains(camera.id) { return "frozen" }
        return frameStatuses[camera.id]?.displayState ?? "not checked"
    }

    func isCameraDegraded(_ camera: NazarCamera) -> Bool {
        frozenCameraIds.contains(camera.id) || (frameStatuses[camera.id]?.isDegraded ?? false)
    }

    private func refreshFrames() async {
        await withTaskGroup(of: NazarFrameStatus?.self) { group in
            for camera in NazarCamera.catalog {
                group.addTask {
                    try? await NazarClient.shared.frameStatus(for: camera)
                }
            }
            var next: [String: NazarFrameStatus] = [:]
            for await status in group {
                if let status { next[status.camera.id] = status }
            }
            frameStatuses = next
        }
    }

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                await self?.refresh(includeFrames: false)
            }
        }
    }

    private func makeStatusLine() -> String {
        let up = health?.camsUp ?? 0
        let total = health?.camsTotal ?? 0
        let active = flags?.nActive ?? 0
        let degraded = degradedCameraCount
        if degraded > 0 {
            return "\(up)/\(total) cams, \(degraded) degraded, \(active) HE flags"
        }
        return "\(up)/\(total) cams ok, \(active) HE flags"
    }

    private func processDegradedNotifications() {
        let names = degradedStatuses.map { $0.camera.displayLabel + ":" + $0.displayState }
        let signature = names.joined(separator: "|")
        guard !signature.isEmpty, signature != lastDegradedSignature else { return }
        lastDegradedSignature = signature
        UserDefaults.standard.set(signature, forKey: "nazar.lastDegradedSignature")
        HukumNotificationController.shared.notifyNazarDegraded(
            title: "Nazar camera degraded",
            body: names.prefix(3).joined(separator: ", "),
            key: String(signature.hashValue)
        )
    }
}
