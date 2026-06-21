import SwiftUI
import LocalAuthentication

@MainActor
final class DarbarSession: ObservableObject {
    @Published var unlocked = false
    @Published var error: String?
    @Published var verifying = false

    private let account = "owner-pin"
    private let seedPin = "0305"

    var hasStoredPin: Bool { KeychainStore.get(account) != nil }

    init() {
        // Env override for simulator verification.
        if ProcessInfo.processInfo.environment["DARBAR_UNLOCK"] == "1" {
            unlocked = true
        }
        if KeychainStore.get(account) == nil {
            // First run: seed the owner PIN so Face ID has something to guard.
            KeychainStore.set(seedPin, for: account)
        }
    }

    func tryBiometric() {
        guard hasStoredPin, !unlocked else { return }
        let ctx = LAContext()
        var err: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err) else { return }
        ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics,
                           localizedReason: "Unlock Darbar") { ok, _ in
            Task { @MainActor in if ok { self.unlocked = true } }
        }
    }

    func submit(pin: String) {
        guard !verifying else { return }
        verifying = true
        error = nil
        Task {
            do {
                _ = try await DarbarClient.shared.verify(pin: pin)
                KeychainStore.set(pin, for: account)
                await MainActor.run {
                    self.unlocked = true
                    self.verifying = false
                }
            } catch {
                await MainActor.run {
                    self.error = (error as? DarbarError)?.errorDescription ?? error.localizedDescription
                    self.verifying = false
                }
            }
        }
    }

    func storedPin() -> String? { KeychainStore.get(account) }

    func signOut() {
        unlocked = false
        error = nil
    }
}

struct ContentView: View {
    @StateObject private var session = DarbarSession()

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
    @ObservedObject var session: DarbarSession
    @State private var entry = ""
    @State private var shake = false

    var body: some View {
        VStack(spacing: 28) {
            Spacer()
            Text("Darbar")
                .font(.system(size: 30, weight: .heavy, design: .rounded))
                .foregroundColor(HK.text)
            Text("darbar.hnhotels.in")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(HK.textFaint)

            // 4-dot indicator
            HStack(spacing: 18) {
                ForEach(0..<4, id: \.self) { i in
                    Circle()
                        .fill(i < entry.count ? HK.accent : HK.line)
                        .frame(width: 16, height: 16)
                }
            }
            .offset(x: shake ? -8 : 0)
            .animation(.default, value: shake)

            if let e = session.error {
                Text(e)
                    .font(.system(size: 13))
                    .foregroundColor(HK.error)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }

            keypad
            Spacer()
        }
        .padding()
        .onAppear { session.tryBiometric() }
        .onChange(of: session.error) { _ in
            if session.error != nil {
                entry = ""
                shake.toggle()
            }
        }
    }

    private var keypad: some View {
        let rows: [[String]] = [["1","2","3"], ["4","5","6"], ["7","8","9"], ["face","0","del"]]
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
                guard entry.count < 4, !session.verifying else { return }
                entry.append(key)
                if entry.count == 4 {
                    let pin = entry
                    session.submit(pin: pin)
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
}
