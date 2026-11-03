import AuthenticationServices
import OSLog
import SwiftUI

struct SignInView: View {
    private static let signInLog = Logger(subsystem: Bundle.main.bundleIdentifier ?? "TripPlanner", category: "SignIn")

    let model: AppModel
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @Environment(\.dismiss) private var dismiss
    @State private var signingInProvider: IdentityProvider?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 24) {
                Spacer()
                Image(systemName: "airplane.departure")
                    .font(.system(.largeTitle, design: .rounded, weight: .semibold))
                    .foregroundStyle(.tint)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 8) {
                    Text("Plan the trip, enjoy the journey.")
                        .font(.largeTitle.bold())
                    Text("Sign in for cloud trips, flight search, and collaboration. Your device trips stay here until you choose Move to cloud.")
                        .foregroundStyle(.secondary)
                }
                if let errorMessage = model.errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                        .font(.callout)
                }
                Button {
                    signIn(with: .google)
                } label: {
                    Label("Sign in with Google", systemImage: "globe")
                        .frame(maxWidth: .infinity, minHeight: 36)
                }
                .buttonStyle(.borderedProminent)
                .disabled(signingInProvider != nil)

                Button {
                    signIn(with: .microsoft)
                } label: {
                    Label("Sign in with Microsoft", systemImage: "window.casement")
                        .frame(maxWidth: .infinity, minHeight: 36)
                }
                .buttonStyle(.bordered)
                .disabled(signingInProvider != nil)

                Button {} label: {
                    Label("Sign in with Apple", systemImage: "apple.logo")
                        .frame(maxWidth: .infinity, minHeight: 36)
                }
                .buttonStyle(.bordered)
                .disabled(true)
                .accessibilityHint("Sign in with Apple is not available yet")
                Spacer()
            }
            .padding()
            .navigationTitle("Sign in")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark") { dismiss() }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.bordered)
                        .disabled(signingInProvider != nil)
                }
            }
        }
    }

    private func signIn(with provider: IdentityProvider) {
        signingInProvider = provider
        Task {
            do {
                let authorizationURL = try await model.beginSignIn(provider: provider)
                Self.signInLog.notice("Opening web authentication session")
                let callbackURL = try await webAuthenticationSession.authenticate(
                    using: authorizationURL,
                    callbackURLScheme: OAuthConfiguration().callbackScheme
                )
                Self.signInLog.notice("Received OAuth callback from web authentication session")
                await model.completeSignIn(callbackURL: callbackURL)
            } catch {
                let failure = error as NSError
                Self.signInLog.error(
                    "Sign-in setup or web authentication failed (domain: \(failure.domain, privacy: .public), code: \(failure.code))"
                )
                model.cancelSignIn(with: error)
            }
            signingInProvider = nil
        }
    }
}
#Preview("Sign in") {
    TripPreview { SignInView(model: $0) }
}
