import Foundation
import SwiftUI

@MainActor
final class TakhtStore: ObservableObject {
    @Published var overview: TakhtOverview?
    @Published var errorMessage: String?
    @Published var isLoading = false

    private let api = URL(string: "https://takht.hnhotels.in/api/takht")!

    func refresh() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let (data, _) = try await URLSession.shared.data(from: api)
            overview = try JSONDecoder.takht.decode(TakhtOverview.self, from: data)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    var currentShift: Shift? { overview?.currentShift ?? overview?.shift }

    var freshnessLabel: String {
        if let fresh = currentShift?.freshnessSeconds {
            return "\(Int(fresh))s"
        }
        if let fresh = overview?.validator?.freshnessSeconds {
            return "\(Int(fresh))s"
        }
        return "unknown"
    }
}

private extension JSONDecoder {
    static var takht: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }
}

