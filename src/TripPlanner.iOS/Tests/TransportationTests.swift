import Foundation
import Testing
@testable import TripPlannerCore

@MainActor
struct TransportationTests {
    @Test func directionsAndLinkedEndpointsSurviveEditingWithoutGeometry() throws {
        let value = """
        {"type":"FeatureCollection","id":"11111111-1111-4111-8111-111111111111","name":"Train to hotel",
         "notes":"Take the express, then Metro A.","mode":"train","duration":"PT1H",
         "originStayId":"33333333-3333-4333-8333-333333333333",
         "destinationStayId":"44444444-4444-4444-8444-444444444444",
         "departureAt":"2030-04-01T09:00:00+02:00","arrivalAt":"2030-04-01T10:00:00+02:00",
         "version":4,"etag":"transportation-example-4","routeStale":false,
         "features":[
          {"type":"Feature","id":"from","geometry":null,"properties":{"reference":{"kind":"airport","id":"22222222-2222-4222-8222-222222222222"}}},
          {"type":"Feature","id":"to","geometry":{"type":"Point","coordinates":[139,35]},"properties":{"name":"Hotel","address":"Hotel address"}},
          {"type":"Feature","id":"train","geometry":null,"properties":{"sequence":0,"mode":"train","line":"Express","instructions":"Platform 2"}}
         ]}
        """
        let resource = try JSONDecoder().decode(TransportationResource.self, from: Data(value.utf8))
        #expect(resource.features[0].properties.reference?.kind == .airport)
        #expect(resource.features[2].geometry == nil)
        var draft = resource.draft
        draft.notes = "Use exit 3."
        let encoded = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(draft)) as? [String: Any])
        #expect(encoded["type"] as? String == "FeatureCollection")
        #expect(encoded["notes"] as? String == "Use exit 3.")
        let features = try #require(encoded["features"] as? [[String: Any]])
        let properties = try #require(features[2]["properties"] as? [String: Any])
        #expect(properties["line"] as? String == "Express")
        #expect(encoded["originStayId"] as? String == resource.originStayId?.uuidString)
        #expect(encoded["destinationStayId"] as? String == resource.destinationStayId?.uuidString)
        #expect(encoded["departureAt"] as? String == "2030-04-01T09:00:00+02:00")
        #expect(encoded["arrivalAt"] as? String == "2030-04-01T10:00:00+02:00")
        #expect(resource.displayDuration == "1 hr")
        #expect(encoded["etag"] == nil)
        #expect(encoded["version"] == nil)
    }
    @Test(arguments: [("PT1H", "1 hr"), ("P2DT3H", "51 hr")])
    func multiDayTransportDurationsRemainReadable(_ duration: String, _ expected: String) {
        let value = TransportationResource(type: "FeatureCollection", id: UUID(), name: "Drive", notes: "", features: [], mode: "car", departureDate: nil, departureTime: nil, timeZone: nil, duration: duration, version: 1, etag: "one", routeStale: false)
        #expect(value.displayDuration == expected)
    }

}
