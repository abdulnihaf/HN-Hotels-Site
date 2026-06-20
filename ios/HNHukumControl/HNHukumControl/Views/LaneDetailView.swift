import SwiftUI

// Tap a lane → read its FULL latest answer (fetched live), with listen + send in context.
struct LaneDetailView: View {
    let lane: HukumLaneState
    @EnvironmentObject private var model: HukumAppModel
    @Environment(\.dismiss) private var dismiss
    @State private var prompt = ""
    @State private var fullText: String?
    @State private var loading = true

    var body: some View {
        NavigationStack {
            ZStack {
                HK.bg.ignoresSafeArea()
                VStack(spacing: 0) {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            headerBlock
                            answerCard
                        }
                        .padding(16)
                    }
                    composer
                }
            }
            .navigationTitle(lane.displaySlot)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.foregroundStyle(HK.accent)
                }
            }
        }
        .task {
            if let r = try? await HukumClient.shared.latestBySession(lane.session) {
                fullText = r.text
            }
            loading = false
        }
    }

    private var headerBlock: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(lane.engineName)
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundStyle(lane.engineColor)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(lane.engineColor.opacity(0.14), in: Capsule())
                HStack(spacing: 5) {
                    Circle().fill(lane.statusColor).frame(width: 7, height: 7)
                    Text(lane.statusLabel).font(.system(size: 12, weight: .medium)).foregroundStyle(HK.textDim)
                }
                Spacer()
            }
            Text(lane.displayTitle)
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(HK.text)
            if let lastUser = lane.transcript?.lastUserPreview, !lastUser.isEmpty {
                Text("You: \(lastUser)")
                    .font(.system(size: 13))
                    .foregroundStyle(HK.textFaint)
                    .lineLimit(2)
            }
        }
    }

    private var answerCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Latest answer")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(HK.textDim)
                Spacer()
                Button { Task { await model.read(lane) } } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "play.fill").font(.system(size: 11, weight: .bold))
                        Text("Listen").font(.system(size: 13, weight: .semibold))
                    }
                    .foregroundStyle(.black)
                    .padding(.horizontal, 14).padding(.vertical, 7)
                    .background(HK.accent, in: Capsule())
                }
            }
            if loading && fullText == nil {
                HStack(spacing: 8) {
                    ProgressView().tint(HK.accent)
                    Text("Loading full answer…").font(.system(size: 14)).foregroundStyle(HK.textDim)
                }
                .padding(.vertical, 6)
            }
            Text(fullText ?? lane.latest?.preview ?? lane.latest?.note ?? "No output yet.")
                .font(.system(size: 16))
                .foregroundStyle(HK.text)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
        }
        .padding(16)
        .background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.line, lineWidth: 1))
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var composer: some View {
        HStack(spacing: 10) {
            TextField("Message \(lane.displaySlot)…", text: $prompt, axis: .vertical)
                .font(.system(size: 15))
                .foregroundStyle(HK.text)
                .tint(HK.accent)
                .lineLimit(1...4)
                .padding(.horizontal, 14).padding(.vertical, 11)
                .background(HK.card, in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(HK.line, lineWidth: 1))
            Button {
                let text = prompt
                prompt = ""
                Task { await model.send(text: text, lane: lane); dismiss() }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(prompt.isEmpty ? HK.textFaint : .black)
                    .frame(width: 44, height: 44)
                    .background(prompt.isEmpty ? HK.card : HK.accent, in: Circle())
            }
            .disabled(prompt.isEmpty)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(HK.bgElev)
        .overlay(Rectangle().fill(HK.line).frame(height: 1), alignment: .top)
    }
}
