import Foundation
import Testing
@testable import TripPlannerCore

@MainActor
struct TripListTests {
    @Test func queriesOwnedActivityKindsWithoutLosingLiteralSearchCharacters() async throws {
        let transport = ActivityKindTransport()
        let api = TripPlannerAPI(tokenStore: TripListTokens(), transport: transport)
        _ = try api.restoreSession()
        let page = try await api.activityKinds(search: "Art & food + 100%", top: 3, skip: 6)
        #expect(page.kinds == ["Art & food + 100%", "夜景"])
        #expect(page.hasMore)
        let request = try #require(transport.request)
        let url = try #require(request.url)
        #expect(url.path == "/user/activity-kinds")
        #expect(!url.query!.contains("+"))
        let query = try #require(URLComponents(url: url, resolvingAgainstBaseURL: true)?.queryItems)
        #expect(query.first(where: { $0.name == "search" })?.value == "Art & food + 100%")
        #expect(query.first(where: { $0.name == "top" })?.value == "3")
        #expect(query.first(where: { $0.name == "skip" })?.value == "6")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer test")
    }

    @Test func followsTripListPagesAndDecodesDates() async throws {
        let transport = TripListTransport()
        let api = TripPlannerAPI(tokenStore: TripListTokens(), transport: transport)
        _ = try api.restoreSession()
        let trips = try await api.trips()
        #expect(trips.count == 11)
        #expect(trips.first?.startDate == "2030-06-15")
        #expect(trips.last?.name == "Trip 10")
        let queries = try transport.requests.map { request in
            let url = try #require(request.url)
            return try #require(URLComponents(url: url, resolvingAgainstBaseURL: true)?.queryItems)
        }
        #expect(queries.map { $0.first(where: { $0.name == "skip" })?.value } == ["0", "10"])
        #expect(queries.allSatisfy { $0.first(where: { $0.name == "today" })?.value?.count == 10 })
    }
}

@MainActor
private final class ActivityKindTransport: TripHTTPTransport {
    private(set) var request: URLRequest?
    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        self.request = request
        let url = try #require(request.url)
        let response = try #require(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil))
        return (try JSONSerialization.data(withJSONObject: ["kinds": ["Art & food + 100%", "夜景"], "hasMore": true]), response)
    }
}

@MainActor
private final class TripListTransport: TripHTTPTransport {
    private(set) var requests: [URLRequest] = []

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        requests.append(request)
        let url = try #require(request.url)
        let offset = requests.count == 1 ? 0 : 10
        let trips: [[String: Any]] = (offset..<(offset == 0 ? 10 : 11)).map { index in
            ["id": UUID().uuidString, "ownerUserId": UUID().uuidString, "canPlan": true,
             "name": "Trip \(index)", "description": "", "constraints": [:],
             "createdAt": "2029-01-01T00:00:00Z", "updatedAt": "2029-01-01T00:00:00Z",
             "startDate": "2030-06-15", "endDate": "2030-06-20"]
        }
        let body = try JSONSerialization.data(withJSONObject: ["trips": trips, "hasMore": offset == 0])
        let response = try #require(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil))
        return (body, response)
    }
}

private struct TripListTokens: TokenStoring {
    func load() throws -> OAuthTokens? {
        OAuthTokens(accessToken: "test", refreshToken: nil, expiresAt: Date().addingTimeInterval(3600))
    }
    func save(_ tokens: OAuthTokens) throws {}
    func remove() throws {}
}
