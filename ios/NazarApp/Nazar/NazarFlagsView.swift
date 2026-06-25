import SwiftUI

@MainActor
final class NazarFlagsModel: ObservableObject {
    @Published var flags: [NazarFlag] = []
    @Published var activeExceptions: Int = 0
    @Published var status: String = "Loading…"
    @Published var isLoading = false
    @Published var confirmingId: String?

    func load() async {
        isLoading = true
        do {
            let result = try await NazarClient.shared.fetchFlags(includeHistory: true)
            flags = result.history ?? []
            activeExceptions = result.summary?.activeExceptions ?? 0
            status = flags.isEmpty ? "No flags today" : "Updated"
        } catch {
            status = error.localizedDescription
        }
        isLoading = false
    }

    func confirm(id: String, verdict: String) async {
        confirmingId = id
        do {
            try await NazarClient.shared.confirmFlag(id: id, verdict: verdict)
            await load()
        } catch {
            status = "Confirm failed: \(error.localizedDescription)"
        }
        confirmingId = nil
    }
}

struct NazarFlagsView: View {
    @StateObject private var model = NazarFlagsModel()

    var body: some View {
        Group {
            if model.isLoading && model.flags.isEmpty {
                VStack(spacing: 12) {
                    ProgressView().tint(HK.accent)
                    Text(model.status).font(.system(size: 13)).foregroundColor(HK.textDim)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if model.flags.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "checkmark.shield.fill")
                        .font(.system(size: 44))
                        .foregroundColor(HK.ok)
                    Text("No flags today")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(HK.text)
                    Text("Engine is in review mode — flags appear here when raised.")
                        .font(.system(size: 13))
                        .foregroundColor(HK.textDim)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 40)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(model.flags) { flag in
                        FlagCard(flag: flag, model: model)
                            .listRowBackground(HK.card)
                            .listRowSeparatorTint(HK.line)
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
        .background(HK.bg.ignoresSafeArea())
        .task { await model.load() }
        .refreshable { await model.load() }
    }
}

private struct FlagCard: View {
    let flag: NazarFlag
    @ObservedObject var model: NazarFlagsModel

    private var stateColor: Color {
        switch flag.state {
        case "active":  return HK.error
        case "cleared": return HK.ok
        default:        return HK.warn
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Circle().fill(stateColor).frame(width: 8, height: 8)
                Text(flag.location ?? flag.area ?? "Unknown location")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(HK.text)
                Spacer()
                if let t = flag.time {
                    Text(t)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(HK.textFaint)
                }
            }

            HStack(spacing: 16) {
                if let hc = flag.headcount {
                    label("people", value: "\(hc)", icon: "person.fill")
                }
                if let bill = flag.billId {
                    label("bill", value: bill, icon: "doc.text.fill")
                }
                if let conf = flag.confidence {
                    label("conf", value: conf, icon: "waveform")
                }
            }

            if let verdict = flag.confirmed {
                HStack(spacing: 6) {
                    Image(systemName: verdict == "real" ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                        .font(.system(size: 12))
                        .foregroundColor(verdict == "real" ? HK.error : HK.ok)
                    Text(verdict == "real" ? "Confirmed leak" : "Marked safe / staff")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(verdict == "real" ? HK.error : HK.ok)
                }
            } else if flag.state == "active" {
                HStack(spacing: 10) {
                    confirmButton("Real leak", verdict: "real", color: HK.error, icon: "exclamationmark.triangle.fill", flag: flag)
                    confirmButton("False / Staff", verdict: "false", color: HK.ok, icon: "checkmark.circle.fill", flag: flag)
                }
            }
        }
        .padding(.vertical, 8)
    }

    private func label(_ key: String, value: String, icon: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 10)).foregroundColor(HK.textFaint)
            Text(value).font(.system(size: 11, weight: .medium)).foregroundColor(HK.textDim)
        }
    }

    private func confirmButton(_ title: String, verdict: String, color: Color, icon: String, flag: NazarFlag) -> some View {
        let isConfirming = model.confirmingId == flag.id
        return Button {
            guard let id = flag.flagId else { return }
            Task { await model.confirm(id: id, verdict: verdict) }
        } label: {
            HStack(spacing: 6) {
                if isConfirming {
                    ProgressView().tint(color).scaleEffect(0.7)
                } else {
                    Image(systemName: icon).font(.system(size: 12))
                }
                Text(title).font(.system(size: 12, weight: .semibold))
            }
            .foregroundColor(color)
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(Capsule().fill(color.opacity(0.12)))
            .overlay(Capsule().stroke(color.opacity(0.4), lineWidth: 1))
        }
        .disabled(isConfirming)
    }
}
