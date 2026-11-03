import Foundation

@MainActor
protocol DestinationServing {
    func createDestination(tripID: UUID, request: DestinationCreateRequest) async throws
    func updateDestination(tripID: UUID, cityID: String, request: DestinationUpdateRequest, version: ResourceVersion?) async throws
    func updateDestinationStay(tripID: UUID, cityID: String, stayID: UUID, request: DestinationStayRequest, version: ResourceVersion?) async throws
}

@MainActor
protocol TripPlannerServing: DestinationServing {
    func restoreSession() throws -> Bool
    func makeAuthorizationAttempt(provider: IdentityProvider) throws -> AuthorizationAttempt
    func finishAuthorization(callbackURL: URL, attempt: AuthorizationAttempt) async throws
    func currentUser() async throws -> CurrentUser
    func trips() async throws -> [Trip]
    func trip(id: UUID) async throws -> Trip
    func snapshot(id: UUID) async throws -> Data
    func importTrip(_ write: PendingTripWrite) async throws -> Trip
    func updateTrip(_ trip: Trip, name: String, description: String) async throws -> Trip
    func deleteTrip(_ trip: Trip) async throws
    func signOut() throws
}

extension DestinationServing {
    func createDestination(tripID: UUID, request: DestinationCreateRequest) async throws { throw APIError.invalidResponse }
    func updateDestination(tripID: UUID, cityID: String, request: DestinationUpdateRequest, version: ResourceVersion?) async throws { throw APIError.invalidResponse }
    func updateDestinationStay(tripID: UUID, cityID: String, stayID: UUID, request: DestinationStayRequest, version: ResourceVersion?) async throws { throw APIError.invalidResponse }
}

@MainActor
final class TripPlannerAPI: TripPlannerServing {
    private let transport: any TripHTTPTransport
    private let baseURL: URL
    private let oauthClient: OAuthClient
    private let tokenStore: any TokenStoring
    private var tokens: OAuthTokens?
    private var sessionGeneration = 0
    private var refreshTask: Task<OAuthTokens, Error>?

    init(
        configuration: OAuthConfiguration? = nil,
        tokenStore: (any TokenStoring)? = nil,
        transport: (any TripHTTPTransport)? = nil
    ) {
        let configuration = configuration ?? OAuthConfiguration()
        let tokenStore = tokenStore ?? KeychainTokenStore()
        // The OAuth resource ends in /api, but REST endpoints are mounted at the root.
        self.transport = transport ?? URLSessionTripTransport()
        self.baseURL = configuration.issuer
        self.tokenStore = tokenStore
        self.oauthClient = OAuthClient(configuration: configuration, tokenStore: tokenStore)
    }

    func restoreSession() throws -> Bool {
        tokens = try tokenStore.load()
        return tokens != nil
    }

    func makeAuthorizationAttempt(provider: IdentityProvider) throws -> AuthorizationAttempt {
        try oauthClient.makeAuthorizationAttempt(provider: provider)
    }

    func finishAuthorization(
        callbackURL: URL,
        attempt: AuthorizationAttempt
    ) async throws {
        let ticket = sessionGeneration
        let result = try await oauthClient.exchange(callbackURL: callbackURL, attempt: attempt)
        guard ticket == sessionGeneration else { throw CancellationError() }
        try tokenStore.save(result)
        tokens = result
    }

    func currentUser() async throws -> CurrentUser {
        try await send(path: "user")
    }

    func trips() async throws -> [Trip] {
        try await send(path: "trips")
    }

    func trip(id: UUID) async throws -> Trip {
        try await send(path: "trips/\(id.uuidString.lowercased())")
    }

    func snapshot(id: UUID) async throws -> Data {
        let data = try await responseData(path: "trips/\(id.uuidString.lowercased())/snapshot")
        try await validateSnapshot(data, id: id)
        return data
    }

    @concurrent
    private nonisolated func validateSnapshot(_ data: Data, id: UUID) async throws {
        let header = try JSONDecoder().decode(SnapshotHeader.self, from: data)
        guard header.schemaVersion == 1,
              header.id == "urn:uuid:\(id.uuidString.lowercased())" else {
            throw APIError.invalidResponse
        }
    }

    func createDestination(tripID: UUID, request: DestinationCreateRequest) async throws {
        try await writeDestination(tripID: tripID, cityID: nil, stayID: nil, body: request)
    }

    func updateDestination(tripID: UUID, cityID: String, request: DestinationUpdateRequest, version: ResourceVersion?) async throws {
        try await writeDestination(tripID: tripID, cityID: cityID, stayID: nil, body: request, version: version)
    }

    func updateDestinationStay(tripID: UUID, cityID: String, stayID: UUID, request: DestinationStayRequest, version: ResourceVersion?) async throws {
        try await writeDestination(tripID: tripID, cityID: cityID, stayID: stayID, body: request, version: version)
    }

    private func writeDestination(tripID: UUID, cityID: String?, stayID: UUID?, body: any Encodable, version: ResourceVersion? = nil) async throws {
        let path = "trips/\(tripID.uuidString.lowercased())/destinations"
        if let cityID {
            guard let version, !version.etag.isEmpty else {
                throw APIError.server(status: 428, message: "Refresh this destination before editing it.")
            }
            var allowed = CharacterSet.urlPathAllowed
            allowed.remove(charactersIn: "/%")
            guard let city = cityID.addingPercentEncoding(withAllowedCharacters: allowed) else {
                throw APIError.invalidResponse
            }
            if let stayID {
                let resourcePath = "\(path)/\(city)/stays/\(stayID.uuidString.lowercased())"
                _ = try await responseData(
                    path: resourcePath, method: "PUT", body: body,
                    etag: version.etag
                )
            } else {
                _ = try await responseData(
                    path: "\(path)/\(city)", method: "PUT", body: body,
                    etag: version.etag
                )
            }
        } else if cityID == nil && stayID == nil {
            _ = try await responseData(path: path, method: "POST", body: body)
        } else {
            throw APIError.invalidResponse
        }
    }

