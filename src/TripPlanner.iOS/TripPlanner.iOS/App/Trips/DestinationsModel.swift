import Foundation
import MapKit
import Observation
#if DEBUG
import OSLog
#endif

@MainActor
@Observable
final class DestinationsModel {
    private let model: AppModel
    private let api: any DestinationServing
    private let trip: Trip
    struct Itinerary {
        var destinations: [Destination]
        let flights: [SavedTripFlight]
        let home: Destination?
        var transportation: [TransportationResource] = []
    }

    enum Change {
        case save(Destination)
        case remove(Destination)
    }

    let saveState: ResourceState<Itinerary, Change>
    var loadFailed = false
    var loading = false

    init(model: AppModel, trip: Trip, resources: ResourceStore, api: any DestinationServing) {
        self.model = model
        self.trip = trip
        self.api = api
        saveState = resources.state(for: ResourceKey(path: "/trips/\(trip.id)/destinations")) { values, draft in
            guard case .save(let destination) = draft else { return values }
            var updated = values
            if let stayID = destination.stayID,
               let index = updated.destinations.firstIndex(where: { $0.stayID == stayID }) {
                updated.destinations[index] = destination
            } else {
                updated.destinations.append(destination)
            }
            return updated
        }
    }

    func submit(_ destination: Destination, completion: MKLocalSearchCompletion?) {
        saveState.submit(.save(destination)) {
            try await self.saveToServer(destination, completion: completion)
            return try await self.fetchDestinations(allowCached: false)
        }
    }

