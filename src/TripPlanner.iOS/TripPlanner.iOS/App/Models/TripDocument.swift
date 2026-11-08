import Foundation

extension PendingTripWrite {
    /// A portable v1 trip document. Values come from the journal so retries are identical.
    var document: JSONValue {
        let tripID = base.id.uuidString.lowercased()
        let personID = accountID.uuidString.lowercased()
        let homeID = "urn:tripplanner:\(tripID):place:home"
        return .object([
            "schemaVersion": .number(1), "id": .string(tripID),
            "name": .string(draft.name), "description": .string(draft.description),
            "revision": .string("local:" + id.uuidString.lowercased()),
            "createdAt": .string(base.createdAt.ISO8601Format()),
            "updatedAt": .string(base.updatedAt.ISO8601Format()),
            "originPlaceId": .string(homeID),
            "people": .array([.object([
                "id": .string(personID), "name": .string("Me"),
                "role": .string("Planner"), "isOwner": .bool(true), "homeCityName": .null
            ])]),
            "places": .array([.object([
                "id": .string(homeID), "type": .string("Place"), "name": .string("Home"), "location": .null
            ])]),
            "activities": .array([]),
            "transportation": .object(["legs": .array([]), "journeys": .array([]), "bookings": .array([])]),
            "itinerary": .object(["visits": .array([]), "days": .array([]), "schedule": .array([])]),
            "preferences": .object([
                "constraints": draft.constraints,
                "activities": .object(["instructions": .string(""), "defaults": .null]),
                "destinations": .array([]), "groups": .array([]), "flightChoices": .array([])
            ])
        ])
    }
}

/// Native views use document entities; REST bodies are reconstructed at the editing boundary.
struct TripDocumentDestinations: Decodable {
    struct DestinationVisit: Equatable {
        let name: String
        let arrival: String?
        let departure: String?
        var placeID: String? = nil
        var stayID: String? = nil
        var coordinate: RouteCoordinate? = nil
    }
    let destinations: [DestinationVisit]
    let selectedFlights: [SavedTripFlight]
    let home: Destination?
    let resources: [String: ResourceVersion]?

    static func stayID(_ value: String?) -> UUID? {
        guard let value else { return nil }
        return UUID(uuidString: value.hasPrefix("urn:uuid:") ? String(value.dropFirst(9)) : value)
    }

