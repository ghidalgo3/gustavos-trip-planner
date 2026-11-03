import Foundation
import Testing
@testable import TripPlannerCore

@MainActor
struct TripSnapshotDestinationTests {
    @Test func readsOrderedVisitsAndCitiesWithoutVisitsFromServerSnapshot() throws {
        let json = """
        {
          "places": [
            {"@id":"home","name":"Home"},
            {"@id":"kyoto","name":"Kyoto"},
            {"@id":"tokyo","name":"Tokyo"},
            {"@id":"osaka","name":"Osaka"}
          ],
          "itinerary": {"itemListElement":[
            {"@id":"urn:uuid:9a4047f9-dfb2-4aba-86c6-2ff3d5e9e607","item":{"@id":"tokyo"},"tp:arrivalDate":"2027-04-09","tp:departureDate":"2027-04-12"},
            {"item":{"@id":"kyoto"},"tp:arrivalDate":"2027-04-12","tp:departureDate":null},
            {"item":{"@id":"tokyo"},"tp:arrivalDate":"2027-04-16","tp:departureDate":"2027-04-19"}
          ]},
          "planning": {"destinations":[
            {"destination":{"@id":"kyoto"}},
            {"destination":{"@id":"osaka"}},
            {"destination":{"@id":"tokyo"}}
          ]}
        }
        """
        let snapshot = try JSONDecoder().decode(TripSnapshotDestinations.self, from: Data(json.utf8))
        #expect(snapshot.destinations == [
            .init(
                name: "Tokyo", arrival: "2027-04-09", departure: "2027-04-12",
                placeID: "tokyo", stayID: "urn:uuid:9a4047f9-dfb2-4aba-86c6-2ff3d5e9e607"
            ),
            .init(name: "Kyoto", arrival: "2027-04-12", departure: nil),
            .init(name: "Tokyo", arrival: "2027-04-16", departure: "2027-04-19"),
            .init(name: "Osaka", arrival: nil, departure: nil)
        ])
    }
}
