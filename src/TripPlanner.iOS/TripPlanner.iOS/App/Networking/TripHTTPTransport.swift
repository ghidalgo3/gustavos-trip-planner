import Foundation

@MainActor
protocol TripHTTPTransport {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

struct URLSessionTripTransport: TripHTTPTransport {
    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        try await URLSession.shared.data(for: request)
    }
}
