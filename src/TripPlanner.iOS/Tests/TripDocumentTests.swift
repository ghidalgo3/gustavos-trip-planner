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

}

@MainActor
struct TripDocumentActivityTests {
    @Test(arguments: ["Yes", "No", "Maybe"])
    func decodesMultipleKindsAndPlanningDecisions(_ state: String) throws {
        let value: JSONValue = .object([
            "id": .string(UUID().uuidString), "name": .string("Museum"),
            "destinationId": .string("paris-fr"), "kinds": .array([.string("Architecture & design"), .string("夜景")]),
            "address": .string("1 museum street"), "ticketRequirement": .string("Unknown"),
            "state": .string(state),
            "description": .string("Paintings"), "notes": .string("Book morning entry.\nMeet at the entrance."), "links": .array([])
        ])
        let activity = try TripDocumentActivity(value)
        #expect(activity.kinds == ["Architecture & design", "夜景"])
        #expect(activity.address == "1 museum street")
        #expect(activity.ticketRequirement == .Unknown)
        #expect(activity.state.rawValue == state)
        #expect(activity.description == "Paintings")
        #expect(activity.notes == "Book morning entry.\nMeet at the entrance.")
    }

    @Test(arguments: [[], [""], [" \t\n"], [String(repeating: "k", count: 201)], ["Art", "Art"]])
    func rejectsEmptyBlankLongAndDuplicateKinds(_ kinds: [String]) throws {
        let value: JSONValue = .object([
            "id": .string(UUID().uuidString), "name": .string("Museum"),
            "destinationId": .string("paris-fr"), "kinds": .array(kinds.map(JSONValue.string)),
            "ticketRequirement": .string("Unknown"), "state": .string("Maybe")
        ])
        #expect(throws: (any Error).self) { try TripDocumentActivity(value) }
    }
}
