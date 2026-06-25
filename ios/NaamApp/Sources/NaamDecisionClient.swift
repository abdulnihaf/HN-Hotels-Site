import Foundation

// Naam DECISION client — the ONLY write the Naam app ever makes.
//
// It POSTs an approve/hold DECISION to /api/naam-actions (D1 naam_decisions). It NEVER mutates
// spend and NEVER sends: the endpoint hard-403s any launch/pause/budget/spend verb and holds no
// platform integration, and the actual launch/post/payout is performed by the child lane that
// holds the credential. Decision in the system, trigger in the hand (COA, owner boundary
// "record-only" confirmed 2026-06-25). PIN-gated — the owner PINs already ship in the public
// Naam web JS, so they are not a secret here.
struct NaamDecision: Codable, Identifiable {
    var id: String
    var move_id: String?
    var brand: String?
    var lane: String?
    var title: String?
    var decision: String?          // "approve" | "hold"
    var status: String?            // "queued" | "checked"
    var proof_verified: Bool?
    var decided_at: String?
    var checked_at: String?
}

private struct DecisionEnvelope: Codable {
    var ok: Bool?
    var error: String?
    var decision: NaamDecision?
    var decisions: [NaamDecision]?
}

actor NaamDecisionClient {
    static let shared = NaamDecisionClient()
    private let base = "https://hnhotels.in/api/naam-actions"
    private let dec = JSONDecoder()

    // READ — latest decisions for a brand (to render the recorded-state pill). GET, idempotent.
    func list(brand: String) async throws -> [NaamDecision] {
        guard let url = URL(string: "\(base)?action=list&brand=\(brand)") else { throw HukumError.badURL }
        var req = URLRequest(url: url)
        req.timeoutInterval = 12
        req.cachePolicy = .reloadIgnoringLocalCacheData
        let (d, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw HukumError.server("HTTP \(http.statusCode)")
        }
        return (try dec.decode(DecisionEnvelope.self, from: d)).decisions ?? []
    }

    // WRITE — record an approve/hold decision. Server is idempotent per (move_id, brand): a
    // re-tap UPDATEs the same row instead of duplicating. proofVerified is honest — false until a
    // real machine proof source (e.g. QISSA reel-QA) exists; never a fake green tick.
    func request(moveID: String, brand: String, lane: String, decision: String,
                 title: String?, proof: [String: String]?, proofVerified: Bool, pin: String) async throws -> NaamDecision {
        var body: [String: Any] = [
            "action": "request",
            "move_id": moveID,
            "brand": brand,
            "lane": lane,
            "decision": decision,
            "proof_verified": proofVerified,
            "pin": pin,
        ]
        if let title { body["title"] = title }
        if let proof { body["proof"] = proof }
        return try await post(body)
    }

    private func post(_ body: [String: Any]) async throws -> NaamDecision {
        guard let url = URL(string: base) else { throw HukumError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 12
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        let (d, resp) = try await URLSession.shared.data(for: req)
        let env = try? dec.decode(DecisionEnvelope.self, from: d)
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw HukumError.server(env?.error ?? "HTTP \(http.statusCode)")
        }
        guard let decision = env?.decision else {
            throw HukumError.server(env?.error ?? "No decision returned by the ledger.")
        }
        return decision
    }
}
