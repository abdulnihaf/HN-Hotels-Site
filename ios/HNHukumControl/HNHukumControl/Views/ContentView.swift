import SwiftUI

struct ContentView: View {
    @StateObject private var session = DiwanSession()

    var body: some View {
        switch ProcessInfo.processInfo.environment["HUKUM_VIEW"] {
        case "anbar": AnbarBoardView()
        case "naam": NaamLiveView()
        case "darbar": DarbarView()
        case "sauda": SaudaBoardView()
        case "hisab": HisabTodayView()
        case "takht": TakhtSettlementView()
        default:
            if session.unlocked {
                tabs
            } else {
                DiwanUnlockView(session: session)
            }
        }
    }

    private var tabs: some View {
        TabView {
            ChambersHomeView()
                .tabItem { Label("Diwan", systemImage: "square.grid.2x2.fill") }
            HukumCockpitView()
                .tabItem { Label("Hukum", systemImage: "command") }
            NazarView()
                .tabItem { Label("Nazar", systemImage: "eye") }
        }
        .tint(HK.accent)
    }
}

struct HukumCockpitView: View {
    @EnvironmentObject private var settings: HukumSettings
    @EnvironmentObject private var model: HukumAppModel
    @EnvironmentObject private var audio: HukumAudioQueue
    @State private var prompt = ""
    @State private var showSettings = false
    @State private var detailLane: HukumLaneState?
    @State private var engineFilter = ProcessInfo.processInfo.environment["HUKUM_FILTER"] ?? "all"

    private var selectedLane: HukumLaneState? {
        model.lanes.first(where: { $0.selected }) ?? model.lanes.first
    }
    private var connected: Bool { !model.lanes.isEmpty || !model.sessions.isEmpty }
    private var hasError: Bool { model.statusLine.lowercased().contains("error") && model.lanes.isEmpty }

