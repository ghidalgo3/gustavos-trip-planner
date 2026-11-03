import Foundation

struct DestinationCity: Codable, Equatable {
    let name: String
    let countryCode: String
    let longitude: Double
    let latitude: Double
}

struct DestinationPoint: Encodable {
    let type = "Point"
    let coordinates: [Double]

    init(city: DestinationCity) {
        coordinates = [city.longitude, city.latitude]
    }
}

/// The existing destination properties needed to preserve user-authored settings.
struct DestinationResource: Decodable {
    struct Properties: Decodable {
        let constraints: JSONValue?
    }
    let properties: Properties
}

struct DestinationUpdateRequest: Encodable {
    struct Properties: Encodable {
        let name: String
        let countryCode: String
        let timeZone: String? = nil
        let constraints: JSONValue
    }

    let type = "Feature"
    let id: String
    let geometry: DestinationPoint
    let properties: Properties

    init(id: String, city: DestinationCity, existing: DestinationResource) {
        self.id = id
        geometry = DestinationPoint(city: city)
        // Omitting timeZone asks the server to resolve it for the new city.
        properties = Properties(name: city.name, countryCode: city.countryCode,
                                constraints: existing.properties.constraints ?? .object([:]))
    }
}

struct DestinationCreateRequest: Encodable {
    struct Properties: Encodable {
        let name: String
        let countryCode: String
        let arrivalDate: String?
        let departureDate: String?
    }

    let type = "Feature"
    let geometry: DestinationPoint
    let properties: Properties

    init(city: DestinationCity, dates: DestinationStayRequest) {
        geometry = DestinationPoint(city: city)
        properties = Properties(name: city.name, countryCode: city.countryCode,
                                arrivalDate: dates.arrivalDate, departureDate: dates.departureDate)
    }
}

struct DestinationStayRequest: Codable, Equatable {
    let arrivalDate: String?
    let departureDate: String?
}
