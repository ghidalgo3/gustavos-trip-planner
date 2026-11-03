import Foundation
import Testing
@testable import TripPlannerCore

struct DestinationRequestTests {
    @Test func changingCityPreservesIdentityAndPlanningConstraints() throws {
        let current: JSONValue = .object([
            "id": .string("tokyo"),
            "properties": .object([
                "name": .string("Tokyo"), "countryCode": .string("JP"),
                "timeZone": .string("Asia/Tokyo"),
                "constraints": .object(["interests": .array([.string("art")])]),
                "stays": .array([])
            ])
        ])
        let city = DestinationCity(name: "Paris", countryCode: "FR", longitude: 2.35, latitude: 48.85)
        let existing = try JSONDecoder().decode(DestinationResource.self, from: JSONEncoder().encode(current))
        let request = DestinationUpdateRequest(id: "tokyo", city: city, existing: existing)
        let encoded = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(request))
        let geometry: JSONValue = .object([
            "type": .string("Point"), "coordinates": .array([.number(2.35), .number(48.85)])
        ])
        #expect(encoded == .object([
            "type": .string("Feature"), "id": .string("tokyo"), "geometry": geometry,
            "properties": .object([
                "name": .string("Paris"), "countryCode": .string("FR"),
                "constraints": .object(["interests": .array([.string("art")])])
            ])
        ]))
    }

    @Test func createAndStayRequestsEncodeDatesWithoutCityUpdateFields() throws {
        let dates = DestinationStayRequest(arrivalDate: "2027-04-09", departureDate: "2027-04-12")
        let city = DestinationCity(name: "Tokyo", countryCode: "JP", longitude: 139.7, latitude: 35.7)
        let create = DestinationCreateRequest(city: city, dates: dates)
        let encoded = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(create))
        #expect(encoded == .object([
            "type": .string("Feature"),
            "geometry": .object(["type": .string("Point"), "coordinates": .array([.number(139.7), .number(35.7)])]),
            "properties": .object([
                "name": .string("Tokyo"), "countryCode": .string("JP"),
                "arrivalDate": .string("2027-04-09"), "departureDate": .string("2027-04-12")
            ])
        ]))
        let stay = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(dates))
        #expect(stay == .object(["arrivalDate": .string("2027-04-09"), "departureDate": .string("2027-04-12")]))
    }
}
