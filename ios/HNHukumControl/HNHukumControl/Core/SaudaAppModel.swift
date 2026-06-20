import Foundation
import Combine

@MainActor
final class SaudaAppModel: ObservableObject {
    @Published var board: SaudaTodayResponse?
    @Published var statusLine = "Loading buy board…"
    @Published var isRefreshing = false
    @Published var isUnlocked = DiwanAuth.isUnlocked("sauda")
    @Published var gateError: String?
    @Published var isAuthing = false

    private var pollTask: Task<Void, Never>?

    var lines: [SaudaLine] { board?.lines ?? [] }
    var requests: [SaudaRequest] { board?.requests ?? [] }
    var vendors: [SaudaVendor] { board?.registry ?? [] }

    var date: String { board?.date ?? "" }
    var placed: String { board?.placed ?? "" }

    var pendingRequests: [SaudaRequest] {
        requests.filter { ($0.status ?? "").lowercased() != "paid" }
    }

    var lineTotalRupees: Double {
        lines.reduce(0) { $0 + $1.rupees }
    }

    // MARK: gate

    func unlock(pin: String) async {
        let p = pin.trimmingCharacters(in: .whitespaces)
        guard !p.isEmpty else { gateError = "Enter a PIN"; return }
        isAuthing = true
        gateError = nil
        defer { isAuthing = false }
        do {
            let resp = try await SaudaClient.shared.today(pin: p)
            if resp.ok == true {
                DiwanAuth.setCredential(p, chamber: "sauda")
                isUnlocked = true
                board = resp
                updateStatus()
                startPolling()
            } else {
                gateError = "PIN rejected"
            }
        } catch SaudaError.unauthorized {
            gateError = "PIN rejected"
        } catch {
            gateError = error.localizedDescription
        }
    }

    // MARK: read loop

    func bootstrap() async {
        guard isUnlocked, let pin = DiwanAuth.credential("sauda") else { return }
        await refresh(pin: pin)
        startPolling()
    }

    func refresh() async {
        guard let pin = DiwanAuth.credential("sauda") else { return }
        await refresh(pin: pin)
    }

    private func refresh(pin: String) async {
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let resp = try await SaudaClient.shared.today(pin: pin)
            if resp.ok == true {
                board = resp
                updateStatus()
            } else {
                statusLine = "Sauda: PIN no longer valid"
            }
        } catch SaudaError.unauthorized {
            statusLine = "Sauda: PIN no longer valid"
        } catch {
            statusLine = "Sauda offline: \(error.localizedDescription)"
        }
    }

    private func updateStatus() {
        let n = lines.count
        let pend = pendingRequests.count
        if n == 0 {
            statusLine = placed.isEmpty
                ? "No purchases logged for \(date)"
                : "No lines yet · last placed \(placed)"
        } else {
            var s = "\(n) line\(n == 1 ? "" : "s") · ₹\(Int(lineTotalRupees.rounded()))"
            if pend > 0 { s += " · \(pend) pay-request\(pend == 1 ? "" : "s")" }
            statusLine = s
        }
    }

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 45_000_000_000)
                await self?.refresh()
            }
        }
    }
}