    func remove(_ destination: Destination) throws {
        try requireEditingPermission()
        guard let cityID = destination.cityID, !loading, !loadFailed,
              !saveState.isSaving, !saveState.needsRefresh,
              saveState.confirmed?.destinations.contains(destination) == true else {
            throw APIError.server(status: 409, message: "Refresh destinations before removing this city.")
        }
        saveState.submit(.remove(destination)) {
            do {
                try self.requireEditingPermission()
                try await self.api.deleteDestination(
                    tripID: self.trip.id, cityID: cityID, version: destination.cityVersion
                )
                let itinerary = try await self.fetchDestinations(allowCached: false)
                guard !itinerary.destinations.contains(where: { $0.cityID == cityID }) else {
                    throw APIError.server(status: 409, message: "The destination is still in the trip.")
                }
                return itinerary
            } catch {
                #if DEBUG
                let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "TripPlanner", category: "HTTP")
                switch error {
                case APIError.server(let status, let message):
                    log.error("Destination removal could not be confirmed: HTTP \(status) \(message ?? "", privacy: .private)")
                case let DecodingError.typeMismatch(_, context),
                     let DecodingError.valueNotFound(_, context),
                     let DecodingError.keyNotFound(_, context),
                     let DecodingError.dataCorrupted(context):
                    let path = context.codingPath.map(\.stringValue).joined(separator: ".")
                    log.error("Destination removal refresh could not decode the document at \(path, privacy: .public)")
                default:
                    let failure = error as NSError
                    log.error("Destination removal could not be confirmed: \(failure.domain, privacy: .public) \(failure.code)")
                }
                #endif
                throw error
            }
        }
    }

    private func requireEditingPermission() throws {
        guard model.isCloudAvailable, trip.canPlan, model.pendingWrite(for: trip) == nil else {
            throw APIError.server(status: 403, message: "This trip is unavailable for editing.")
        }
    }

    var editingUnavailableReason: String? {
        if !trip.canPlan { return "You do not have permission to edit this trip." }
        if !model.isCloudAvailable { return "Connect to the cloud to edit destinations." }
        if model.pendingWrite(for: trip) != nil { return "Finish syncing this trip to edit destinations." }
        if let draft = saveState.draft {
            switch draft {
            case .save(let destination):
                if saveState.needsRefresh { return "Could not save \(destination.title). Refresh destinations before editing again." }
                if saveState.isSaving { return "Saving \(destination.title)…" }
            case .remove(let destination):
                if saveState.needsRefresh { return "Could not confirm removal of \(destination.title). Refresh destinations before trying again." }
                if saveState.isSaving { return "Removing \(destination.title)…" }
            }
        }
        if loadFailed { return "Refresh destinations before editing." }
        if loading { return "Refreshing destinations…" }
        return nil
    }

    func loadDestinations(allowCached: Bool = true) async {
        guard !loading, !saveState.isSaving else { return }
        loading = true
        defer { loading = false }
        loadFailed = false
        do {
            let destinations = try await fetchDestinations(allowCached: allowCached && !saveState.needsRefresh)
            saveState.acceptRefresh(destinations)
        } catch {
            guard !Task.isCancelled, !(error is CancellationError) else { return }
            loadFailed = true
        }
    }

    private func fetchDestinations(allowCached: Bool) async throws -> Itinerary {
        let data = try await model.tripDocument(for: trip, allowCached: allowCached)
        let document = try JSONDecoder().decode(TripDocumentDestinations.self, from: data)
        try Task.checkCancellation()
        let destinations = document.destinations.map {
            let prefix = "urn:tripplanner:\(trip.id.uuidString.lowercased()):place:"
            let encodedCity = $0.placeID.flatMap { id in
                id.hasPrefix(prefix) ? String(id.dropFirst(prefix.count)) : nil
            }
            let cityID = encodedCity?.removingPercentEncoding
            let stayID = TripDocumentDestinations.stayID($0.stayID)
            let path = encodedCity.map { "/trips/\(trip.id.uuidString.lowercased())/destinations/\($0)" }
            let cityVersion = path.flatMap { document.resources?[$0] }
            let stayVersion = path.flatMap { path in
                stayID.flatMap { document.resources?["\(path)/stays/\($0.uuidString.lowercased())"] }
            }
            return Destination(
                title: $0.name, subtitle: "", coordinate: $0.coordinate, arrival: $0.arrival, departure: $0.departure,
                cityID: cityID, stayID: stayID, cityVersion: cityVersion, stayVersion: stayVersion
            )
        }
        return Itinerary(destinations: destinations, flights: document.selectedFlights, home: document.home, transportation: document.transportation)
    }

    @MainActor
    private func saveToServer(_ destination: Destination, completion: MKLocalSearchCompletion?) async throws {
        let dates = DestinationStayRequest(arrivalDate: destination.arrival, departureDate: destination.departure)
        var city: DestinationCity?
        if let completion {
            let request = MKLocalSearch.Request(completion: completion)
            request.resultTypes = .address
            request.addressFilter = MKAddressFilter(including: .locality)
            let response = try await MKLocalSearch(request: request).start()
            guard let item = response.mapItems.first,
                  let countryCode = item.addressRepresentations?.region?.identifier,
                  countryCode.count == 2 else {
                throw APIError.server(status: 400, message: "MapKit could not resolve this city. Choose another result.")
            }
            let coordinate = item.location.coordinate
            city = DestinationCity(name: item.name ?? destination.title, countryCode: countryCode,
                                   longitude: coordinate.longitude, latitude: coordinate.latitude)
        }
        try requireEditingPermission()
        if let cityID = destination.cityID, let stayID = destination.stayID {
            if let city {
                guard let version = destination.cityVersion else {
                    throw APIError.server(status: 428, message: "Refresh this destination before editing it.")
                }
                let existing = try JSONDecoder().decode(DestinationResource.self, from: JSONEncoder().encode(version.data))
                let request = DestinationUpdateRequest(id: cityID, city: city, existing: existing)
                try await api.updateDestination(tripID: trip.id, cityID: cityID, request: request, version: version)
            }
            try requireEditingPermission()
            try await api.updateDestinationStay(tripID: trip.id, cityID: cityID, stayID: stayID,
                                                request: dates, version: destination.stayVersion)
        } else {
            guard let city else {
                throw APIError.server(status: 400, message: "Select a city from the search results.")
            }
            try await api.createDestination(tripID: trip.id, request: DestinationCreateRequest(city: city, dates: dates))
        }
    }
}

@MainActor
@Observable
final class DestinationAutocomplete: NSObject, @preconcurrency MKLocalSearchCompleterDelegate {
    private var completer: MKLocalSearchCompleter?
    private(set) var results: [Destination] = []
    private(set) var loading = false
    private(set) var failed = false

    func update(_ query: String) async {
        completer?.delegate = nil
        completer?.cancel()
        completer = nil
        results = []
        failed = false
        let fragment = query.trimmingCharacters(in: .whitespacesAndNewlines)
        loading = !fragment.isEmpty
        guard loading else { return }
        do {
            try await Task.sleep(for: .milliseconds(250))
        } catch {
            return
        }
        guard !Task.isCancelled else { return }

        let request = MKLocalSearchCompleter()
        request.resultTypes = .address
        request.addressFilter = MKAddressFilter(including: .locality)
        request.delegate = self
        completer = request
        request.queryFragment = fragment
    }

    func completion(for destination: Destination) -> MKLocalSearchCompletion? {
        completer?.results.first { $0.title == destination.title && $0.subtitle == destination.subtitle }
    }

    func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
        guard completer === self.completer else { return }
        var seen: Set<String> = []
        results = completer.results.compactMap { completion in
            let destination = Destination(title: completion.title, subtitle: completion.subtitle)
            return seen.insert(destination.id).inserted ? destination : nil
        }
        loading = false
    }

    func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: any Error) {
        guard completer === self.completer else { return }
        failed = true
        loading = false
    }
}

