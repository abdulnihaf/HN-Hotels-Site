import Foundation
import AVFoundation

struct HukumSpeechItem: Identifiable, Equatable {
    let id = UUID()
    var session: String
    var title: String
}

@MainActor
final class HukumAudioQueue: NSObject, ObservableObject, AVAudioPlayerDelegate {
    static let shared = HukumAudioQueue()

    @Published private(set) var queue: [HukumSpeechItem] = []
    @Published private(set) var current: HukumSpeechItem?
    @Published private(set) var isPlaying = false
    @Published private(set) var isPausedByUser = false

    private var player: AVAudioPlayer?

    func enqueue(session: String, title: String) async {
        let item = HukumSpeechItem(session: session, title: title)
        if current == nil && !isPlaying {
            queue.append(item)
            await playNextIfNeeded()
        } else {
            queue.append(item)
            HukumLog.shared.add("\(title) queued for reading.")
        }
    }

    func stopCurrent() {
        player?.stop()
        player = nil
        current = nil
        isPlaying = false
        isPausedByUser = true
        HukumLog.shared.add(queue.isEmpty ? "Stopped current audio." : "Stopped current audio. \(queue.count) item(s) still queued.")
    }

    func resumeQueue() async {
        isPausedByUser = false
        await playNextIfNeeded()
    }

    private func playNextIfNeeded() async {
        guard !isPlaying, !isPausedByUser, !queue.isEmpty else { return }
        let item = queue.removeFirst()
        current = item
        isPlaying = true
        do {
            let data = try await HukumClient.shared.speechData(session: item.session)
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            try AVAudioSession.sharedInstance().setActive(true)
            player = try AVAudioPlayer(data: data)
            player?.delegate = self
            player?.prepareToPlay()
            player?.play()
            HukumLog.shared.add("Reading \(item.title).")
        } catch {
            HukumLog.shared.add("Audio failed: \(error.localizedDescription)")
            isPlaying = false
            current = nil
            await playNextIfNeeded()
        }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            self.isPlaying = false
            self.current = nil
            await self.playNextIfNeeded()
        }
    }
}

