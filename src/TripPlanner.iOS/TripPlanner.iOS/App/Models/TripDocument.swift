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
            "itinerary": .object(["items": .array([])]),
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
    let activities: [TripDocumentActivity]
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
              case .array = document["itinerary"]["items"] else {
            throw APIError.invalidResponse
        }
        let places = document["places"].arrayValue
        let items = document["itinerary"]["items"].arrayValue
        activities = try items.filter { $0["kind"] == .string("activity") }.map { item in
            try TripDocumentActivity(item)
        }
        let visits = items.filter { $0["kind"] == .string("visit") }
            .enumerated().sorted { ($0.element["order"].numberValue ?? Double($0.offset)) < ($1.element["order"].numberValue ?? Double($1.offset)) }.map(\.element)
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
            return DestinationVisit(name: name, arrival: visit["start"].stringValue,
                                    departure: visit["end"].stringValue,
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
        selectedFlights = items
            .filter { $0["kind"] == .string("flight") }
            .sorted { ($0["start"].stringValue ?? "", $0["id"].stringValue ?? "")
                < ($1["start"].stringValue ?? "", $1["id"].stringValue ?? "") }
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
                    let lodging = items.first { $0["kind"] == .string("lodging") && $0["visitId"] == visit["id"] }
                    let hotel = lodging.flatMap { place($0["placeId"].stringValue) }
                    let value: [String: JSONValue] = [
                        "id": visit["id"], "order": visit["order"],
                        "arrivalDate": visit["start"], "departureDate": visit["end"],
                        "arrivalAt": visit["start"].stringValue.map(JSONValue.string) ?? .string(""),
                        "departureAt": visit["end"].stringValue.map(JSONValue.string) ?? .string(""),
                        "stayLocation": hotel.map { p in
                            .object(["type": .string("Feature"), "id": visit["id"], "geometry": p["location"], "properties": .object(["name": p["name"]])])
                        } ?? .null
                    ]
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


/// Activity facts remain independent of their itinerary dates and times.
struct TripDocumentActivity: Equatable {
    enum Kind: String, CaseIterable { case Food, Shopping, Culture, Music, Art, Nature, Relax, Event, Holiday }
    enum TicketRequirement: String { case Unknown, Required, NotRequired }
    let id: String
    let name: String
    let destinationID: String
    let kinds: [Kind]
    let address: String?
    let ticketRequirement: TicketRequirement
    let description: String
    let links: JSONValue

    init(_ value: JSONValue) throws {
        let rawValues = value["kinds"].arrayValue
        let rawKinds = rawValues.compactMap { $0.stringValue }
        let kinds = rawKinds.compactMap(Kind.init(rawValue:))
        guard let id = value["id"].stringValue,
              let name = value["name"].stringValue,
              let destinationID = value["destinationId"].stringValue,
              !kinds.isEmpty, kinds.count == rawValues.count,
              Set(rawKinds).count == kinds.count,
              let ticket = value["ticketRequirement"].stringValue.flatMap(TicketRequirement.init(rawValue:)) else {
            throw APIError.invalidResponse
        }
        self.id = id
        self.name = name
        self.destinationID = destinationID
        self.kinds = kinds
        address = value["address"].stringValue
        ticketRequirement = ticket
        description = value["description"].stringValue ?? ""
        links = value["links"]
    }
}
