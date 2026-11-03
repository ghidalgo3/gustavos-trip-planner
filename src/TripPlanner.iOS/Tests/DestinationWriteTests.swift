import Foundation
import Testing
@testable import TripPlannerCore

@MainActor
struct DestinationWriteTests {
    private func write(api: TripPlannerAPI, tripID: UUID, cityID: String, stayID: UUID?, version: ResourceVersion? = nil) async throws {
        if let stayID {
            try await api.updateDestinationStay(tripID: tripID, cityID: cityID, stayID: stayID,
                request: DestinationStayRequest(arrivalDate: "2027-04-09", departureDate: "2027-04-12"), version: version)
        } else {
            let request = DestinationUpdateRequest(id: cityID,
                city: DestinationCity(name: "Tokyo", countryCode: "JP", longitude: 139.7, latitude: 35.7),
                existing: DestinationResource(properties: .init(constraints: nil)))
            try await api.updateDestination(tripID: tripID, cityID: cityID, request: request, version: version)
        }
    }

    @Test(arguments: [false, true])
    func destinationUpdatesUseTheVersionFromTheEditingSession(editStay: Bool) async throws {
        let transport = DestinationTransport()
        let api = TripPlannerAPI(tokenStore: DestinationTokens(), transport: transport)
        #expect(try api.restoreSession())
        let tripID = UUID()
        let stayID = editStay ? UUID() : nil
        try await write(api: api, tripID: tripID, cityID: "tokyo", stayID: stayID, version: ResourceVersion(etag: "\"editing-version\"", data: transport.feature))
        #expect(transport.requests.map(\.httpMethod) == ["PUT"])
        let expected = "/trips/\(tripID.uuidString.lowercased())/destinations/tokyo"
            + (stayID.map { "/stays/\($0.uuidString.lowercased())" } ?? "")
        #expect(transport.requests.allSatisfy { $0.url?.path == expected })
        #expect(transport.requests.last?.value(forHTTPHeaderField: "If-Match") == "\"editing-version\"")
    }

    @Test(arguments: [false, true])
    func missingEditingVersionPreventsAnUnconditionalWrite(editStay: Bool) async throws {
        let transport = DestinationTransport()
        transport.etag = nil
        let api = TripPlannerAPI(tokenStore: DestinationTokens(), transport: transport)
        _ = try api.restoreSession()
        do {
            try await write(api: api, tripID: UUID(), cityID: "tokyo", stayID: editStay ? UUID() : nil)
            Issue.record("A missing ETag must prevent saving")
        } catch APIError.server(let status, _) {
            #expect(status == 428)
        }
        #expect(transport.requests.map(\.httpMethod) == [])
    }

    @Test(arguments: [false, true])
    func conflictIsReportedWithoutRetryingTheWrite(editStay: Bool) async throws {
        let transport = DestinationTransport()
        transport.writeStatus = 412
        let api = TripPlannerAPI(tokenStore: DestinationTokens(), transport: transport)
        _ = try api.restoreSession()
        do {
            try await write(api: api, tripID: UUID(), cityID: "tokyo", stayID: editStay ? UUID() : nil, version: ResourceVersion(etag: "\"stale-version\"", data: transport.feature))
            Issue.record("A conflict must be reported")
        } catch APIError.server(let status, _) {
            #expect(status == 412)
        }
        #expect(transport.requests.map(\.httpMethod) == ["PUT"])
    }
}

@MainActor
private final class DestinationTransport: TripHTTPTransport {
    var requests: [URLRequest] = []
    var etag: String? = "\"destination-version\""
    var writeStatus = 200
    let feature: JSONValue = .object([
        "type": .string("Feature"),
        "geometry": .object([
            "type": .string("Point"), "coordinates": .array([.number(139.7), .number(35.7)])
        ]),
        "properties": .object(["name": .string("Tokyo"), "countryCode": .string("JP")])
    ])

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        requests.append(request)
        let isRead = request.httpMethod == "GET"
        let headers = isRead ? etag.map { ["ETag": $0] } : nil
        let response = HTTPURLResponse(url: request.url!, statusCode: isRead ? 200 : writeStatus,
                                       httpVersion: nil, headerFields: headers)!
        return (try JSONEncoder().encode(feature), response)
    }
}

private struct DestinationTokens: TokenStoring {
    func load() throws -> OAuthTokens? {
        OAuthTokens(accessToken: "test", refreshToken: nil, expiresAt: Date().addingTimeInterval(3600))
    }
    func save(_ tokens: OAuthTokens) throws {}
    func remove() throws {}
}
