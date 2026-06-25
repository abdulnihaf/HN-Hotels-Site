import Foundation

// RTX private (Tailscale) is primary; public CF-Access path is fallback when off-network.
// App server on :8080, host go2rtc streams on :1985.
enum NazarURL {
    static let appBase     = "http://100.107.54.16:8080"  // nazar_srv: /nz/* API + snapshots
    static let streamBase  = "http://100.107.54.16:1985"  // host go2rtc: live (WebRTC/MSE/MP4), H.264 NVENC
    static let rewindBase  = "http://100.107.54.16:1984"  // container go2rtc: rw_live (DVR playback)
    static let publicBase  = "https://nazar.hnhotels.in"

    // video=h264 forces the CUDA H.264 producer (proven path in ~/nazar/fs.js).
    // video=copy can hand AVPlayer an HEVC substream that black-screens, so never use copy.
    static func streamURL(for cam: String) -> URL? {
        URL(string: "\(streamBase)/api/stream.mp4?src=\(cam)&video=h264")
    }

    // DVR rewind plays through the server-managed go2rtc stream named rw_live.
    static var rewindStreamURL: URL? {
        URL(string: "\(streamBase)/api/stream.mp4?src=rw_live&video=h264")
    }

    static func frameURL(for cam: String) -> URL? {
        URL(string: "\(appBase)/nz/latest.jpg?cam=\(cam)")
    }
}

// 16-camera roster matching the live RTX go2rtc config (verified 2026-06-25).
// isDead = physical camera offline → its live feed is served via a backup camera.
struct NazarCamera: Identifiable, Hashable {
    let id: String        // go2rtc / Frigate camera name
    let label: String
    let brand: String     // "HE" or "NCH"
    let isDead: Bool

    // Dead → backup live feed (only the two physically-down cameras have a mapping).
    var liveFeedId: String {
        switch id {
        case "he_first_floor_dinein": return "he_first_floor_dinein_2"
        case "nch_outdoor_chai":      return "nch_outdoor_2"
        default:                      return id
        }
    }
}

let allCameras: [NazarCamera] = [
    // HE — 9 cameras
    NazarCamera(id: "he_cash_counter",          label: "Cash Counter",          brand: "HE",  isDead: false),
    NazarCamera(id: "he_ground_floor_dinein",   label: "Ground Floor",          brand: "HE",  isDead: false),
    NazarCamera(id: "he_first_floor_dinein",    label: "1st Floor (primary)",   brand: "HE",  isDead: true),
    NazarCamera(id: "he_first_floor_dinein_2",  label: "1st Floor (backup)",    brand: "HE",  isDead: false),
    NazarCamera(id: "he_kitchen_pass",          label: "Kitchen Pass",          brand: "HE",  isDead: false),
    NazarCamera(id: "he_main_kitchen_door",     label: "Main Kitchen Door",     brand: "HE",  isDead: false),
    NazarCamera(id: "he_main_kitchen_2",        label: "Main Kitchen 2",        brand: "HE",  isDead: false),
    NazarCamera(id: "he_fried_chicken_kitchen", label: "Fried Chicken Kitchen", brand: "HE",  isDead: false),
    NazarCamera(id: "he_outdoor",               label: "Outdoor",               brand: "HE",  isDead: false),
    // NCH — 7 cameras
    NazarCamera(id: "nch_cash_counter",         label: "Cash Counter",          brand: "NCH", isDead: false),
    NazarCamera(id: "nch_chai_counter",         label: "Chai Counter",          brand: "NCH", isDead: false),
    NazarCamera(id: "nch_full_outlet",          label: "Full Outlet",           brand: "NCH", isDead: false),
    NazarCamera(id: "nch_full_outlet_entrance", label: "Entrance",              brand: "NCH", isDead: false),
    NazarCamera(id: "nch_kitchen",              label: "Kitchen",               brand: "NCH", isDead: false),
    NazarCamera(id: "nch_outdoor_chai",         label: "Outdoor Chai (primary)",brand: "NCH", isDead: true),
    NazarCamera(id: "nch_outdoor_2",            label: "Outdoor (backup)",      brand: "NCH", isDead: false),
]
