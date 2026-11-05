import Foundation

extension PendingTripWrite {
    /// Uses the same v1 document shape as GET /trips/{id}/snapshot.
    /// All generated values come from the persisted journal so a retry is identical.
    var snapshotDocument: JSONValue {
        let tripID = base.id.uuidString.lowercased()
        let personID = "urn:uuid:\(accountID.uuidString.lowercased())"
        let homeID = "urn:tripplanner:\(tripID):place:home"
        func reference(_ id: String) -> JSONValue { .object(["@id": .string(id)]) }
        var context: [String: JSONValue] = [
            "@version": .number(1.1),
            "@vocab": .string("https://schema.org/"),
            "tp": .string("https://ghidalgo3.github.io/gustavos-trip-planner/vocab#")
        ]
        for name in ["plan", "planning", "resources"] {
            context[name] = .object(["@id": .string("tp:" + name), "@type": .string("@json")])
        }
        for name in [
            "schemaVersion", "revision", "places", "people", "travellers", "person", "role",
            "services", "flights", "flight", "reservation", "reservations", "destination",
            "originVisit", "destinationVisit", "unassigned", "timeZone"
        ] {
            context[name] = .string("tp:" + name)
        }
        return .object([
            "@context": .object(context),
            "@type": .string("Trip"),
            "@id": .string("urn:uuid:" + tripID),
            "schemaVersion": .number(1),
            "name": .string(draft.name),
            "description": .string(draft.description),
            "revision": .string("local:" + id.uuidString.lowercased()),
            "tripOrigin": reference(homeID),
            "owner": reference(personID),
            "itinerary": .object(["@type": .string("ItemList"), "itemListElement": .array([])]),
            "places": .array([.object([
                "@id": .string(homeID), "@type": .string("Place"), "name": .string("Home")
            ])]),
            "people": .array([.object([
                "@id": .string(personID), "@type": .string("Person"), "name": .string("Me")
            ])]),
            "travellers": .array([.object(["person": reference(personID), "role": .string("Planner")])]),
            "services": .array([]),
            "flights": .array([]),
            "reservations": .array([]),
            "plan": .object([
                "@type": .string("Group"),
                "uid": .string(id.uuidString.lowercased()),
                "updated": .string(base.updatedAt.ISO8601Format()),
                "title": .string(draft.name),
                "entries": .array([])
            ]),
            "planning": .object([
                "trip": .object(["constraints": draft.constraints]),
                "destinations": .array([]),
                "days": .array([]),
                "defaultsVersion": .number(1)
            ]),
            "resources": .object([:])
        ])
    }
}

/// Destination visits reference the places catalog by JSON-LD identifier.
struct TripSnapshotDestinations: Decodable {
    struct DestinationVisit: Equatable {
        let name: String
        let arrival: String?
        let departure: String?
        var placeID: String? = nil
        var stayID: String? = nil
        var coordinate: RouteCoordinate? = nil
    }

    private struct Reference: Decodable {
        let id: String

        enum CodingKeys: String, CodingKey {
            case id = "@id"
        }
    }

    private struct Place: Decodable {
        let id: String
        let name: String
        let geo: RouteCoordinate?
        let iataCode: String?

        enum CodingKeys: String, CodingKey {
            case id = "@id"
            case name, geo, iataCode
        }
    }

    private struct Itinerary: Decodable {
        struct Visit: Decodable {
            let id: String?
            let item: Reference
            let arrival: String?
            let departure: String?

            enum CodingKeys: String, CodingKey {
                case id = "@id"
                case item
                case arrival = "tp:arrivalDate"
                case departure = "tp:departureDate"
            }
        }

        let itemListElement: [Visit]
    }

    private struct Planning: Decodable {
        struct Settings: Decodable {
            let destination: Reference
        }

        let destinations: [Settings]
    }

    private struct FlightService: Decodable {
        let id: String
        let flightNumber: String?
        let departureAirport: Reference?
        let arrivalAirport: Reference?
        let departureTime: String?
        let departureLocalTime: String?
        let arrivalLocalTime: String?

        enum CodingKeys: String, CodingKey {
            case id = "@id"
            case flightNumber, departureAirport, arrivalAirport, departureTime
            case departureLocalTime = "tp:departureLocalTime"
            case arrivalLocalTime = "tp:arrivalLocalTime"
        }
    }

    private struct FlightSelection: Decodable {
        let id: String
        let flight: Reference
        let originVisit: Reference?
        let destinationVisit: Reference?
        let reservation: Reference?
        let unassigned: Bool?

        enum CodingKeys: String, CodingKey {
            case id = "@id"
            case flight, originVisit, destinationVisit, reservation, unassigned
        }
    }

    private let services: [FlightService]?
    private let flights: [FlightSelection]?

    var selectedFlights: [SavedTripFlight] {
        let airports = Dictionary(places.map { ($0.id, $0.iataCode ?? $0.name) },
                                  uniquingKeysWith: { first, _ in first })
        let byID = Dictionary((services ?? []).map { ($0.id, $0) },
                              uniquingKeysWith: { first, _ in first })
        var seen = Set<String>()
        return (flights ?? []).sorted {
            let lhs = byID[$0.flight.id]
            let rhs = byID[$1.flight.id]
            return (lhs?.departureTime ?? lhs?.departureLocalTime ?? "", $0.id)
                < (rhs?.departureTime ?? rhs?.departureLocalTime ?? "", $1.id)
        }.compactMap { selection -> SavedTripFlight? in
            guard let service = byID[selection.flight.id],
                  let from = service.departureAirport.flatMap({ airports[$0.id] }),
                  let to = service.arrivalAirport.flatMap({ airports[$0.id] }),
                  seen.insert(selection.id).inserted else { return nil }
            return SavedTripFlight(
                id: selection.id, flightNumber: service.flightNumber ?? "",
                departureAirport: from, arrivalAirport: to,
                departureTime: service.departureLocalTime ?? "", arrivalTime: service.arrivalLocalTime ?? "",
                originStay: Self.stayID(selection.originVisit?.id),
                destinationStay: Self.stayID(selection.destinationVisit?.id),
                unassigned: selection.unassigned ?? false, purchased: selection.reservation != nil
            )
        }
    }

    static func stayID(_ value: String?) -> UUID? {
        guard let value, value.hasPrefix("urn:uuid:") else { return nil }
        return UUID(uuidString: String(value.dropFirst(9)))
    }

    private let tripOrigin: Reference?
    private let places: [Place]

    var home: Destination? {
        guard let origin = tripOrigin, let place = places.first(where: { $0.id == origin.id }) else { return nil }
        return Destination(title: place.name, subtitle: "", coordinate: place.geo)
    }
    private let itinerary: Itinerary
    private let planning: Planning
    let resources: [String: ResourceVersion]?

    var destinations: [DestinationVisit] {
        let placesByID = Dictionary(places.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let visits = itinerary.itemListElement
        let visited = Set(visits.map { $0.item.id })
        let scheduled = visits.compactMap { visit in
            placesByID[visit.item.id].map {
                DestinationVisit(
                    name: $0.name, arrival: visit.arrival, departure: visit.departure,
                    placeID: visit.id == nil ? nil : visit.item.id, stayID: visit.id, coordinate: $0.geo
                )
            }
        }
        let unscheduled = planning.destinations.compactMap { settings -> DestinationVisit? in
            let id = settings.destination.id
            guard !visited.contains(id), let place = placesByID[id] else { return nil }
            return DestinationVisit(name: place.name, arrival: nil, departure: nil, placeID: id, coordinate: place.geo)
        }
        return scheduled + unscheduled
    }
}
