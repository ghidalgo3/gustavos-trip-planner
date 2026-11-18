import Foundation
import Testing
@testable import TripPlannerCore

@MainActor
struct TripDocumentTests {
    private func fixture(_ name: String) throws -> Data {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        return try Data(contentsOf: root.appendingPathComponent("docs/" + name + ".json"))
    }

    @Test func documentContainsVisitsFlightsAndEditingVersions() throws {
        let document = try JSONDecoder().decode(TripDocumentDestinations.self, from: fixture("after"))
        #expect(document.destinations.count == 5)
        #expect(document.selectedFlights.count == 5)
        #expect(document.selectedFlights.allSatisfy { !$0.flightNumber.isEmpty })
        #expect(document.resources?.isEmpty == false)
        #expect(document.resources?.values.allSatisfy { $0.etag.hasPrefix("\"") } == true)
        let file = try #require(JSONSerialization.jsonObject(with: fixture("after")) as? [String: Any])
        let places = try #require(file["places"] as? [[String: Any]])
        for place in places {
            guard let city = place["destinationId"] as? String,
                  let etag = place["etag"] as? String else { continue }
            let tripID = try #require(file["id"] as? String)
            #expect(document.resources?["/trips/\(tripID)/destinations/\(city)"]?.etag == "\"\(etag)\"")
        }
        for resource in document.resources?.values ?? Dictionary<String, ResourceVersion>().values {
            let body = String(decoding: try JSONEncoder().encode(resource.data), as: UTF8.self)
            #expect(!body.contains("\"etag\"") && !body.contains("\"accommodationEtag\""))
        }
    }

    @Test func portableDocumentDoesNotInventEditingVersions() throws {
        var value = try #require(JSONSerialization.jsonObject(with: fixture("after")) as? [String: Any])
        value.removeValue(forKey: "etag")
        let portable = try JSONDecoder().decode(TripDocumentDestinations.self, from: JSONSerialization.data(withJSONObject: value))
        #expect(portable.resources == nil)
        #expect(!portable.destinations.isEmpty)
        #expect(!portable.selectedFlights.isEmpty)
    }

    @Test func stayTimeOverridesSurviveDocumentHydration() throws {
        var value = try #require(JSONSerialization.jsonObject(with: fixture("after")) as? [String: Any])
        var itinerary = try #require(value["itinerary"] as? [String: Any])
        var items = try #require(itinerary["items"] as? [[String: Any]])
        let index = try #require(items.firstIndex { $0["kind"] as? String == "lodging" })
        items[index]["checkInTime"] = "18:30:00"
        items[index]["checkOutTime"] = "10:15:00"
        let visitID = try #require(items[index]["visitId"] as? String)
        let visit = try #require(items.first { $0["id"] as? String == visitID })
        let city = try #require(visit["destinationId"] as? String)
        itinerary["items"] = items
        value["itinerary"] = itinerary
        let document = try JSONDecoder().decode(TripDocumentDestinations.self, from: JSONSerialization.data(withJSONObject: value))
        let tripID = try #require(value["id"] as? String)
        let destination = try #require(document.resources?["/trips/\(tripID)/destinations/\(city)"]?.data)
        let body = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(destination)) as? [String: Any])
        let properties = try #require(body["properties"] as? [String: Any])
        let stays = try #require(properties["stays"] as? [[String: Any]])
        let stay = try #require(stays.first { $0["id"] as? String == visitID })
        let location = try #require(stay["stayLocation"] as? [String: Any])
        let clocks = try #require(location["properties"] as? [String: Any])
        #expect(clocks["checkInTime"] as? String == "18:30:00")
        #expect(clocks["checkOutTime"] as? String == "10:15:00")
    }

}

@MainActor
struct TripDocumentActivityTests {
    @Test(arguments: ["Yes", "No", "Maybe"], [[], ["Architecture & design", "夜景"]])
    func decodesOptionalKindsAndPlanningDecisions(_ state: String, _ kinds: [String]) throws {
        let value: JSONValue = .object([
            "id": .string(UUID().uuidString), "name": .string("Museum"),
            "destinationId": .string("paris-fr"), "kinds": .array(kinds.map(JSONValue.string)),
            "address": .string("1 museum street"), "ticketRequirement": .string("Unknown"),
            "state": .string(state),
            "description": .string("Paintings"), "notes": .string("Book morning entry.\nMeet at the entrance."), "links": .array([])
        ])
        let activity = try TripDocumentActivity(value)
        #expect(activity.kinds == kinds)
        #expect(activity.address == "1 museum street")
        #expect(activity.locationVerification == nil)
        #expect(activity.ticketRequirement == .Unknown)
        #expect(activity.state.rawValue == state)
        #expect(activity.description == "Paintings")
        #expect(activity.notes == "Book morning entry.\nMeet at the entrance.")
    }

    @Test
    func readsLocationVerificationFromThePortableDocument() throws {
        let source = "https://museum.example/visit"
        let value: JSONValue = .object([
            "id": .string(UUID().uuidString), "name": .string("Museum"),
            "destinationId": .string("paris-fr"), "kinds": .array([]),
            "address": .string("1 museum street"), "ticketRequirement": .string("Unknown"),
            "state": .string("Maybe"),
            "locationVerification": .object([
                "precision": .string("VerifiedEntrance"), "method": .string("Museum entrance map"),
                "uncertainty": .string("Door number unavailable"), "sourceUrls": .array([.string(source)])
            ])
        ])
        let activity = try TripDocumentActivity(value)
        let verification = try #require(activity.locationVerification)
        #expect(verification.precision == .VerifiedEntrance)
        #expect(verification.method == "Museum entrance map")
        #expect(verification.uncertainty == "Door number unavailable")
        #expect(verification.sourceURLs == [source])
    }

    @Test(arguments: [JSONValue.null, .string("Art"), .array([.null]), .array([.number(123)]), .array([.string("")]), .array([.string(" \t\n")]), .array([.string(String(repeating: "k", count: 201))]), .array([.string("Art"), .string("Art")])])
    func rejectsInvalidKinds(_ kinds: JSONValue) throws {
        let value: JSONValue = .object([
            "id": .string(UUID().uuidString), "name": .string("Museum"),
            "destinationId": .string("paris-fr"), "kinds": kinds,
            "ticketRequirement": .string("Unknown"), "state": .string("Maybe")
        ])
        #expect(throws: (any Error).self) { try TripDocumentActivity(value) }
    }
}