    init(from decoder: any Decoder) throws {
        let document = try JSONValue(from: decoder)
        guard let tripID = document["id"].stringValue else { throw APIError.invalidResponse }
        guard document["schemaVersion"] == .number(1), UUID(uuidString: tripID) != nil,
              case .object = document["itinerary"], case .object = document["transportation"] else {
            throw APIError.invalidResponse
        }
        let places = document["places"].arrayValue
        let visits = document["itinerary"]["visits"].arrayValue
        let preferences = document["preferences"]["destinations"].arrayValue
        func place(_ id: String?) -> JSONValue? {
            places.first { $0["id"].stringValue == id && id != nil }
        }
        func coordinate(_ p: JSONValue) -> RouteCoordinate? {
            let coordinates = p["location"]["coordinates"].arrayValue
            guard coordinates.count == 2, let longitude = coordinates[0].numberValue,
                  let latitude = coordinates[1].numberValue else { return nil }
            return RouteCoordinate(latitude: latitude, longitude: longitude)
        }
        func cityPlace(_ city: JSONValue) -> JSONValue? {
            places.first { $0["destinationId"] == city }
        }
        let visited = Set(visits.compactMap { $0["destinationId"].stringValue })
        destinations = visits.compactMap { visit in
            guard let p = cityPlace(visit["destinationId"]), let name = p["name"].stringValue else { return nil }
            return DestinationVisit(name: name, arrival: visit["arrivalDate"].stringValue,
                                    departure: visit["departureDate"].stringValue,
                                    placeID: p["id"].stringValue,
                                    stayID: visit["id"].stringValue.map { "urn:uuid:" + $0 }, coordinate: coordinate(p))
        } + preferences.compactMap { preference in
            guard let city = preference["destinationId"].stringValue, !visited.contains(city),
                  let p = cityPlace(preference["destinationId"]), let name = p["name"].stringValue else { return nil }
            return DestinationVisit(name: name, arrival: nil, departure: nil,
                                    placeID: p["id"].stringValue, coordinate: coordinate(p))
        }
        home = place(document["originPlaceId"].stringValue).flatMap { p in
            p["name"].stringValue.map { Destination(title: $0, subtitle: "", coordinate: coordinate(p)) }
        }
        selectedFlights = document["transportation"]["legs"].arrayValue
            .filter { $0["kind"] == .string("flight") }
            .sorted { ($0["departureTime"].stringValue ?? "", $0["id"].stringValue ?? "")
                < ($1["departureTime"].stringValue ?? "", $1["id"].stringValue ?? "") }
            .compactMap { leg in
                guard let id = leg["id"].stringValue,
                      let from = place(leg["departurePlaceId"].stringValue),
                      let to = place(leg["arrivalPlaceId"].stringValue) else { return nil }
                return SavedTripFlight(id: id, flightNumber: leg["flightNumber"].stringValue ?? "",
                                       departureAirport: from["iataCode"].stringValue ?? from["name"].stringValue ?? "",
                                       arrivalAirport: to["iataCode"].stringValue ?? to["name"].stringValue ?? "",
                                       departureTime: leg["departureLocalTime"].stringValue ?? "",
                                       arrivalTime: leg["arrivalLocalTime"].stringValue ?? "",
                                       originStay: Self.stayID(leg["originVisitId"].stringValue),
                                       destinationStay: Self.stayID(leg["destinationVisitId"].stringValue),
                                       unassigned: leg["unassigned"] == .bool(true), purchased: leg["purchased"] == .bool(true))
            }
        let hasEditingMetadata = document["etag"].stringValue != nil
        var result: [String: ResourceVersion] = [:]
        for preference in preferences {
            guard let city = preference["destinationId"].stringValue, let p = cityPlace(preference["destinationId"]) else { continue }
            let encoded = city.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#"))) ?? city
            let path = "/trips/\(tripID)/destinations/\(encoded)"
            let stays = visits.filter { $0["destinationId"] == .string(city) }
                .map { visit -> JSONValue in
                    var value = visit.objectValue.filter { $0.key != "destinationId" && $0.key != "accommodationPlaceId" && $0.key != "etag" && $0.key != "accommodationEtag" }
                    value["arrivalAt"] = visit["arrivalDate"].stringValue.map(JSONValue.string) ?? .string("")
                    value["departureAt"] = visit["departureDate"].stringValue.map(JSONValue.string) ?? .string("")
                    value["stayLocation"] = place(visit["accommodationPlaceId"].stringValue).map { p in
                        .object(["type": .string("Feature"), "id": visit["id"], "geometry": p["location"],
                                 "properties": .object(["name": p["name"]])])
                    } ?? .null
                    return .object(value)
                }
            if hasEditingMetadata, let etag = p["etag"].stringValue {
                result[path] = ResourceVersion(etag: "\"\(etag)\"", data: .object([
                    "type": .string("Feature"), "id": .string(city), "geometry": p["location"],
                    "properties": .object([
                        "name": p["name"], "countryCode": p["countryCode"], "timeZone": p["timeZone"],
                        "contextVersion": p["contextVersion"],
                        "arrivalDate": stays.count == 1 ? stays[0]["arrivalDate"] : .null,
                        "departureDate": stays.count == 1 ? stays[0]["departureDate"] : .null, "stays": .array(stays),
                        "isActive": p["active"], "constraints": preference["constraints"]
                    ])
                ]))
            }
            for stay in stays {
                guard let id = stay["id"].stringValue else { continue }
                let stayPath = path + "/stays/" + id
                if hasEditingMetadata, let source = visits.first(where: { $0["id"] == stay["id"] }),
                   let etag = source["etag"].stringValue {
                    result[stayPath] = ResourceVersion(etag: "\"\(etag)\"", data: stay)
                }
            }
        }
        resources = result.isEmpty ? nil : result
    }
}

private extension JSONValue {
    subscript(key: String) -> JSONValue { objectValue[key] ?? .null }
    var objectValue: [String: JSONValue] { if case .object(let value) = self { value } else { [:] } }
    var arrayValue: [JSONValue] { if case .array(let value) = self { value } else { [] } }
    var stringValue: String? { if case .string(let value) = self { value } else { nil } }
    var numberValue: Double? { if case .number(let value) = self { value } else { nil } }
}

