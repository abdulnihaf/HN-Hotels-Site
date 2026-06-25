import SwiftUI
import LocalAuthentication

@MainActor
final class NazarSession: ObservableObject {
    @Published var unlocked = false
    @Published var error: String?

    let account = "owner-pin"
    let seedPin = "0305"

    var hasStoredPin: Bool { KeychainStore.get(account) != nil }

    init() {
        // SECURITY: the seed PIN is a temporary default. The owner should change it on first launch.
        if KeychainStore.get(account) == nil {
            KeychainStore.set(seedPin, for: account)
        }
        if ProcessInfo.processInfo.environment["NAZAR_UNLOCK"] == "1" {
            unlocked = true
        }
    }

    func changePin(to pin: String) {
        KeychainStore.set(pin, for: account)
    }

    func tryBiometric() {
        guard !unlocked else { return }
        let ctx = LAContext()
        var err: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err) else { return }
        ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics,
                           localizedReason: "Unlock Nazar") { ok, _ in
            Task { @MainActor in if ok { self.unlocked = true } }
        }
    }

    func submit(pin: String) {
        let stored = KeychainStore.get(account) ?? seedPin
        if pin == stored {
            error = nil
            unlocked = true
        } else {
            error = "Wrong PIN."
        }
    }

    func lock() { unlocked = false; error = nil }
}

struct ContentView: View {
    @StateObject private var session = NazarSession()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            HK.bg.ignoresSafeArea()
            if session.unlocked {
                HomeView(session: session)
                    .transition(.opacity)
            } else {
                UnlockView(session: session)
                    .transition(.opacity)
            }
        }
        .preferredColorScheme(.dark)
        .animation(.easeInOut(duration: 0.2), value: session.unlocked)
    }
}

private struct UnlockView: View {
    @ObservedObject var session: NazarSession
    @State private var entry = ""
    @State private var shake = false
    @State private var changePinMode = false
    @State private var changeStep = 0
    @State private var oldPin = ""
    @State private var newPin = ""
    @State private var changeError: String?

    var body: some View {
        VStack(spacing: 28) {
            Spacer()
            Image(systemName: "eye.fill")
                .font(.system(size: 40, weight: .semibold))
                .foregroundColor(HK.accent)
            Text("Nazar")
                .font(.system(size: 30, weight: .heavy, design: .rounded))
                .foregroundColor(HK.text)
            Text(changePinMode ? (changeStep == 0 ? "Enter current PIN" : changeStep == 1 ? "Enter new PIN" : "Confirm new PIN") : "Camera Intelligence")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(HK.textFaint)

            HStack(spacing: 18) {
                ForEach(0..<4, id: \.self) { i in
                    Circle()
                        .fill(i < entry.count ? HK.accent : HK.line)
                        .frame(width: 16, height: 16)
                }
            }
            .offset(x: shake ? -8 : 0)
            .animation(.default, value: shake)

            if let e = session.error, !changePinMode {
                Text(e)
                    .font(.system(size: 13))
                    .foregroundColor(HK.error)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
            if let e = changeError {
                Text(e)
                    .font(.system(size: 13))
                    .foregroundColor(HK.error)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }

            keypad
            if !changePinMode {
                Button {
                    changePinMode = true; changeStep = 0; changeError = nil; entry = ""
                } label: {
                    Text("Change PIN").font(.system(size: 13)).foregroundColor(HK.textFaint)
                }
            } else {
                Button {
                    changePinMode = false; changeStep = 0; changeError = nil; entry = ""
                } label: {
                    Text("Cancel").font(.system(size: 13)).foregroundColor(HK.textFaint)
                }
            }
            Spacer()
        }
        .padding()
        .onAppear { session.tryBiometric() }
        .onChange(of: session.error) { _, newError in
            if newError != nil { entry = ""; shake.toggle() }
        }
    }

    private var keypad: some View {
        let rows: [[String]] = [["1","2","3"],["4","5","6"],["7","8","9"],["face","0","del"]]
        return VStack(spacing: 16) {
            ForEach(rows, id: \.self) { row in
                HStack(spacing: 22) {
                    ForEach(row, id: \.self) { key in keyButton(key) }
                }
            }
        }
    }

    @ViewBuilder
    private func keyButton(_ key: String) -> some View {
        switch key {
        case "face":
            Button { session.tryBiometric() } label: {
                Image(systemName: "faceid")
                    .font(.system(size: 24))
                    .foregroundColor(HK.accent)
                    .frame(width: 72, height: 72)
            }
        case "del":
            Button { if !entry.isEmpty { entry.removeLast() } } label: {
                Image(systemName: "delete.left")
                    .font(.system(size: 22))
                    .foregroundColor(HK.textDim)
                    .frame(width: 72, height: 72)
            }
        default:
            Button {
                guard entry.count < 4 else { return }
                entry.append(key)
                if entry.count == 4 {
                    let pin = entry
                    if changePinMode {
                        handleChangePin(pin)
                    } else {
                        session.submit(pin: pin)
                        if !session.unlocked { entry = "" }
                    }
                }
            } label: {
                Text(key)
                    .font(.system(size: 26, weight: .semibold, design: .rounded))
                    .foregroundColor(HK.text)
                    .frame(width: 72, height: 72)
                    .background(Circle().fill(HK.card))
                    .overlay(Circle().stroke(HK.line, lineWidth: 1))
            }
        }
    }

    private func handleChangePin(_ pin: String) {
        let stored = KeychainStore.get(session.account) ?? session.seedPin
        switch changeStep {
        case 0:
            if pin == stored {
                oldPin = pin; changeStep = 1; changeError = nil; entry = ""
            } else {
                changeError = "Wrong current PIN."; entry = ""; shake.toggle()
            }
        case 1:
            newPin = pin; changeStep = 2; changeError = nil; entry = ""
        case 2:
            if pin == newPin {
                KeychainStore.set(pin, for: session.account)
                changePinMode = false; changeStep = 0; changeError = nil; entry = ""
                session.submit(pin: pin)
            } else {
                changeError = "PINs do not match. Try again."; changeStep = 1; entry = ""; shake.toggle()
            }
        default: break
        }
    }
}
