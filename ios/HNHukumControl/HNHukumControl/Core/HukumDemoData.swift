import Foundation

// Controllable sample data so the native UI can be designed against every state on the simulator,
// independent of a live bridge. Enabled with the launch argument `-hukumDemo`.
enum HukumDemoData {
    private static func latest(_ preview: String, ready: Bool) -> HukumLatestInfo {
        HukumLatestInfo(source: "transcript", hash: String(UUID().uuidString.prefix(12)),
                        jobId: "", meaningful: ready, note: "", preview: preview, finalized: ready)
    }

    private static func lane(_ slot: String, _ alias: String, _ title: String, _ app: String,
                             _ health: String, selected: Bool, age: Int, _ preview: String, ready: Bool) -> HukumLaneState {
        HukumLaneState(
            slot: slot, alias: alias, title: title, app: app,
            session: "\(alias).jsonl", selected: selected, available: true,
            healthState: health, healthNote: "",
            latest: latest(preview, ready: ready),
            transcript: HukumTranscriptInfo(mtime: nil, ageSeconds: age, pending: !ready,
                                            finalized: ready, finalHash: nil, liveHash: nil, lastUserPreview: nil),
            activeJob: nil, latestHukumJob: nil)
    }

    static let lanes: [HukumLaneState] = [
        lane("Chat 1", "ambar", "AMBAR app build", "claude", "ready", selected: true, age: 180,
             "Confirmed zero receipts written for PO 41. The rejected attempts touched no data, and the buns line is still clean and ready for a real receive.", ready: true),
        lane("Chat 2", "nazar", "Nazar app building", "codex", "running", selected: false, age: 40,
             "Phase 3 fluid-video repair shipped. All 16 streams have CUDA H.264 producers; HE cash counter poster at 250ms.", ready: false),
        lane("Chat 3", "sauda", "Sauda app build", "codex", "ready", selected: false, age: 600,
             "Rectified the orders day-filter — purchases tagged to both brands now show in both outlet views.", ready: true),
        lane("Chat 4", "naam", "Naam marketing", "kimi", "running", selected: false, age: 25,
             "Meta 7-day pull: ₹53 per 50 hands, 4.93% CTR. Drafting the next food-conviction creative set.", ready: false),
        lane("Chat 5", "phone", "Phone voice bridge", "claude", "ready", selected: false, age: 320,
             "Bridge healthy on 8790. Lane fetch, select, send and speak all verified end to end.", ready: true),
        lane("Chat 6", "profit", "HN daily P&L", "codex", "quiet", selected: false, age: 5400,
             "Hisaab is blocked until the opening count is refreshed — correct behaviour, not a bug.", ready: false),
    ]

    static let history: [HukumRouteHistory] = [
        HukumRouteHistory(id: "h1", ts: nil, source: "hukum", rawText: "Reply with exactly: CLAUDE LANE OK",
                          routedText: "Reply with exactly: CLAUDE LANE OK", target: "claude", mode: "new",
                          alias: "", title: "New Claude chat", session: "", routeNote: "Direct command endpoint",
                          jobId: "", status: "done", healthState: "done"),
        HukumRouteHistory(id: "h2", ts: nil, source: "hukum", rawText: "return exactly HUKUM KIMI LIVE OK",
                          routedText: "return exactly HUKUM KIMI LIVE OK", target: "kimi", mode: "new",
                          alias: "", title: "New Kimi chat", session: "", routeNote: "Direct command endpoint",
                          jobId: "", status: "done", healthState: "done"),
    ]
}
