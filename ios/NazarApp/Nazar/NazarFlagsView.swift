import SwiftUI

@MainActor
final class NazarFlagsModel: ObservableObject {
    @Published var active: [NazarFlag] = []
    @Published var historical: [NazarFlag] = []
    @Published var confirmations: [NazarConfirmation] = []
    @Published var status: String = "Loading…"
    @Published var isLoading = false
    @Published var confirmingId: String?
    @Published var locallyConfirmed: [String: String] = [:]   // code -> verdict (optimistic)

    func load() async {
        isLoading = true
        do {
            let result = try await NazarClient.shared.fetchFlags(includeHistory: true)
            active = result.flags ?? []          // active + closed exceptions
            historical = result.historical ?? [] // historical review flags
            status = (active.isEmpty && historical.isEmpty) ? "No flags — review mode" : "Updated"
        } catch {
            status = error.localizedDescription
        }
        confirmations = (try? await NazarClient.shared.fetchConfirmations()) ?? []
        isLoading = false
    }

    func confirm(flag: NazarFlag, verdict: String) async {
        guard let code = flag.code, !code.isEmpty else { return }
        confirmingId = code
        do {
            try await NazarClient.shared.confirmFlag(code: code, verdict: verdict, label: flag.label)
            locallyConfirmed[code] = verdict
            await load()
        } catch {
            status = "Confirm failed: \(error.localizedDescription)"
        }
        confirmingId = nil
    }
}

struct NazarFlagsView: View {
    @StateObject private var model = NazarFlagsModel()

    private var isEmpty: Bool { model.active.isEmpty && model.historical.isEmpty && model.confirmations.isEmpty }

    var body: some View {
        Group {
            if model.isLoading && isEmpty {
                loading
            } else if isEmpty {
                emptyState
            } else {
                ScrollView {
                    VStack(spacing: 14) {
                        if !model.active.isEmpty {
                            section("ACTIVE EXCEPTIONS") {
                                ForEach(model.active) { FlagCard(flag: $0, model: model) }
                            }
                        }
                        if !model.historical.isEmpty {
                            section("HISTORICAL REVIEW") {
                                ForEach(model.historical) { FlagCard(flag: $0, model: model) }
                            }
                        }
                        if !model.confirmations.isEmpty {
                            section("RECENT VERDICTS") {
                                ForEach(model.confirmations.suffix(20).reversed()) { confirmationRow($0) }
                            }
                        }
                    }
                    .padding(16)
                }
            }
        }
        .background(HK.bg.ignoresSafeArea())
        .task { await model.load() }
        .refreshable { await model.load() }
    }

    @ViewBuilder
    private func section<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 10, weight: .semibold)).foregroundColor(HK.textFaint)
                .frame(maxWidth: .infinity, alignment: .leading)
            content()
        }
    }

    private func confirmationRow(_ c: NazarConfirmation) -> some View {
        let real = (c.verdict ?? "") == "real"
        return HStack(spacing: 10) {
            Image(systemName: real ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .font(.system(size: 13)).foregroundColor(real ? HK.error : HK.ok)
            VStack(alignment: .leading, spacing: 2) {
                Text(c.label ?? c.code ?? "verdict").font(.system(size: 13, weight: .medium)).foregroundColor(HK.text).lineLimit(1)
                Text(real ? "Confirmed leak" : "Marked safe / staff").font(.system(size: 10)).foregroundColor(HK.textFaint)
            }
            Spacer()
            if let at = c.at { Text(shortTime(at)).font(.system(size: 10)).foregroundColor(HK.textFaint) }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: HK.radiusSm).fill(HK.card))
    }

    private func shortTime(_ iso: String) -> String {
        // best-effort HH:mm from an ISO timestamp
        if let tRange = iso.range(of: "T") {
            let after = iso[tRange.upperBound...]
            return String(after.prefix(5))
        }
        return iso
    }

    private var loading: some View {
        VStack(spacing: 12) {
            ProgressView().tint(HK.accent)
            Text(model.status).font(.system(size: 13)).foregroundColor(HK.textDim)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "checkmark.shield.fill").font(.system(size: 44)).foregroundColor(HK.ok)
            Text("No flags today").font(.system(size: 17, weight: .semibold)).foregroundColor(HK.text)
            Text("Engine is in review mode — flags appear here when raised.")
                .font(.system(size: 13)).foregroundColor(HK.textDim)
                .multilineTextAlignment(.center).padding(.horizontal, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct FlagCard: View {
    let flag: NazarFlag
    @ObservedObject var model: NazarFlagsModel

    private var stateColor: Color {
        switch flag.status {
        case "active":              return HK.error
        case "closed", "cleared":   return HK.ok
        default:                    return HK.warn
        }
    }

    private var localVerdict: String? { flag.code.flatMap { model.locallyConfirmed[$0] } }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Circle().fill(stateColor).frame(width: 8, height: 8)
                Text(flag.label ?? flag.camera ?? "Exception")
                    .font(.system(size: 14, weight: .semibold)).foregroundColor(HK.text)
                Spacer()
                if let t = flag.time, !t.isEmpty {
                    Text(t).font(.system(size: 11, weight: .medium)).foregroundColor(HK.textFaint)
                }
            }

            if let reason = flag.reason {
                Text(reason).font(.system(size: 12)).foregroundColor(HK.textDim)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 16) {
                if let pc = flag.personCount { metric("people", "\(pc)", "person.fill") }
                if let bill = flag.billMatch, !bill.isEmpty { metric("bill", bill, "doc.text.fill") }
                if let conf = flag.confidence { metric("conf", conf, "waveform") }
            }

            if let verdict = localVerdict {
                verdictBadge(verdict)
            } else if flag.isActive {
                HStack(spacing: 10) {
                    confirmButton("Real leak", verdict: "real", color: HK.error, icon: "exclamationmark.triangle.fill")
                    confirmButton("False / Staff", verdict: "false", color: HK.ok, icon: "checkmark.circle.fill")
                }
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: HK.radiusSm).fill(HK.card))
        .overlay(RoundedRectangle(cornerRadius: HK.radiusSm).stroke(stateColor.opacity(0.22)))
    }

    private func metric(_ key: String, _ value: String, _ icon: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 10)).foregroundColor(HK.textFaint)
            Text(value).font(.system(size: 11, weight: .medium)).foregroundColor(HK.textDim).lineLimit(1)
        }
    }

    private func verdictBadge(_ verdict: String) -> some View {
        let real = verdict == "real"
        return HStack(spacing: 6) {
            Image(systemName: real ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .font(.system(size: 12)).foregroundColor(real ? HK.error : HK.ok)
            Text(real ? "Confirmed leak" : "Marked safe / staff")
                .font(.system(size: 12, weight: .medium)).foregroundColor(real ? HK.error : HK.ok)
        }
    }

    private func confirmButton(_ title: String, verdict: String, color: Color, icon: String) -> some View {
        let isConfirming = model.confirmingId == flag.code
        return Button {
            Task { await model.confirm(flag: flag, verdict: verdict) }
        } label: {
            HStack(spacing: 6) {
                if isConfirming { ProgressView().tint(color).scaleEffect(0.7) }
                else { Image(systemName: icon).font(.system(size: 12)) }
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
