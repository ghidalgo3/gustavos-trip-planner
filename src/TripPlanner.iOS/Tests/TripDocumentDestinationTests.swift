import Foundation
import Testing
@testable import TripPlannerCore

@MainActor
struct TripDocumentDestinationTests {
    @Test func readsOrderedVisitsAndCitiesWithoutVisitsFromServerDocument() throws {
        let json = """
        {"id":"11111111-1111-1111-1111-111111111111","schemaVersion":1,
         "places":[{"id":"home","name":"Home"},{"id":"kyoto","destinationId":"kyoto","name":"Kyoto"},
           {"id":"tokyo","destinationId":"tokyo","name":"Tokyo","location":{"type":"Point","coordinates":[139.767,35.681]}},
           {"id":"osaka","destinationId":"osaka","name":"Osaka"}],
         "itinerary":{"items":[
           {"id":"9a4047f9-dfb2-4aba-86c6-2ff3d5e9e607","kind":"visit","destinationId":"tokyo","start":"2027-04-09","end":"2027-04-12"},
           {"id":"22222222-2222-2222-2222-222222222222","kind":"visit","destinationId":"kyoto","start":"2027-04-12"},
           {"id":"33333333-3333-3333-3333-333333333333","kind":"visit","destinationId":"tokyo","start":"2027-04-16","end":"2027-04-19"}]},
         "preferences":{"destinations":[{"destinationId":"kyoto"},{"destinationId":"osaka"},{"destinationId":"tokyo"}]}}
        """
        let document = try JSONDecoder().decode(TripDocumentDestinations.self, from: Data(json.utf8))
        #expect(document.destinations == [
            .init(
                name: "Tokyo", arrival: "2027-04-09", departure: "2027-04-12",
                placeID: "tokyo", stayID: "urn:uuid:9a4047f9-dfb2-4aba-86c6-2ff3d5e9e607",
                coordinate: RouteCoordinate(latitude: 35.681, longitude: 139.767)
            ),
            .init(name: "Kyoto", arrival: "2027-04-12", departure: nil, placeID: "kyoto", stayID: "urn:uuid:22222222-2222-2222-2222-222222222222"),
            .init(
                name: "Tokyo", arrival: "2027-04-16", departure: "2027-04-19", placeID: "tokyo", stayID: "urn:uuid:33333333-3333-3333-3333-333333333333",
                coordinate: RouteCoordinate(latitude: 35.681, longitude: 139.767)
            ),
            .init(name: "Osaka", arrival: nil, departure: nil, placeID: "osaka")
        ])
    }

    @Test func readsSavedFlightSegmentsAndPlacesThemByStayReferences() throws {
        let tokyo = UUID()
        let osaka = UUID()
        let json = """
        {"id":"11111111-1111-1111-1111-111111111111","schemaVersion":1,
         "places":[{"id":"jfk","name":"Kennedy","iataCode":"JFK"},{"id":"hnd","name":"Haneda","iataCode":"HND"}],
         "preferences":{"destinations":[]},
         "itinerary":{"items":[
          {"kind":"flight","id":"arrival","flightNumber":"JL5","departurePlaceId":"jfk","arrivalPlaceId":"hnd","departureLocalTime":"2027-12-08T12:00:00","arrivalLocalTime":"2027-12-09T16:00:00","destinationVisitId":"\(tokyo)","purchased":true},
          {"kind":"flight","id":"transfer","departurePlaceId":"jfk","arrivalPlaceId":"hnd","originVisitId":"\(tokyo)","destinationVisitId":"\(osaka)"},
          {"kind":"flight","id":"return","departurePlaceId":"jfk","arrivalPlaceId":"hnd","originVisitId":"\(osaka)"},
          {"kind":"flight","id":"unassigned","departurePlaceId":"jfk","arrivalPlaceId":"hnd","destinationVisitId":"\(tokyo)","unassigned":true}]}}
        """
        let document = try JSONDecoder().decode(TripDocumentDestinations.self, from: Data(json.utf8))
        let destinations = [
            Destination(title: "Tokyo", subtitle: "", stayID: tokyo),
            Destination(title: "Osaka", subtitle: "", stayID: osaka),
            Destination(title: "Unscheduled", subtitle: "")
        ]
        let placements = Dictionary(uniqueKeysWithValues: document.selectedFlights.map {
            ($0.id, $0.placement(in: destinations))
        })
        #expect(placements == ["arrival": .inbound, "transfer": .transfer(after: 0),
                               "return": .outbound, "unassigned": .other])
        let arrival = try #require(document.selectedFlights.first { $0.id == "arrival" })
        #expect(arrival.purchased)
        #expect(arrival.flightNumber == "JL5")
        #expect(arrival.departureAirport == "JFK")
        #expect(arrival.arrivalAirport == "HND")
        #expect(arrival.arrivalTime == "2027-12-09T16:00:00")
    }
}
