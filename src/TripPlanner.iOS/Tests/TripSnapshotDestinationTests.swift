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
            {"@id":"tokyo","name":"Tokyo","geo":{"@type":"GeoCoordinates","latitude":35.681,"longitude":139.767}},
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
                placeID: "tokyo", stayID: "urn:uuid:9a4047f9-dfb2-4aba-86c6-2ff3d5e9e607",
                coordinate: RouteCoordinate(latitude: 35.681, longitude: 139.767)
            ),
            .init(name: "Kyoto", arrival: "2027-04-12", departure: nil),
            .init(
                name: "Tokyo", arrival: "2027-04-16", departure: "2027-04-19",
                coordinate: RouteCoordinate(latitude: 35.681, longitude: 139.767)
            ),
            .init(name: "Osaka", arrival: nil, departure: nil, placeID: "osaka")
        ])
    }

    @Test func readsSavedFlightSegmentsAndPlacesThemByStayReferences() throws {
        let tokyo = UUID()
        let osaka = UUID()
        let json = """
        {
          "places": [
            {"@id":"jfk","name":"Kennedy","iataCode":"JFK"},
            {"@id":"hnd","name":"Haneda","iataCode":"HND"}
          ],
          "itinerary":{"itemListElement":[]},
          "planning":{"destinations":[]},
          "services":[
            {"@id":"segment","flightNumber":"JL5","departureAirport":{"@id":"jfk"},"arrivalAirport":{"@id":"hnd"},
             "tp:departureLocalTime":"2027-12-08T12:00:00","tp:arrivalLocalTime":"2027-12-09T16:00:00"}
          ],
          "flights":[
            {"@id":"arrival","flight":{"@id":"segment"},"destinationVisit":{"@id":"urn:uuid:\(tokyo)"},
             "reservation":{"@id":"reservation"}},
            {"@id":"transfer","flight":{"@id":"segment"},"originVisit":{"@id":"urn:uuid:\(tokyo)"},
             "destinationVisit":{"@id":"urn:uuid:\(osaka)"}},
            {"@id":"return","flight":{"@id":"segment"},"originVisit":{"@id":"urn:uuid:\(osaka)"}},
            {"@id":"unassigned","flight":{"@id":"segment"},"unassigned":true,
             "destinationVisit":{"@id":"urn:uuid:\(tokyo)"}}
          ]
        }
        """
        let snapshot = try JSONDecoder().decode(TripSnapshotDestinations.self, from: Data(json.utf8))
        let destinations = [
            Destination(title: "Tokyo", subtitle: "", stayID: tokyo),
            Destination(title: "Osaka", subtitle: "", stayID: osaka),
            Destination(title: "Unscheduled", subtitle: "")
        ]
        let placements = Dictionary(uniqueKeysWithValues: snapshot.selectedFlights.map {
            ($0.id, $0.placement(in: destinations))
        })
        #expect(placements == ["arrival": .inbound, "transfer": .transfer(after: 0),
                               "return": .outbound, "unassigned": .other])
        let arrival = try #require(snapshot.selectedFlights.first { $0.id == "arrival" })
        #expect(arrival.purchased)
        #expect(arrival.flightNumber == "JL5")
        #expect(arrival.departureAirport == "JFK")
        #expect(arrival.arrivalAirport == "HND")
        #expect(arrival.arrivalTime == "2027-12-09T16:00:00")
    }
}
