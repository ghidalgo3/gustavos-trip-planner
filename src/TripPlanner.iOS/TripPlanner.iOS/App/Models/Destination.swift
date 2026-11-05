import Foundation

struct RouteCoordinate: Codable, Equatable, Hashable {
    let latitude: Double
    let longitude: Double
}

struct Destination: Codable, Equatable, Identifiable {
    let title: String
    let subtitle: String

    var coordinate: RouteCoordinate? = nil
    var arrival: String? = nil
    var departure: String? = nil
    var cityID: String? = nil
    var stayID: UUID? = nil

    var cityVersion: ResourceVersion? = nil
    var stayVersion: ResourceVersion? = nil

    var id: String { [cityID ?? "", stayID?.uuidString ?? "", title, subtitle].joined(separator: "|") }

    static var dateFormat: Date.ISO8601FormatStyle {
        Date.ISO8601FormatStyle(timeZone: .current).year().month().day()
    }
}

