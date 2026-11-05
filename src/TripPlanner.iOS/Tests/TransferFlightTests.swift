import Foundation
import Testing
@testable import TripPlannerCore

@MainActor
struct TransferFlightTests {
    @Test func aSingleStayHasSeparateOutboundAndReturnSearchLegs() throws {
        let stay = UUID()
        let plan = try JSONDecoder().decode(
            TransferFlightPlanning.self,
            from: Data("{\"visits\":[{\"id\":\"\(stay)\"}]}".utf8)
        )

        #expect(plan.legIndex(from: nil, to: stay) == 0)
        #expect(plan.legIndex(from: stay, to: nil) == 1)
        #expect(plan.legIndex(from: nil, to: nil) == nil)
    }

    @Test(arguments: [true, false])
    func onlySearchesAdjacentStaysAndReturnsTheirFlightOptions(adjacent: Bool) async throws {
        let tripID = UUID()
        let stays = (0..<3).map { _ in UUID() }
        let plan = """
        {"visits":[{"id":"\(stays[0])"},{"id":"\(stays[1])"},{"id":"\(stays[2])"}]}
        """
        let segment = """
        {"departure_airport":"HND","arrival_airport":"ITM","departure_time_local":"2027-04-12T08:00:00","arrival_time_local":"2027-04-12T09:00:00"}
        """
        let unrelated = """
        {"departure_airport":"JFK","arrival_airport":"HND"}
        """
        let flights = """
        [{"response":{"flights":[
          {"legIndex":0,"leg":{"segments":[\(unrelated)]}},
          {"legIndex":1,"leg":{"segments":[\(segment)]}},
          {"legIndex":1,"leg":{"segments":[\(segment)]}},
          {"legIndex":2,"leg":{"segments":[\(unrelated)]}}
        ]}}]
        """
        let path = "/trips/\(tripID.uuidString.lowercased())/flights"
        let transport = TransferTransport(responses: [
            "\(path)/constraints": plan,
            "\(path):search": "{\"id\":\"\(UUID())\",\"status\":\"Completed\"}",
            "\(path)/search": flights
        ])
        let api = TripPlannerAPI(tokenStore: TransferTokens(), transport: transport)
        _ = try api.restoreSession()

        if adjacent {
            let options = try await api.searchTransferFlights(tripID: tripID, from: stays[0], to: stays[1])
            #expect(options.count == 1)
            #expect(options.first?.first?.arrivalAirport == "ITM")
            #expect(transport.requests.map(\.httpMethod) == ["GET", "POST", "GET", "GET"])
        } else {
            await #expect(throws: APIError.self) {
                try await api.searchTransferFlights(tripID: tripID, from: stays[0], to: stays[2])
            }
            #expect(transport.requests.map(\.httpMethod) == ["GET"])
        }
    }
}

@MainActor
private final class TransferTransport: TripHTTPTransport {
    let responses: [String: String]
    private(set) var requests: [URLRequest] = []

    init(responses: [String: String]) {
        self.responses = responses
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        requests.append(request)
        let url = try #require(request.url)
        let body = try #require(responses[url.path])
        let response = try #require(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil))
        return (Data(body.utf8), response)
    }
}

private struct TransferTokens: TokenStoring {
    func load() throws -> OAuthTokens? {
        OAuthTokens(accessToken: "test", refreshToken: nil, expiresAt: Date().addingTimeInterval(3600))
    }
    func save(_ tokens: OAuthTokens) throws {}
    func remove() throws {}
}
