import Foundation

@MainActor
protocol DestinationServing {
    func deleteDestination(tripID: UUID, cityID: String, version: ResourceVersion?) async throws
    func createDestination(tripID: UUID, request: DestinationCreateRequest) async throws
    func updateDestination(tripID: UUID, cityID: String, request: DestinationUpdateRequest, version: ResourceVersion?) async throws
    func updateDestinationStay(tripID: UUID, cityID: String, stayID: UUID, request: DestinationStayRequest, version: ResourceVersion?) async throws
}

@MainActor
protocol TransferFlightServing {
    func searchTransferFlights(tripID: UUID, from origin: UUID?, to destination: UUID?) async throws -> [[TransferFlight.Segment]]
    func airportCoordinate(code: String) async throws -> RouteCoordinate?
}

@MainActor
protocol TripPlannerServing: DestinationServing, TransferFlightServing {
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

extension TransferFlightServing {
    func searchTransferFlights(tripID: UUID, from origin: UUID?, to destination: UUID?) async throws -> [[TransferFlight.Segment]] {
        throw APIError.invalidResponse
    }
    func airportCoordinate(code: String) async throws -> RouteCoordinate? { nil }
}

extension DestinationServing {
    func deleteDestination(tripID: UUID, cityID: String, version: ResourceVersion?) async throws { throw APIError.invalidResponse }
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

    func searchTransferFlights(tripID: UUID, from origin: UUID?, to destination: UUID?) async throws -> [[TransferFlight.Segment]] {
        let path = "trips/\(tripID.uuidString.lowercased())/flights"
        let planning: TransferFlightPlanning = try await send(path: "\(path)/constraints")
        guard let index = planning.legIndex(from: origin, to: destination) else {
            throw APIError.server(status: 409, message: "Refresh the trip before searching for this leg.")
        }

        try Task.checkCancellation()
        var operation: FlightSearchOperation = try await send(
            path: "\(path):search", method: "POST", body: FlightSearchRequest(requestId: UUID())
        )
        let pollDeadline = ContinuousClock.now + .seconds(300)
        while ["pending", "inprogress"].contains(operation.status.lowercased()) {
            guard ContinuousClock.now < pollDeadline else {
                throw APIError.server(status: 504, message: "The flight search is taking longer than expected.")
            }
            try await Task.sleep(for: .seconds(2))
            operation = try await send(path: "operations/\(operation.id.uuidString.lowercased())")
        }
        guard operation.status.lowercased() == "completed" else {
            throw APIError.server(status: 503, message: "The flight search could not finish. Try again.")
        }

        let results: [FlightSearchResponse]
        do {
            results = try await send(path: "\(path)/search")
        } catch APIError.server(status: 404, message: _) {
            return []
        }
        let current: TransferFlightPlanning = try await send(path: "\(path)/constraints")
        guard current == planning else {
            throw APIError.server(status: 409, message: "The itinerary changed. Refresh the trip and search again.")
        }
        var seen = Set<[TransferFlight.Segment]>()
        return results.flatMap { $0.response.flights ?? [] }.compactMap { flight in
            let segments = flight.leg.segments
            guard flight.legIndex == index, !segments.isEmpty, seen.insert(segments).inserted else { return nil }
            return segments
        }
    }

    func airportCoordinate(code: String) async throws -> RouteCoordinate? {
        var query = URLComponents()
        query.queryItems = [URLQueryItem(name: "q", value: code)]
        let airports: [TransferAirport] = try await send(path: "airports?\(query.percentEncodedQuery ?? "")")
        return airports.first { $0.code == code }.map {
            RouteCoordinate(latitude: $0.latitude, longitude: $0.longitude)
        }
    }

    func deleteDestination(tripID: UUID, cityID: String, version: ResourceVersion?) async throws {
        guard let version, !version.etag.isEmpty else {
            throw APIError.server(status: 428, message: "Refresh this destination before removing it.")
        }
        let path = try destinationPath(tripID: tripID, cityID: cityID)
        do {
            _ = try await responseData(path: path, method: "DELETE", etag: version.etag)
        } catch APIError.server(status: 404, message: _) {
            // A refresh confirms the server state if another client already removed the city.
        }
    }

    private func destinationPath(tripID: UUID, cityID: String) throws -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/%")
        guard let city = cityID.addingPercentEncoding(withAllowedCharacters: allowed) else {
            throw APIError.invalidResponse
        }
        return "trips/\(tripID.uuidString.lowercased())/destinations/\(city)"
    }

    private func writeDestination(tripID: UUID, cityID: String?, stayID: UUID?, body: any Encodable, version: ResourceVersion? = nil) async throws {
        let path = "trips/\(tripID.uuidString.lowercased())/destinations"
        if let cityID {
            guard let version, !version.etag.isEmpty else {
                throw APIError.server(status: 428, message: "Refresh this destination before editing it.")
            }
            let cityPath = try destinationPath(tripID: tripID, cityID: cityID)
            if let stayID {
                let resourcePath = "\(cityPath)/stays/\(stayID.uuidString.lowercased())"
                _ = try await responseData(
                    path: resourcePath, method: "PUT", body: body,
                    etag: version.etag
                )
            } else {
                _ = try await responseData(
                    path: cityPath, method: "PUT", body: body,
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

private struct FlightSearchRequest: Encodable { let requestId: UUID }

private struct FlightSearchOperation: Decodable {
    let id: UUID
    let status: String
}

private struct FlightSearchResponse: Decodable {
    struct Options: Decodable { let flights: [TransferFlight]? }
    let response: Options
}

private struct TransferAirport: Decodable {
    let code: String
    let latitude: Double
    let longitude: Double
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
