import SwiftUI

// First screen: connect the phone to a household with the code from Dashboard > Settings > Scanning app.
struct PairView: View {
    @EnvironmentObject private var store: ScanStore
    @State private var server = ""
    @State private var code = ""

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            LanternGlow()

            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Lantern").font(Theme.heading(48, light: true)).foregroundStyle(Theme.text)
                        Eyebrow(text: "Home scan")
                    }
                    .padding(.top, 56)

                    Text("Measure the home once with this phone. Lantern turns the scan into a safety check and a live map for caregivers.")
                        .font(Theme.body(16))
                        .foregroundStyle(Theme.muted)

                    Card {
                        ThemedField(title: "Website address", text: $server, mono: true)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()

                        ThemedField(title: "Pairing code", text: $code, placeholder: "ABC234", mono: true, big: true)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .onChange(of: code) { _, new in code = String(new.uppercased().prefix(6)) }

                        Button {
                            Task { await store.pair(server: server, code: code) }
                        } label: {
                            if store.isBusy { ProgressView().tint(Theme.onAccent) } else { Text("Pair this phone") }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(store.isBusy || code.count < 6 || server.isEmpty)

                        if !store.status.isEmpty {
                            Label(store.status, systemImage: "exclamationmark.circle")
                                .font(Theme.body(14))
                                .foregroundStyle(Theme.alert)
                        }
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Eyebrow(text: "Where is the code?")
                        Text("On your computer, open the Lantern dashboard, go to Settings, and tap Pair a phone. Codes last 24 hours.")
                        Text(verbatim: "Testing locally? Use your Mac's network address, like http://192.168.1.10:3000.")
                    }
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 40)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .onAppear { server = store.serverURL }
    }
}
