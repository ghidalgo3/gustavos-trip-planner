import Foundation
import MapKit
import Observation

@MainActor
@Observable
final class DestinationsModel {
    private let model: AppModel
    private let api: any DestinationServing
    private let trip: Trip
    let saveState: ResourceState<[Destination], Destination>
    var loadFailed = false
    var loading = false

    init(model: AppModel, trip: Trip, resources: ResourceStore, api: any DestinationServing) {
        self.model = model
        self.trip = trip
        self.api = api
        saveState = resources.state(for: ResourceKey(path: "/trips/\(trip.id)/destinations")) { values, draft in
            var updated = values
            if let stayID = draft.stayID, let index = updated.firstIndex(where: { $0.stayID == stayID }) {
                updated[index] = draft
            } else {
                updated.append(draft)
            }
            return updated
        }
    }

    func submit(_ destination: Destination, completion: MKLocalSearchCompletion?) {
        saveState.submit(destination) {
            try await self.saveToServer(destination, completion: completion)
            return try await self.fetchDestinations(allowCached: false)
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
        if saveState.needsRefresh { return "Could not save \(saveState.draft?.title ?? "destination"). Refresh this destination before editing again." }
        if saveState.isSaving { return "Saving \(saveState.draft?.title ?? "destination")…" }
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

    private func fetchDestinations(allowCached: Bool) async throws -> [Destination] {
        let data = try await model.tripDocument(for: trip, allowCached: allowCached)
        let snapshot = try JSONDecoder().decode(TripSnapshotDestinations.self, from: data)
        try Task.checkCancellation()
        return snapshot.destinations.map {
            let prefix = "urn:tripplanner:\(trip.id.uuidString.lowercased()):place:"
            let encodedCity = $0.placeID.flatMap { id in
                id.hasPrefix(prefix) ? String(id.dropFirst(prefix.count)) : nil
            }
            let cityID = encodedCity?.removingPercentEncoding
            let stayID = $0.stayID.flatMap { id in
                id.hasPrefix("urn:uuid:") ? UUID(uuidString: String(id.dropFirst(9))) : nil
            }
            let path = encodedCity.map { "/trips/\(trip.id.uuidString.lowercased())/destinations/\($0)" }
            let cityVersion = path.flatMap { snapshot.resources?[$0] }
            let stayVersion = path.flatMap { path in
                stayID.flatMap { snapshot.resources?["\(path)/stays/\($0.uuidString.lowercased())"] }
            }
            return Destination(
                title: $0.name, subtitle: "", arrival: $0.arrival, departure: $0.departure,
                cityID: cityID, stayID: stayID, cityVersion: cityVersion, stayVersion: stayVersion
            )
        }
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

