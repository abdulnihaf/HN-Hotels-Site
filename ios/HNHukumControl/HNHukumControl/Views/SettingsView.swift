import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var settings: HukumSettings
    @Environment(\.dismiss) private var dismiss
    @State private var tokenDraft = ""
    @State private var saved = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    field("Bridge URL", text: $settings.bridgeURL)
                    SecureField("Token", text: $tokenDraft)
                        .textInputAutocapitalization(.never)
                        .foregroundStyle(HK.text)
                    Button {
                        settings.authToken = tokenDraft
                        saved = true
                    } label: {
                        Label(saved ? "Token saved" : "Save token",
                              systemImage: saved ? "checkmark.circle.fill" : "key.fill")
                            .foregroundStyle(saved ? HK.ready : HK.accent)
                    }
                    presetButton("Use Tailscale bridge", "http://100.75.28.7:8790", \.bridgeURL)
                    presetButton("Use HTTPS bridge", "https://hukum.hnhotels.in", \.bridgeURL)
                } header: { header("Bridge") } footer: {
                    Text(settings.isSecureBridge ? "Secure HTTPS connection." : "Private Tailscale connection — use HTTPS for off-network access.")
                        .foregroundStyle(HK.textFaint)
                }
                .listRowBackground(HK.card)

                Section {
                    field("Nazar URL", text: $settings.nazarURL)
                    presetButton("Use RTX Tailscale Nazar", "http://100.107.54.16:8080", \.nazarURL)
                    presetButton("Use public Nazar", "https://nazar.hnhotels.in", \.nazarURL)
                } header: { header("Nazar") }
                .listRowBackground(HK.card)

                Section {
                    field("Selected lane phrase", text: $settings.selectedLanePhrase)
                } header: { header("Voice default") } footer: {
                    Text("Which lane Siri targets when you don't name one.")
                        .foregroundStyle(HK.textFaint)
                }
                .listRowBackground(HK.card)
            }
            .scrollContentBackground(.hidden)
            .background(HK.bg.ignoresSafeArea())
            .tint(HK.accent)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.foregroundStyle(HK.accent).fontWeight(.semibold)
                }
            }
            .onAppear { tokenDraft = settings.authToken }
            .onChange(of: tokenDraft) { _, _ in saved = false }
        }
    }

    private func field(_ title: String, text: Binding<String>) -> some View {
        TextField(title, text: text)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .keyboardType(.URL)
            .foregroundStyle(HK.text)
    }

    private func presetButton(_ label: String, _ value: String, _ key: ReferenceWritableKeyPath<HukumSettings, String>) -> some View {
        Button(label) { settings[keyPath: key] = value }
            .foregroundStyle(HK.textDim)
    }

    private func header(_ t: String) -> some View {
        Text(t).foregroundStyle(HK.textDim)
    }
}
