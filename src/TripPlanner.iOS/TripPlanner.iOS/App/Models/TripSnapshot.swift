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
    struct Destination: Equatable {
        let name: String
        let arrival: String?
        let departure: String?
        var placeID: String? = nil
        var stayID: String? = nil
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

        enum CodingKeys: String, CodingKey {
            case id = "@id"
            case name
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

    private let places: [Place]
    private let itinerary: Itinerary
    private let planning: Planning
    let resources: [String: ResourceVersion]?

    var destinations: [Destination] {
        let names = Dictionary(places.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
        let visits = itinerary.itemListElement
        let visited = Set(visits.map { $0.item.id })
        let scheduled = visits.compactMap { visit in
            names[visit.item.id].map {
                Destination(
                    name: $0, arrival: visit.arrival, departure: visit.departure,
                    placeID: visit.id == nil ? nil : visit.item.id, stayID: visit.id
                )
            }
        }
        let unscheduled = planning.destinations.compactMap { settings -> Destination? in
            let id = settings.destination.id
            guard !visited.contains(id), let name = names[id] else { return nil }
            return Destination(name: name, arrival: nil, departure: nil)
        }
        return scheduled + unscheduled
    }
}