    func importTrip(_ write: PendingTripWrite) async throws -> Trip {
        try await send(
            path: "trips/\(write.base.id.uuidString.lowercased())/snapshot",
            method: "PUT",
            body: write.snapshotDocument
        )
    }

    func createTrip(name: String, description: String) async throws -> Trip {
        try await send(
            path: "trips",
            method: "POST",
            body: TripInput(name: name, description: description, constraints: .object([:]))
        )
    }

    func updateTrip(_ trip: Trip, name: String, description: String) async throws -> Trip {
        try await send(
            path: "trips/\(trip.id.uuidString.lowercased())",
            method: "PUT",
            body: TripInput(name: name, description: description, constraints: trip.constraints),
            etag: try requiredETag(trip)
        )
    }

    func deleteTrip(_ trip: Trip) async throws {
        let _: EmptyResponse = try await send(
            path: "trips/\(trip.id.uuidString.lowercased())",
            method: "DELETE",
            etag: try requiredETag(trip)
        )
    }

    func signOut() throws {
        sessionGeneration += 1
        refreshTask?.cancel()
        refreshTask = nil
        tokens = nil
        try tokenStore.remove()
    }

    private func refreshTokens(_ refreshToken: String) async throws -> OAuthTokens {
        if let refreshTask { return try await refreshTask.value }
        let ticket = sessionGeneration
        let task = Task { try await oauthClient.refresh(refreshToken) }
        refreshTask = task
        defer { if ticket == sessionGeneration { refreshTask = nil } }
        let result = try await task.value
        guard ticket == sessionGeneration else { throw CancellationError() }
        try tokenStore.save(result)
        tokens = result
        return result
    }

    private func requiredETag(_ trip: Trip) throws -> String {
        guard let etag = trip.etag, !etag.isEmpty else {
            throw APIError.server(status: 428, message: "Refresh this trip before editing it.")
        }
        return etag
    }

    private func send<Response: Decodable>(
        path: String,
        method: String = "GET",
        body: (any Encodable)? = nil,
        etag: String? = nil
    ) async throws -> Response {
        let data = try await responseData(path: path, method: method, body: body, etag: etag)
        if Response.self == EmptyResponse.self {
            return EmptyResponse() as! Response
        }
        return try JSONDecoder.tripPlanner.decode(Response.self, from: data)
    }

    private func responseData(
        path: String,
        method: String = "GET",
        body: (any Encodable)? = nil,
        etag: String? = nil,
        mayRefresh: Bool = true
    ) async throws -> Data {
        let ticket = sessionGeneration
        guard var activeTokens = tokens else {
            throw APIError.unauthorized
        }
        if activeTokens.expiresAt <= Date().addingTimeInterval(30),
           let refreshToken = activeTokens.refreshToken {
            activeTokens = try await refreshTokens(refreshToken)
            guard ticket == sessionGeneration else { throw CancellationError() }
        }

        var request = URLRequest(url: URL(string: path, relativeTo: baseURL)!)
        request.httpMethod = method
        request.setValue(etag, forHTTPHeaderField: "If-Match")
        request.setValue("Bearer \(activeTokens.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder.tripPlanner.encode(AnyEncodable(body))
        }

        let (data, response) = try await transport.data(for: request)
        guard ticket == sessionGeneration else { throw CancellationError() }
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if http.statusCode == 401, mayRefresh, let refreshToken = activeTokens.refreshToken {
            _ = try await refreshTokens(refreshToken)
            guard ticket == sessionGeneration else { throw CancellationError() }
            return try await self.responseData(path: path, method: method, body: body, etag: etag, mayRefresh: false)
        }
        guard (200..<300).contains(http.statusCode) else {
            let problem = try? JSONDecoder().decode(ProblemDetails.self, from: data)
            throw APIError.server(status: http.statusCode, message: problem?.title)
        }
        return data
    }
}

private struct EmptyResponse: Decodable {}

private nonisolated struct SnapshotHeader: Decodable {
    let id: String
    let schemaVersion: Int

    private enum CodingKeys: String, CodingKey {
        case id = "@id"
        case schemaVersion, resources
    }

    init(from decoder: any Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        id = try fields.decode(String.self, forKey: .id)
        schemaVersion = try fields.decode(Int.self, forKey: .schemaVersion)
        _ = try fields.nestedContainer(keyedBy: CodingKeys.self, forKey: .resources)
    }
}

private struct ProblemDetails: Decodable {
    let title: String?
}

private struct AnyEncodable: Encodable {
    private let encodeValue: (any Encoder) throws -> Void

    init(_ value: any Encodable) {
        encodeValue = value.encode
    }

    func encode(to encoder: any Encoder) throws {
        try encodeValue(encoder)
    }
}

enum APIError: LocalizedError {
    case unauthorized
    case invalidResponse
    case server(status: Int, message: String?)

    var errorDescription: String? {
        switch self {
        case .unauthorized:
            "Please sign in again."
        case .invalidResponse:
            "The server returned an invalid response."
        case .server(let status, let message):
            message ?? "The server returned status \(status)."
        }
    }
}

private extension JSONDecoder {
    static var tripPlanner: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let value = try decoder.singleValueContainer().decode(String.self)
            if let date = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(value) {
                return date
            }
            return try Date.ISO8601FormatStyle().parse(value)
        }
        return decoder
    }
}

private extension JSONEncoder {
    static var tripPlanner: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}
