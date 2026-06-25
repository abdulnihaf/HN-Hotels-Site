import Foundation

struct TakhtOverview: Decodable {
    let success: Bool?
    let shift: Shift?
    let counterBalance: MoneyBox?
    let validator: ValidatorState?
    let tokenSettlement: TokenSettlementState?
    let currentShift: Shift?
    let fetchedAt: String?
    let blockedSource: String?
    let sourceProof: [SourceProofCard]?
    let notes: [String]?
}

struct Shift: Decodable, Identifiable {
    var id: String { shiftId ?? UUID().uuidString }
    let shiftId: String?
    let settlementDate: String?
    let settledBy: String?
    let cashExpected: Double?
    let cashCounted: Double?
    let cashVariance: Double?
    let upiTotal: Double?
    let cardTotal: Double?
    let posUpiTotal: Double?
    let posCardTotal: Double?
    let freshnessSeconds: Double?
    let status: String?
    let flags: [TakhtFlag]?
}

struct MoneyBox: Decodable {
    let amount: Double?
    let freshnessSeconds: Double?
}

struct ValidatorState: Decodable {
    let ok: Bool?
    let freshnessSeconds: Double?
    let blockedSource: String?
    let message: String?
}

struct TokenSettlementState: Decodable {
    let pending: Double?
    let freshnessSeconds: Double?
    let blockedSource: String?
}

struct TakhtFlag: Decodable, Identifiable {
    let id: String?
    let level: String?
    let title: String?
    let detail: String?
}

struct SourceProofCard: Decodable, Identifiable {
    let id: String?
    let title: String?
    let status: String?
    let detail: String?
}

