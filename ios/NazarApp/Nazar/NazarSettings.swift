import Foundation

// RTX private (Tailscale) is primary; public CF-Access path is fallback when off-network.
// App server on :8080, host go2rtc streams on :1985.
enum NazarURL {
    static let appBase     = "http://100.107.54.16:8080"
    static let streamBase  = "http://100.107.54.16:1985"  // host go2rtc, H.264/MP4
    static let publicBase  = "https://nazar.hnhotels.in"

    static func streamURL(for cam: String) -> URL? {
        URL(string: "\(streamBase)/api/stream.mp4?video=copy&src=\(cam)")
    }

    static func frameURL(for cam: String) -> URL? {
        URL(string: "\(appBase)/nz/latest.jpg?cam=\(cam)")
    }
}

// Hardcoded 16-camera roster matching RTX go2rtc config.
// backup_cam entries are prefixed with "‼" label so the grid shows them honestly.
struct NazarCamera: Identifiable, Hashable {
    let id: String        // go2rtc / Frigate camera name
    let label: String
    let brand: String     // "HE" or "NCH"
    let isDead: Bool      // physical camera offline → serves via backup
}

let allCameras: [NazarCamera] = [
    // HE cameras
    NazarCamera(id: "he_cash_counter",          label: "HE Cash Counter",    brand: "HE",  isDead: false),
    NazarCamera(id: "he_ground_floor_dinein",   label: "HE Ground Floor",    brand: "HE",  isDead: false),
    NazarCamera(id: "he_first_floor_dinein",    label: "HE 1F (primary)",    brand: "HE",  isDead: true),
    NazarCamera(id: "he_first_floor_dinein_2",  label: "HE 1F Backup",       brand: "HE",  isDead: false),
    NazarCamera(id: "he_outdoor",               label: "HE Outdoor",         brand: "HE",  isDead: false),
    NazarCamera(id: "he_kitchen_pass",          label: "HE Kitchen Pass",    brand: "HE",  isDead: false),
    // NCH cameras
    NazarCamera(id: "nch_cash_counter",         label: "NCH Cash Counter",   brand: "NCH", isDead: false),
    NazarCamera(id: "nch_chai_counter",         label: "NCH Chai Counter",   brand: "NCH", isDead: false),
    NazarCamera(id: "nch_full_outlet",          label: "NCH Full Outlet",    brand: "NCH", isDead: false),
    NazarCamera(id: "nch_full_outlet_entrance", label: "NCH Entrance",       brand: "NCH", isDead: false),
    NazarCamera(id: "nch_outdoor_chai",         label: "NCH Outdoor (dead)", brand: "NCH", isDead: true),
    NazarCamera(id: "nch_outdoor_2",            label: "NCH Outdoor Backup", brand: "NCH", isDead: false),
]