    var body: some View {
        ZStack {
            HK.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                header
                if connected {
                    engineBar
                    chatScroll
                } else { emptyState }
                bottomBar
            }
        }
        .sheet(isPresented: $showSettings) { SettingsView().environmentObject(settings) }
        .sheet(item: $detailLane) { LaneDetailView(lane: $0).environmentObject(model) }
    }

    // MARK: header

    private var header: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Hukum")
                    .font(.system(size: 30, weight: .heavy, design: .rounded))
                    .foregroundStyle(HK.text)
                connectionRow
            }
            Spacer()
            Button {
                let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
                prompt = ""
                Task { await model.send(text: text.isEmpty ? "new chat" : "new chat \(text)", lane: nil) }
            } label: {
                Image(systemName: "square.and.pencil")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(HK.textDim)
                    .frame(width: 42, height: 42)
                    .background(HK.card, in: Circle())
                    .overlay(Circle().stroke(HK.line, lineWidth: 1))
            }
            .accessibilityLabel("New chat")
            Button { showSettings = true } label: {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(HK.textDim)
                    .frame(width: 42, height: 42)
                    .background(HK.card, in: Circle())
                    .overlay(Circle().stroke(HK.line, lineWidth: 1))
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 6)
        .padding(.bottom, 14)
    }

    private var connectionRow: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(connected ? HK.ready : (hasError ? HK.error : HK.idle))
                .frame(width: 7, height: 7)
            Text(connected
                 ? "\(model.lanes.count) lanes · \(settings.isSecureBridge ? "secure" : "tailscale")"
                 : (hasError ? "Not connected" : "Connecting…"))
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(HK.textDim)
        }
    }

    // MARK: lanes

    // MARK: engine filter + all-chats list (Codex / Claude / Kimi)

    private let engines: [(key: String, label: String)] = [
        ("all", "All"), ("codex", "Codex"), ("claude", "Claude"), ("kimi", "Kimi")
    ]

    private func engineCount(_ key: String) -> Int {
        switch key {
        case "all": return model.sessions.count
        case "kimi": return kimiRuns.count
        default: return model.sessions.filter { ($0.app ?? "codex").lowercased() == key }.count
        }
    }

    private var engineBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(engines, id: \.key) { e in
                    let on = engineFilter == e.key
                    Button { engineFilter = e.key } label: {
                        HStack(spacing: 6) {
                            Text(e.label).font(.system(size: 14, weight: .semibold))
                            Text("\(engineCount(e.key))")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(on ? .black.opacity(0.55) : HK.textFaint)
                        }
                        .foregroundStyle(on ? .black : HK.textDim)
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(on ? HK.accent : HK.card, in: Capsule())
                        .overlay(Capsule().stroke(on ? Color.clear : HK.line, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.bottom, 8)
    }

    private var filteredSessions: [HukumSession] {
        let f = engineFilter
        return model.sessions.filter { f == "all" || ($0.app ?? "codex").lowercased() == f }
    }

    private var kimiRuns: [HukumRouteHistory] {
        model.history.filter { ($0.target ?? "").lowercased() == "kimi" }
    }

    private func lane(for session: HukumSession) -> HukumLaneState? {
        model.lanes.first { $0.session == session.id }
    }

    private func syntheticLane(_ s: HukumSession) -> HukumLaneState {
        HukumLaneState(slot: nil, alias: nil, title: s.title, app: s.app,
                       session: s.id, selected: false, available: true,
                       healthState: s.isHot ? "running" : nil, healthNote: nil,
                       latest: nil, transcript: nil, activeJob: nil, latestHukumJob: nil)
    }

    @ViewBuilder private func engineEmpty(_ msg: String) -> some View {
        Text(msg).font(.subheadline).foregroundStyle(HK.textFaint)
            .frame(maxWidth: .infinity).padding(.top, 44)
    }

    private var chatScroll: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                if engineFilter == "kimi" {
                    if kimiRuns.isEmpty { engineEmpty("No Kimi runs yet.") }
                    else { ForEach(kimiRuns) { run in RunRowView(run: run) } }
                } else if filteredSessions.isEmpty {
                    engineEmpty("No chats here yet.")
                } else {
                    ForEach(filteredSessions) { session in
                        if let l = lane(for: session) {
                            LaneCardView(lane: l,
                                         isPlaying: audio.current?.session == l.session,
                                         onSelect: { Task { await model.select(l) } },
                                         onListen: { Task { await model.read(l) } },
                                         onOpen: { detailLane = l })
                        } else {
                            SessionRowView(session: session, onOpen: { detailLane = syntheticLane(session) })
                        }
                    }
                }
            }
            .padding(.horizontal, 16).padding(.top, 2).padding(.bottom, 10)
        }
        .scrollIndicators(.hidden)
        .refreshable { await model.refresh() }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: hasError ? "wifi.exclamationmark" : "command.circle")
                .font(.system(size: 46, weight: .regular))
                .foregroundStyle(HK.textFaint)
            Text(hasError ? "Not connected to your bridge" : "Connecting to Hukum…")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(HK.text)
            if hasError {
                Text("Set your bridge URL and token to see your lanes.")
                    .font(.subheadline)
                    .foregroundStyle(HK.textDim)
                    .multilineTextAlignment(.center)
                Button { showSettings = true } label: {
                    Text("Open settings")
                        .fontWeight(.semibold)
                        .foregroundStyle(.black)
                        .padding(.horizontal, 22).padding(.vertical, 11)
                        .background(HK.accent, in: Capsule())
                }
                .padding(.top, 2)
            } else {
                ProgressView().tint(HK.accent).padding(.top, 4)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 30)
    }

    // MARK: bottom bar (audio + composer)

    private var bottomBar: some View {
        VStack(spacing: 10) {
            autoReadBar
            if audio.current != nil || !audio.queue.isEmpty { audioBar }
            composer
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 4)
        .background(HK.bgElev)
        .overlay(Rectangle().fill(HK.line).frame(height: 1), alignment: .top)
    }

    private var autoReadBar: some View {
        HStack(spacing: 10) {
            Button { settings.autoRead.toggle() } label: {
                HStack(spacing: 7) {
                    Image(systemName: settings.autoRead ? "speaker.wave.2.fill" : "speaker.slash.fill")
                        .font(.system(size: 13, weight: .bold))
                    Text(settings.autoRead ? "Auto-read on" : "Auto-read off")
                        .font(.system(size: 13, weight: .semibold))
                }
                .foregroundStyle(settings.autoRead ? .black : HK.textDim)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(settings.autoRead ? HK.accent : HK.card, in: Capsule())
                .overlay(Capsule().stroke(settings.autoRead ? Color.clear : HK.line, lineWidth: 1))
            }
            .buttonStyle(.plain)
            if settings.autoRead {
                Button {
                    settings.autoReadMode = settings.autoReadMode == "sticky" ? "oneshot" : "sticky"
                } label: {
                    Text(settings.autoReadMode == "sticky" ? "Sticky" : "Once")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(HK.textDim)
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(HK.card, in: Capsule())
                        .overlay(Capsule().stroke(HK.line, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
    }

    private var audioBar: some View {
        HStack(spacing: 12) {
            Image(systemName: "waveform")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(HK.accent)
            VStack(alignment: .leading, spacing: 1) {
                Text(audio.current?.title ?? "Queued")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(HK.text)
                    .lineLimit(1)
                Text(audio.queue.isEmpty ? "Reading aloud" : "\(audio.queue.count) queued")
                    .font(.system(size: 12))
                    .foregroundStyle(HK.textDim)
            }
            Spacer()
            if audio.current == nil && !audio.queue.isEmpty {
                Button { Task { await audio.resumeQueue() } } label: {
                    Image(systemName: "play.fill")
                        .foregroundStyle(.black)
                        .frame(width: 34, height: 34)
                        .background(HK.accent, in: Circle())
                }
            }
            Button { model.stopAudio() } label: {
                Image(systemName: "stop.fill")
                    .foregroundStyle(HK.text)
                    .frame(width: 34, height: 34)
                    .background(HK.cardHi, in: Circle())
            }
        }
        .padding(10)
        .background(HK.card, in: RoundedRectangle(cornerRadius: 14))
    }

    private var composer: some View {
        HStack(spacing: 10) {
            TextField(composerPlaceholder, text: $prompt, axis: .vertical)
                .font(.system(size: 15))
                .foregroundStyle(HK.text)
                .tint(HK.accent)
                .lineLimit(1...4)
                .padding(.horizontal, 14).padding(.vertical, 11)
                .background(HK.card, in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(HK.line, lineWidth: 1))

            Button {
                let lane = selectedLane
                let text = prompt
                prompt = ""
                Task { await model.send(text: text, lane: lane) }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(prompt.isEmpty ? HK.textFaint : .black)
                    .frame(width: 44, height: 44)
                    .background(prompt.isEmpty ? HK.card : HK.accent, in: Circle())
            }
            .disabled(prompt.isEmpty)
        }
    }

    private var composerPlaceholder: String {
        if let l = selectedLane { return "Message \(l.displaySlot)…" }
        return "Speak or type to Hukum…"
    }
}

// MARK: - Lane card

struct LaneCardView: View {
    let lane: HukumLaneState
    let isPlaying: Bool
    let onSelect: () -> Void
    let onListen: () -> Void
    let onOpen: () -> Void
    @State private var pulse = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(lane.displaySlot)
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(HK.text)
                    .padding(.horizontal, 9).padding(.vertical, 4)
                    .background(HK.cardHi, in: Capsule())
                EngineChip(app: lane.app)
                Spacer()
                statusPill
            }
            Text(lane.displayTitle)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(HK.text)
            Text(lane.latest?.preview ?? lane.latest?.note ?? "No output yet.")
                .font(.system(size: 14))
                .foregroundStyle(HK.textDim)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 12) {
                Button(action: onListen) {
                    HStack(spacing: 6) {
                        Image(systemName: isPlaying ? "waveform" : "play.fill")
                            .font(.system(size: 12, weight: .bold))
                        Text(isPlaying ? "Reading" : "Listen")
                            .font(.system(size: 14, weight: .semibold))
                    }
                    .foregroundStyle(lane.canRead ? .black : HK.text)
                    .padding(.horizontal, 16).padding(.vertical, 9)
                    .background(lane.canRead ? HK.accent : HK.cardHi, in: Capsule())
                }
                .buttonStyle(.plain)
                Button(action: onSelect) {
                    Image(systemName: lane.selected ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 19))
                        .foregroundStyle(lane.selected ? HK.accent : HK.textFaint)
                }
                .buttonStyle(.plain)
                Spacer()
                if let age = lane.transcript?.ageSeconds {
                    Text(ageString(age))
                        .font(.system(size: 12))
                        .foregroundStyle(HK.textFaint)
                }
            }
        }
        .padding(16)
        .background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(
            RoundedRectangle(cornerRadius: HK.radius)
                .stroke(lane.selected ? HK.accentLine : HK.line, lineWidth: lane.selected ? 1.5 : 1)
        )
        .shadow(color: lane.selected ? HK.accent.opacity(0.10) : .clear, radius: 10, y: 4)
        .contentShape(RoundedRectangle(cornerRadius: HK.radius))
        .onTapGesture(perform: onOpen)
    }

    private var statusPill: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(lane.statusColor)
                .frame(width: 7, height: 7)
                .opacity(lane.isRunning && pulse ? 0.3 : 1)
                .animation(lane.isRunning ? .easeInOut(duration: 0.85).repeatForever(autoreverses: true) : .default, value: pulse)
            Text(lane.statusLabel)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(HK.textDim)
        }
        .onAppear { pulse = true }
    }

    private func ageString(_ s: Int) -> String {
        if s < 60 { return "\(s)s ago" }
        if s < 3600 { return "\(s / 60)m ago" }
        return "\(s / 3600)h ago"
    }
}

