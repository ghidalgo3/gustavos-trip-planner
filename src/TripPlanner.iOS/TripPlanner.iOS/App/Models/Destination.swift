import Foundation

struct Destination: Codable, Equatable, Identifiable {
    let title: String
    let subtitle: String

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

