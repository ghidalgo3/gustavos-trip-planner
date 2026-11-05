import Foundation

struct TransferFlight: Decodable {
    struct Segment: Decodable, Hashable {
        let departureAirport: String
        let arrivalAirport: String
        let departureTimeLocal: String?
        let arrivalTimeLocal: String?
        let marketingCarrierCode: String?
        let flightNumber: String?

        private enum CodingKeys: String, CodingKey {
            case departureAirport = "departure_airport"
            case arrivalAirport = "arrival_airport"
            case departureTimeLocal = "departure_time_local"
            case arrivalTimeLocal = "arrival_time_local"
            case marketingCarrierCode = "marketing_carrier_code"
            case flightNumber = "flight_number"
        }
    }

    struct Leg: Decodable {
        let segments: [Segment]
    }

    let legIndex: Int
    let leg: Leg
}

struct TransferFlightPlanning: Decodable, Equatable {
    struct Visit: Decodable, Equatable {
        struct Location: Decodable, Equatable {
            let code: String
            let codes: [String]?
        }

        let id: UUID
        let location: Location?
        let presentFrom: String?
        let presentThrough: String?
    }

    let visits: [Visit]

    func legIndex(from origin: UUID?, to destination: UUID?) -> Int? {
        if origin == nil, let destination, visits.first?.id == destination { return 0 }
        if destination == nil, let origin, visits.last?.id == origin { return visits.count }
        guard let origin, let destination else { return nil }
        guard let index = visits.firstIndex(where: { $0.id == destination }),
              index > 0, visits[index - 1].id == origin else { return nil }
        return index
    }
}

struct SavedTripFlight: Identifiable, Equatable {
    let id: String
    let flightNumber: String
    let departureAirport: String
    let arrivalAirport: String
    let departureTime: String
    let arrivalTime: String
    let originStay: UUID?
    let destinationStay: UUID?
    let unassigned: Bool
    let purchased: Bool

    enum Placement: Hashable {
        case inbound
        case transfer(after: Int)
        case outbound
        case other
    }

    func placement(in destinations: [Destination]) -> Placement {
        guard !unassigned else { return .other }
        if let originStay, let destinationStay,
           let index = destinations.firstIndex(where: { $0.stayID == originStay }),
           index + 1 < destinations.count, destinations[index + 1].stayID == destinationStay {
            return .transfer(after: index)
        }
        if originStay == nil, let destinationStay, destinations.first(where: { $0.stayID != nil })?.stayID == destinationStay { return .inbound }
        if destinationStay == nil, let originStay, destinations.last(where: { $0.stayID != nil })?.stayID == originStay { return .outbound }
        return .other
    }
}
