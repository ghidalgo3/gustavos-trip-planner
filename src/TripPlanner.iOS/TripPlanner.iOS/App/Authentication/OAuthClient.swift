import CryptoKit
import Foundation
import OSLog
import Security

struct OAuthConfiguration: Sendable {
    let issuer = URL(string: "https://tripplanner-api-anzhwrxrdh2lu.azurewebsites.net/")!
    let clientID = "tripplanner-ios"
    let callbackScheme = "tripplanner"
    let redirectURI = "tripplanner://oauth/callback"

    var apiResource: String {
        URL(string: "api", relativeTo: issuer)!.absoluteString
    }
}

struct AuthorizationAttempt: Sendable {
    let authorizationURL: URL
    let state: String
    let codeVerifier: String
}

enum IdentityProvider: Sendable {
    case google
    case microsoft

    var serverPathComponent: String {
        switch self {
        case .google: "google"
        case .microsoft: "aad"
        }
    }
}

struct OAuthClient: Sendable {
    private static let signInLog = Logger(subsystem: Bundle.main.bundleIdentifier ?? "TripPlanner", category: "SignIn")

    let configuration: OAuthConfiguration
    let tokenStore: any TokenStoring

    func makeAuthorizationAttempt(provider: IdentityProvider) throws -> AuthorizationAttempt {
        let verifier = try randomURLSafeString(byteCount: 32)
        let state = try randomURLSafeString(byteCount: 24)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncodedString()

        var components = URLComponents(
            url: URL(string: "oauth/authorize", relativeTo: configuration.issuer)!,
            resolvingAgainstBaseURL: true
        )!
        components.queryItems = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: configuration.clientID),
            URLQueryItem(name: "redirect_uri", value: configuration.redirectURI),
            URLQueryItem(name: "scope", value: "tripplanner.read tripplanner.write offline_access"),
            URLQueryItem(name: "resource", value: configuration.apiResource),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state),
        ]
        guard let authorizationURL = components.url,
              let authorizationComponents = URLComponents(
                url: authorizationURL,
                resolvingAgainstBaseURL: false
              )
        else {
            throw OAuthError.invalidAuthorizationURL
        }

        var providerLogin = URLComponents(
            url: URL(
                string: ".auth/login/\(provider.serverPathComponent)",
                relativeTo: configuration.issuer
            )!,
            resolvingAgainstBaseURL: true
        )!
        var authorizationRedirect = authorizationComponents.path
        if let query = authorizationComponents.percentEncodedQuery {
            authorizationRedirect += "?\(query)"
        }
        providerLogin.queryItems = [
            URLQueryItem(name: "post_login_redirect_uri", value: authorizationRedirect)
        ]
        guard let providerURL = providerLogin.url else {
            throw OAuthError.invalidAuthorizationURL
        }
        return AuthorizationAttempt(
            authorizationURL: providerURL,
            state: state,
            codeVerifier: verifier
        )
    }

    func exchange(callbackURL: URL, attempt: AuthorizationAttempt) async throws -> OAuthTokens {
        let items = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let error = items.value(named: "error") {
            Self.signInLog.error("OAuth callback reported an authorization error")
            throw OAuthError.authorizationRejected(items.value(named: "error_description") ?? error)
        }
        guard items.value(named: "state") == attempt.state else {
            Self.signInLog.error("OAuth callback state did not match the authorization attempt")
            throw OAuthError.invalidState
        }
        guard let code = items.value(named: "code") else {
            Self.signInLog.error("OAuth callback was missing the authorization code")
            throw OAuthError.missingAuthorizationCode
        }
        Self.signInLog.notice("Starting authorization code exchange")
        do {
            let tokens = try await requestTokens([
                "grant_type": "authorization_code",
                "client_id": configuration.clientID,
                "code": code,
                "redirect_uri": configuration.redirectURI,
                "resource": configuration.apiResource,
                "code_verifier": attempt.codeVerifier,
            ], previousRefreshToken: nil)
            Self.signInLog.notice("Authorization code exchange succeeded")
            return tokens
        } catch {
            let failure = error as NSError
            Self.signInLog.error(
                "Authorization code exchange failed (domain: \(failure.domain, privacy: .public), code: \(failure.code))"
            )
            throw error
        }
    }

    func refresh(_ refreshToken: String) async throws -> OAuthTokens {
        try await requestTokens([
            "grant_type": "refresh_token",
            "client_id": configuration.clientID,
            "refresh_token": refreshToken,
            "resource": configuration.apiResource,
        ], previousRefreshToken: refreshToken)
    }

    private func requestTokens(
        _ parameters: [String: String],
        previousRefreshToken: String?
    ) async throws -> OAuthTokens {
        var request = URLRequest(url: URL(string: "oauth/token", relativeTo: configuration.issuer)!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = parameters.formEncodedData

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            if let http = response as? HTTPURLResponse {
                Self.signInLog.error("Token endpoint returned HTTP \(http.statusCode)")
            }
            let problem = try? JSONDecoder().decode(OAuthProblem.self, from: data)
            throw OAuthError.tokenExchangeFailed(
                problem?.errorDescription ?? problem?.error ?? "The authentication server rejected the token request."
            )
        }
        let payload = try JSONDecoder().decode(TokenResponse.self, from: data)
        let tokens = OAuthTokens(
            accessToken: payload.accessToken,
            refreshToken: payload.refreshToken ?? previousRefreshToken,
            expiresAt: Date().addingTimeInterval(TimeInterval(payload.expiresIn))
        )
        return tokens
    }

    private func randomURLSafeString(byteCount: Int) throws -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else {
            throw OAuthError.randomGenerationFailed
        }
        return Data(bytes).base64URLEncodedString()
    }
}

private struct TokenResponse: Decodable {
    let accessToken: String
    let refreshToken: String?
    let expiresIn: Int

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
    }
}

private struct OAuthProblem: Decodable {
    let error: String?
    let errorDescription: String?

    enum CodingKeys: String, CodingKey {
        case error
        case errorDescription = "error_description"
    }
}

enum OAuthError: LocalizedError {
    case invalidAuthorizationURL
    case invalidState
    case missingAuthorizationCode
    case authorizationRejected(String)
    case tokenExchangeFailed(String)
    case randomGenerationFailed

    var errorDescription: String? {
        switch self {
        case .invalidAuthorizationURL: "Unable to create the sign-in request."
        case .invalidState: "The sign-in response could not be verified."
        case .missingAuthorizationCode: "The sign-in response did not contain an authorization code."
        case .authorizationRejected(let message): message
        case .tokenExchangeFailed(let message): message
        case .randomGenerationFailed: "Unable to securely start sign-in."
        }
    }
}

private extension Collection where Element == URLQueryItem {
    func value(named name: String) -> String? {
        first(where: { $0.name == name })?.value
    }
}

private extension Dictionary where Key == String, Value == String {
    var formEncodedData: Data {
        var components = URLComponents()
        components.queryItems = map(URLQueryItem.init(name:value:))
        return Data((components.percentEncodedQuery ?? "").utf8)
    }
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
