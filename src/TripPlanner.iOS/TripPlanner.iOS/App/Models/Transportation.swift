import Foundation

struct TransportationReference: Codable, Equatable {
    enum Kind: String, Codable { case activity, airport, hotel, home }
    var kind: Kind
    var id: UUID
}

struct TransportationFeature: Codable, Equatable, Identifiable {
    struct Geometry: Codable, Equatable {
        enum Kind: String, Codable { case point = "Point", lineString = "LineString", multiLineString = "MultiLineString" }
        var type: Kind
        var coordinates: JSONValue
    }
    struct Properties: Codable, Equatable {
        var name: String?
        var address: String?
        var reference: TransportationReference?
        var sequence: Int?
        var mode: String?
        var line: String?
        var direction: String?
        var instructions: String?
        var duration: String?
    }
    var type = "Feature"
    var id: String
    var geometry: Geometry?
    var properties: Properties
}

struct TransportationWrite: Encodable, Equatable {
    var type = "FeatureCollection"
    var name: String
    var notes: String
    var features: [TransportationFeature]
    var mode: String?
    var departureDate: String?
    var departureTime: String?
    var timeZone: String?
    var duration: String?
    var routeReviewed = false
}

struct TransportationResource: Decodable, Equatable, Identifiable {
    let type: String
    let id: UUID
    let name: String
    let notes: String
    let features: [TransportationFeature]
    let mode: String?
    let departureDate: String?
    let departureTime: String?
    let timeZone: String?
    let duration: String?
    let version: Int
    let etag: String
    let routeStale: Bool

    var draft: TransportationWrite {
        TransportationWrite(name: name, notes: notes, features: features, mode: mode,
                            departureDate: departureDate, departureTime: departureTime,
                            timeZone: timeZone, duration: duration)
    }
}

struct HotelWrite: Encodable, Equatable {
    var name: String
    var geometry: TransportationFeature.Geometry
    var address: String?
    var timeZone: String?
}

struct HotelResource: Decodable, Equatable, Identifiable {
    let id: UUID
    let tripId: UUID
    let name: String
    let address: String?
    let geometry: TransportationFeature.Geometry
    let timeZone: String?
    let version: Int
    let etag: String
}

struct AirportResource: Decodable, Equatable, Identifiable {
    let id: UUID
    let code: String
    let name: String
    let city: String
    let country: String
    let longitude: Double
    let latitude: Double
    let timeZone: String
    let active: Bool
}

@MainActor
protocol TransportationServing {
    func airports(query: String) async throws -> [AirportResource]
    func transportation(tripID: UUID) async throws -> [TransportationResource]
    func transportation(tripID: UUID, id: UUID) async throws -> TransportationResource
    func createTransportation(tripID: UUID, request: TransportationWrite) async throws -> TransportationResource
    func replaceTransportation(tripID: UUID, value: TransportationResource, request: TransportationWrite) async throws -> TransportationResource
    func deleteTransportation(tripID: UUID, value: TransportationResource) async throws
    func hotels(tripID: UUID) async throws -> [HotelResource]
    func hotel(tripID: UUID, id: UUID) async throws -> HotelResource
    func createHotel(tripID: UUID, request: HotelWrite) async throws -> HotelResource
    func replaceHotel(tripID: UUID, value: HotelResource, request: HotelWrite) async throws -> HotelResource
    func deleteHotel(tripID: UUID, value: HotelResource) async throws
}

extension TransportationServing {
    func airports(query: String) async throws -> [AirportResource] { throw APIError.invalidResponse }
    func transportation(tripID: UUID) async throws -> [TransportationResource] { throw APIError.invalidResponse }
    func transportation(tripID: UUID, id: UUID) async throws -> TransportationResource { throw APIError.invalidResponse }
    func createTransportation(tripID: UUID, request: TransportationWrite) async throws -> TransportationResource { throw APIError.invalidResponse }
    func replaceTransportation(tripID: UUID, value: TransportationResource, request: TransportationWrite) async throws -> TransportationResource { throw APIError.invalidResponse }
    func deleteTransportation(tripID: UUID, value: TransportationResource) async throws { throw APIError.invalidResponse }
    func hotels(tripID: UUID) async throws -> [HotelResource] { throw APIError.invalidResponse }
    func hotel(tripID: UUID, id: UUID) async throws -> HotelResource { throw APIError.invalidResponse }
    func createHotel(tripID: UUID, request: HotelWrite) async throws -> HotelResource { throw APIError.invalidResponse }
    func replaceHotel(tripID: UUID, value: HotelResource, request: HotelWrite) async throws -> HotelResource { throw APIError.invalidResponse }
    func deleteHotel(tripID: UUID, value: HotelResource) async throws { throw APIError.invalidResponse }
}
