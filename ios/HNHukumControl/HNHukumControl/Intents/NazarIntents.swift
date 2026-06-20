import Foundation
import AppIntents
import UIKit

enum NazarCameraOption: String, AppEnum {
    case heCashCounter = "he_cash_counter"
    case heGroundFloor = "he_ground_floor_dinein"
    case heFirstFloor = "he_first_floor_dinein"
    case heFirstFloor2 = "he_first_floor_dinein_2"
    case heKitchenPass = "he_kitchen_pass"
    case heMainKitchenDoor = "he_main_kitchen_door"
    case heMainKitchen2 = "he_main_kitchen_2"
    case heFriedChicken = "he_fried_chicken_kitchen"
    case heOutdoor = "he_outdoor"
    case nchCashCounter = "nch_cash_counter"
    case nchChaiCounter = "nch_chai_counter"
    case nchFullOutlet = "nch_full_outlet"
    case nchEntrance = "nch_full_outlet_entrance"
    case nchKitchen = "nch_kitchen"
    case nchOutdoor2 = "nch_outdoor_2"
    case nchOutdoorChai = "nch_outdoor_chai"

    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Nazar Camera")
    static var caseDisplayRepresentations: [NazarCameraOption: DisplayRepresentation] = [
        .heCashCounter: "HE Cash Counter",
        .heGroundFloor: "HE Ground Floor",
        .heFirstFloor: "HE First Floor",
        .heFirstFloor2: "HE First Floor 2",
        .heKitchenPass: "HE Kitchen Pass",
        .heMainKitchenDoor: "HE Main Kitchen Door",
        .heMainKitchen2: "HE Main Kitchen 2",
        .heFriedChicken: "HE Fried Chicken",
        .heOutdoor: "HE Outdoor",
        .nchCashCounter: "NCH Cash Counter",
        .nchChaiCounter: "NCH Chai Counter",
        .nchFullOutlet: "NCH Full Outlet",
        .nchEntrance: "NCH Entrance",
        .nchKitchen: "NCH Kitchen",
        .nchOutdoor2: "NCH Outdoor 2",
        .nchOutdoorChai: "NCH Outdoor Chai"
    ]

    var camera: NazarCamera {
        NazarCamera.catalog.first(where: { $0.id == rawValue }) ?? NazarCamera.catalog[0]
    }
}

struct NazarOpenCameraIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Nazar Camera"
    static var description = IntentDescription("Open a Nazar camera directly in fullscreen.")
    static var openAppWhenRun = false

    @Parameter(title: "Camera", default: .heCashCounter) var camera: NazarCameraOption

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let selected = camera.camera
        guard let url = NazarClient.deepLinkURL(for: selected) else {
            throw HukumError.badURL
        }
        await MainActor.run {
            UIApplication.shared.open(url)
        }
        return .result(dialog: IntentDialog(stringLiteral: "Opening \(selected.displayLabel) in Nazar."))
    }
}

struct NazarStatusIntent: AppIntent {
    static var title: LocalizedStringResource = "Read Nazar Status"
    static var description = IntentDescription("Read current Nazar camera health.")
    static var openAppWhenRun = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let health = try await NazarClient.shared.health()
        let flags = try? await NazarClient.shared.heFlags()
        let up = health.camsUp ?? 0
        let total = health.camsTotal ?? 0
        let frozen = health.frozen ?? []
        let flagCount = flags?.nActive ?? 0
        let degraded = frozen.isEmpty ? "No frozen cameras reported." : "Frozen: \(frozen.joined(separator: ", "))."
        let line = "Nazar status: \(up) of \(total) cameras up. \(degraded) HE active flags: \(flagCount)."
        return .result(dialog: IntentDialog(stringLiteral: line))
    }
}
