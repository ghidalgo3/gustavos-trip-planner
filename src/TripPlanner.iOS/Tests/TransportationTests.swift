import Foundation
import Testing
@testable import TripPlannerCore

@MainActor
struct TransportationTests {
    @Test func directionsAndLinkedEndpointsSurviveEditingWithoutGeometry() throws {
        let value = """
        {"type":"FeatureCollection","id":"11111111-1111-4111-8111-111111111111","name":"Train to hotel",
         "notes":"Take the express, then Metro A.","mode":"transit","duration":"PT1H",
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
        #expect(encoded["etag"] == nil)
        #expect(encoded["version"] == nil)
    }
}
