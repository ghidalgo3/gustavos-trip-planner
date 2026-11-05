import Foundation
#if DEBUG
import OSLog
#endif

@MainActor
protocol TripHTTPTransport {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

struct URLSessionTripTransport: TripHTTPTransport {
    #if DEBUG
    private static let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "TripPlanner", category: "HTTP")
    #endif

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        #if DEBUG
        let id = UUID().uuidString.prefix(8)
        let method = request.httpMethod ?? "GET"
        let host = request.url?.host() ?? "<unknown>"
        let path = request.url?.path(percentEncoded: true) ?? "/"
        let started = ContinuousClock.now
        let requestBytes = request.httpBody?.count ?? 0
        Self.log.debug("[\(id, privacy: .public)] → \(method, privacy: .public) \(host, privacy: .public)\(path, privacy: .public) (\(requestBytes) request bytes)")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse).map { String($0.statusCode) } ?? "non-HTTP"
            let contentType = response.mimeType ?? "unknown content type"
            let elapsed = String(describing: started.duration(to: .now))
            Self.log.debug("[\(id, privacy: .public)] ← \(status, privacy: .public) \(method, privacy: .public) \(path, privacy: .public) (\(data.count) response bytes, \(contentType, privacy: .public), \(elapsed, privacy: .public))")
            return (data, response)
        } catch {
            let failure = error as NSError
            let elapsed = String(describing: started.duration(to: .now))
            Self.log.error("[\(id, privacy: .public)] × \(method, privacy: .public) \(path, privacy: .public) (\(failure.domain, privacy: .public) \(failure.code), \(elapsed, privacy: .public))")
            throw error
        }
        #else
        try await URLSession.shared.data(for: request)
        #endif
    }
}