// MARK: - Session row (a chat that isn't a controllable lane)

struct SessionRowView: View {
    let session: HukumSession
    let onOpen: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                EngineChip(app: session.app)
                if session.isHot {
                    HStack(spacing: 5) {
                        Circle().fill(HK.running).frame(width: 6, height: 6)
                        Text("Live").font(.system(size: 11, weight: .medium)).foregroundStyle(HK.textDim)
                    }
                }
                Spacer()
                if let ago = session.ago { Text(ago).font(.system(size: 12)).foregroundStyle(HK.textFaint) }
            }
            Text(session.title ?? "Chat")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(HK.text)
            if let snip = session.snippet, !snip.isEmpty {
                Text(snip).font(.system(size: 13)).foregroundStyle(HK.textDim).lineLimit(2)
            }
        }
        .padding(14)
        .background(HK.bgElev, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.lineSoft, lineWidth: 1))
        .contentShape(RoundedRectangle(cornerRadius: HK.radius))
        .onTapGesture(perform: onOpen)
    }
}

// MARK: - Run row (one-off executions: Kimi, direct Codex/Claude, RTX)

struct RunRowView: View {
    let run: HukumRouteHistory

    var body: some View {
        HStack(spacing: 12) {
            EngineChip(app: run.target)
            VStack(alignment: .leading, spacing: 2) {
                Text(run.title ?? run.routedText ?? "Run")
                    .font(.system(size: 15, weight: .semibold)).foregroundStyle(HK.text).lineLimit(1)
                Text(run.routedText ?? run.rawText ?? "")
                    .font(.system(size: 12)).foregroundStyle(HK.textDim).lineLimit(1)
            }
            Spacer()
            Circle().fill(statusColor).frame(width: 8, height: 8)
        }
        .padding(14)
        .background(HK.bgElev, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.lineSoft, lineWidth: 1))
    }

    private var statusColor: Color {
        switch (run.status ?? "").lowercased() {
        case "done": return HK.ready
        case "error", "failed": return HK.error
        case "running", "queued": return HK.running
        default: return HK.idle
        }
    }
}
