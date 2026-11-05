import MapKit
import SwiftUI

struct TripDestinationsView: View {
    let model: AppModel
    let trip: Trip
    let api: any TripPlannerServing
    @State private var feature: DestinationsModel
    @State private var retry = 0
    @AppStorage private var savedDestinations: Data

    init(model: AppModel, trip: Trip, resources: ResourceStore, api: any TripPlannerServing) {
        self.model = model
        self.trip = trip
        self.api = api
        _feature = State(initialValue: DestinationsModel(model: model, trip: trip, resources: resources, api: api))
        _savedDestinations = AppStorage(
            wrappedValue: Data(),
            "prototype.destinations.\(trip.id.uuidString)"
        )
    }

    var body: some View {
        if trip.isLocal {
            DestinationList(title: trip.name, canAdd: trip.canPlan, data: $savedDestinations, model: model, trip: trip, api: api)
        } else {
            Group {
                if let itinerary = feature.saveState.displayed {
                    DestinationList(
                        title: trip.name,
                        canAdd: model.isCloudAvailable && trip.canPlan && model.pendingWrite(for: trip) == nil
                            && !feature.loading && !feature.loadFailed && !feature.saveState.isSaving && !feature.saveState.needsRefresh,
                        data: .constant(Data()), serverDestinations: itinerary.destinations, savedFlights: itinerary.flights,
                        home: itinerary.home,
                        unavailableReason: feature.editingUnavailableReason,
                        model: model, trip: trip, api: api,
                        saveToServer: { destination, completion in
                            feature.submit(destination, completion: completion)
                        },
                        removeFromServer: { try feature.remove($0) }
                    )
                } else if feature.loadFailed {
                    ContentUnavailableView {
                        Label("Could not load destinations", systemImage: "exclamationmark.triangle")
                    } actions: {
                        Button("Try again") { retry += 1 }
                            .buttonStyle(.bordered)
                    }
                } else {
                    List(0..<3, id: \.self) { _ in
                        destinationLabel(Destination(title: "Destination", subtitle: "Arrival – Departure"))
                            .redacted(reason: .placeholder)
                            .accessibilityHidden(true)
                    }
                }
            }
            .navigationTitle(trip.name)
            .task(id: retry) { await feature.loadDestinations() }
            .refreshable { await feature.loadDestinations() }
            .safeAreaInset(edge: .bottom) {
                if (feature.loadFailed || feature.saveState.needsRefresh), feature.saveState.displayed != nil {
                    Button("Refresh destinations") { retry += 1 }
                        .buttonStyle(.bordered)
                        .padding()
                        .background(.bar)
                }
            }
        }
    }

}

private struct DestinationList: View {
    let title: String
    let canAdd: Bool
    @Binding var data: Data
    var serverDestinations: [Destination]? = nil
    var savedFlights: [SavedTripFlight] = []
    var home: Destination? = nil
    var unavailableReason: String? = nil
    var model: AppModel? = nil
    var trip: Trip? = nil
    var api: (any TransferFlightServing)? = nil
    var saveToServer: (@MainActor (Destination, MKLocalSearchCompletion?) async throws -> Void)? = nil
    var removeFromServer: (@MainActor (Destination) throws -> Void)? = nil
    @State private var edit: Edit?
    @State private var transfer: DestinationTransfer?

    private struct Edit: Identifiable {
        let index: Int?
        var original: Destination? = nil
        var id: Int { index ?? -1 }
    }

    private var destinations: [Destination] {
        serverDestinations ?? (try? JSONDecoder().decode([Destination].self, from: data)) ?? []
    }

    private var homeStop: Destination {
        if let home { return home }
        if serverDestinations == nil, let city = model?.currentUser?.profile.homeCity {
            return Destination(title: city.name, subtitle: "",
                               coordinate: RouteCoordinate(latitude: city.latitude, longitude: city.longitude))
        }
        return Destination(title: "Home", subtitle: "")
    }

    var body: some View {
        Group {
            if destinations.isEmpty && savedFlights.isEmpty {
                ContentUnavailableView("No destinations", systemImage: "mappin.and.ellipse")
            } else {
                let flights = Dictionary(grouping: savedFlights) { $0.placement(in: destinations) }
                List {
                    if let first = destinations.first {
                        transferCard(
                            DestinationTransfer(origin: homeStop, destination: first, homeLeg: .outbound),
                            title: "Getting there", flights: flights[.inbound]
                        )
                    }
                    ForEach(Array(destinations.enumerated()), id: \.offset) { index, destination in
                        HStack(alignment: .center, spacing: 12) {
                            Text(index + 1, format: .number)
                                .font(.subheadline.bold().monospacedDigit())
                                .frame(width: 36, height: 36)
                                .background(.tint.opacity(0.14), in: Circle())
                                .accessibilityLabel("Stop \(index + 1)")
                            VStack(alignment: .leading, spacing: 4) {
                                destinationLabel(destination)
                                if let arrival = destination.arrival,
                                   let departure = destination.departure,
                                   let start = try? Destination.dateFormat.parse(arrival),
                                   let end = try? Destination.dateFormat.parse(departure), start <= end {
                                    Text(start..<end, format: .interval.day().month().year())
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            if saveToServer == nil || destination.cityID != nil {
                                Button("Edit", systemImage: "pencil") { edit = Edit(index: index, original: destination) }
                                    .buttonStyle(.bordered)
                                    .accessibilityLabel("Edit \(destination.title)")
                                    .disabled(!canAdd)
                            } else {
                                Text("Visit unavailable for editing")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        if index + 1 < destinations.count {
                            let leg = DestinationTransfer(origin: destination, destination: destinations[index + 1])
                            transferCard(leg, title: "Transportation", flights: flights[.transfer(after: index)])
                        }
                    }
                    if let last = destinations.last(where: { $0.stayID != nil }) ?? destinations.last {
                        transferCard(
                            DestinationTransfer(origin: last, destination: homeStop, homeLeg: .returning),
                            title: "Return home", flights: flights[.outbound]
                        )
                    }
                    if let other = flights[.other] {
                        savedFlightCard("Other selected flights", flights: other)
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if let unavailableReason {
                Text(unavailableReason)
                    .font(.callout)
                    .padding()
                    .frame(maxWidth: .infinity)
                    .background(.bar)
            }
        }
        .navigationTitle(title)
        .toolbar {
            Button("Add destination", systemImage: "plus") { edit = Edit(index: nil) }
                .buttonStyle(.bordered)
                .disabled(!canAdd)
        }
        .sheet(item: $transfer) { transfer in
            DestinationTransferSheet(transfer: transfer, model: model, trip: trip, api: api)
                .presentationDetents([.large])
        }
        .sheet(item: $edit) { edit in
            let original = edit.original
            DestinationEditor(
                destination: original,
                canSave: saveToServer == nil || original == nil || original?.stayID != nil,
                removesCloudCity: removeFromServer != nil,
                onRemove: original.map { destination in { try remove(destination, at: edit.index) } }
            ) { destination, completion in
                if let saveToServer {
                    try await saveToServer(destination, completion)
                    self.edit = nil
                    return
                }
                guard canAdd else { return }
                var resolved = destination
                if let completion {
                    let request = MKLocalSearch.Request(completion: completion)
                    request.resultTypes = .address
                    request.addressFilter = MKAddressFilter(including: .locality)
                    let response = try await MKLocalSearch(request: request).start()
                    if let coordinate = response.mapItems.first?.location.coordinate {
                        resolved.coordinate = RouteCoordinate(
                            latitude: coordinate.latitude, longitude: coordinate.longitude
                        )
                    }
                }

                var updated = destinations
                if let index = edit.index {
                    guard updated.indices.contains(index), updated[index] == original else { return }
                    updated[index] = resolved
                } else {
                    updated.append(resolved)
                }
                if let encoded = try? JSONEncoder().encode(updated) {
                    data = encoded
                    self.edit = nil
                }
            }
        }
    }

    private func remove(_ destination: Destination, at index: Int?) throws {
        guard canAdd else {
            throw APIError.server(status: 403, message: "This trip is unavailable for editing.")
        }
        if let removeFromServer {
            try removeFromServer(destination)
        } else {
            var updated = destinations
            guard let index, updated.indices.contains(index), updated[index] == destination else {
                throw APIError.server(status: 409, message: "This destination changed. Open it again before removing it.")
            }
            updated.remove(at: index)
            data = try JSONEncoder().encode(updated)
        }
        edit = nil
    }

    private func transferCard(_ leg: DestinationTransfer, title: String, flights: [SavedTripFlight]?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: "arrow.down").font(.headline)
            Text(leg.title).font(.subheadline).foregroundStyle(.secondary)
            if let flights {
                savedFlightDetails("Selected flights", flights: flights)
            }
            Button("Compare options") { transfer = leg }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .accessibilityHint(leg.title)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 8)
        .listRowBackground(Color(uiColor: .secondarySystemGroupedBackground))
    }

    private func savedFlightCard(_ title: String, flights: [SavedTripFlight]) -> some View {
        savedFlightDetails(title, flights: flights)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 8)
            .listRowBackground(Color(uiColor: .secondarySystemGroupedBackground))
    }

    private func savedFlightDetails(_ title: String, flights: [SavedTripFlight]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: "airplane")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            ForEach(flights) { flight in
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(flight.departureAirport) → \(flight.arrivalAirport)")
                        .font(.subheadline.bold())
                    if !flight.flightNumber.isEmpty {
                        Text(flight.flightNumber).font(.subheadline)
                    }
                    if !flight.departureTime.isEmpty && !flight.arrivalTime.isEmpty {
                        let start = String(flight.departureTime.prefix(16)).replacingOccurrences(of: "T", with: " ")
                        let end = String(flight.arrivalTime.prefix(16)).replacingOccurrences(of: "T", with: " ")
                        Text("\(start) → \(end)")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    if flight.purchased {
                        Label("Purchased", systemImage: "checkmark.circle")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

}

private func destinationLabel(_ destination: Destination) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        Text(destination.title)
        if !destination.subtitle.isEmpty {
            Text(destination.subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
}

private struct DestinationEditor: View {
    private enum DateField: String, CaseIterable {
        case arrival = "Arrival"
        case departure = "Departure"
    }

    private struct SearchInput: Equatable {
        let query: String
        let retryCount: Int
    }

    let destination: Destination?
    let canSave: Bool
    let removesCloudCity: Bool
    let onRemove: (@MainActor () throws -> Void)?
    let onSave: @MainActor (Destination, MKLocalSearchCompletion?) async throws -> Void
    @State private var completion: MKLocalSearchCompletion?
    @State private var saving = false
    @State private var activeAlert: EditorAlert?

    private enum EditorAlert: Identifiable {
        case confirmRemoval(String)
        case error(title: String, message: String)

        var id: String {
            switch self {
            case .confirmRemoval: "confirmRemoval"
            case .error: "error"
            }
        }
    }
    @Environment(\.dismiss) private var dismiss
    @FocusState private var searchFocused: Bool
    @State private var query: String
    @State private var city: Destination?
    @State private var arrival: Date
    @State private var departure: Date
    @State private var dateField: DateField = .arrival
    @State private var retryCount = 0
    @State private var search = DestinationAutocomplete()

    init(
        destination: Destination?,
        canSave: Bool,
        removesCloudCity: Bool,
        onRemove: (@MainActor () throws -> Void)?,
        onSave: @escaping @MainActor (Destination, MKLocalSearchCompletion?) async throws -> Void
    ) {
        self.destination = destination
        self.canSave = canSave
        self.removesCloudCity = removesCloudCity
        self.onRemove = onRemove
        self.onSave = onSave
        _query = State(initialValue: destination?.title ?? "")
        _city = State(initialValue: destination)
        let start = destination?.arrival.flatMap { try? Destination.dateFormat.parse($0) }
            ?? Calendar.current.startOfDay(for: .now)
        _arrival = State(initialValue: start)
        let end = destination?.departure.flatMap { try? Destination.dateFormat.parse($0) } ?? start
        _departure = State(initialValue: max(start, end))
    }

    var body: some View {
        NavigationStack {
            Form {
                if canSave {
                    editableFields
                } else if let destination {
                    destinationLabel(destination)
                }
            }
            .disabled(saving)
            .interactiveDismissDisabled(saving)
            .safeAreaInset(edge: .bottom) {
                if let destination, onRemove != nil {
                    Button("Remove destination", systemImage: "trash", role: .destructive) {
                        activeAlert = .confirmRemoval(destination.title)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .disabled(saving)
                    .padding()
                    .frame(maxWidth: .infinity)
                    .background(.bar)
                }
            }
            .navigationTitle(destination == nil ? "Add destination" : "Edit destination")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .buttonStyle(.bordered)
                        .disabled(saving)
                }
                if canSave {
                    ToolbarItem(placement: .confirmationAction) {
                        saveButton
                    }
                }
            }
            .onChange(of: query) { _, value in
                if city?.title != value { city = nil }
            }
            .task(id: SearchInput(query: query, retryCount: retryCount)) {
                if canSave {
                    await search.update(city?.title == query ? "" : query)
                }
            }
        }
        .alert(item: $activeAlert) { alert in
            switch alert {
            case .confirmRemoval(let title):
                Alert(
                    title: Text("Remove \(title)?"),
                    message: Text(removesCloudCity
                                  ? "This removes all stays and activities for this city."
                                  : "This removes the destination from this trip."),
                    primaryButton: .destructive(Text("Remove destination")) {
                        do {
                            try onRemove?()
                        } catch {
                            activeAlert = .error(title: "Could not remove destination", message: error.localizedDescription)
                        }
                    },
                    secondaryButton: .cancel()
                )
            case .error(let title, let message):
                Alert(title: Text(title), message: Text(message), dismissButton: .default(Text("OK")))
            }
        }
    }

    @ViewBuilder
    private var editableFields: some View {
        Section("City") {
            TextField("Search cities", text: $query)
                .focused($searchFocused)
                .autocorrectionDisabled()
            if let city, city.title == query {
                if !city.subtitle.isEmpty {
                    Text(city.subtitle).foregroundStyle(.secondary)
                }
            } else {
                suggestions
            }
        }

        Section("Dates") {
            LabeledContent("Arrival", value: arrival.formatted(date: .abbreviated, time: .omitted))
            LabeledContent("Departure", value: departure.formatted(date: .abbreviated, time: .omitted))
            Picker("Calendar selection", selection: $dateField) {
                ForEach(DateField.allCases, id: \.self) { field in
                    Text(field.rawValue).tag(field)
                }
            }
            .pickerStyle(.segmented)
            if dateField == .arrival {
                DatePicker("Arrival", selection: $arrival, displayedComponents: .date)
            } else {
                DatePicker("Departure", selection: $departure, in: arrival..., displayedComponents: .date)
            }
        }
        .datePickerStyle(.graphical)
        .onChange(of: arrival) { _, newArrival in
            departure = max(departure, newArrival)
        }
    }

    private var saveButton: some View {
        Button(saving ? "Saving…" : "Save") {
            guard var city, city.title == query, arrival <= departure else { return }
            city.cityID = destination?.cityID
            city.stayID = destination?.stayID
            city.cityVersion = destination?.cityVersion
            city.stayVersion = destination?.stayVersion
            city.arrival = arrival.formatted(Destination.dateFormat)
            city.departure = departure.formatted(Destination.dateFormat)
            saving = true
            Task {
                defer { saving = false }
                do {
                    try await onSave(city, completion)
                } catch {
                    activeAlert = .error(title: "Could not save destination", message: error.localizedDescription)
                }
            }
        }
        .buttonStyle(.borderedProminent)
        .disabled(saving || city?.title != query || arrival > departure)
    }

    @ViewBuilder
    private var suggestions: some View {
        if search.failed {
            Text("City search is unavailable.")
            Button("Try again") { retryCount += 1 }
                .buttonStyle(.bordered)
        } else if search.loading {
            ForEach(0..<3) { _ in
                destinationLabel(Destination(title: "City", subtitle: "Region, Country"))
                    .redacted(reason: .placeholder)
                    .accessibilityHidden(true)
            }
        } else if search.results.isEmpty && !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            Text("No cities found")
                .foregroundStyle(.secondary)
        } else {
            ForEach(search.results) { result in
                Button {
                    completion = search.completion(for: result)
                    city = result
                    query = result.title
                    searchFocused = false
                } label: {
                    destinationLabel(result)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.bordered)
            }
        }
    }
}

#Preview("Trip destinations") {
    @Previewable @State var data = Data()
    @Previewable @State var flights: [SavedTripFlight] = []

    HStack(spacing: 0) {
        VStack(alignment: .leading, spacing: 12) {
            Button("Sample destinations and flights") {
                let tokyo = UUID()
                let kyoto = UUID()
                data = (try? JSONEncoder().encode([
                    Destination(title: "Tokyo", subtitle: "Japan", arrival: "2027-12-09", departure: "2027-12-12", stayID: tokyo),
                    Destination(title: "Kyoto", subtitle: "Japan", arrival: "2027-12-12", departure: "2027-12-16", stayID: kyoto)
                ])) ?? Data()
                flights = [
                    SavedTripFlight(id: "inbound", flightNumber: "JL5", departureAirport: "JFK",
                                    arrivalAirport: "HND", departureTime: "2027-12-08T12:00:00",
                                    arrivalTime: "2027-12-09T16:00:00", originStay: nil,
                                    destinationStay: tokyo, unassigned: false, purchased: true),
                    SavedTripFlight(id: "outbound", flightNumber: "JL4", departureAirport: "HND",
                                    arrivalAirport: "JFK", departureTime: "2027-12-16T18:00:00",
                                    arrivalTime: "2027-12-16T17:00:00", originStay: kyoto,
                                    destinationStay: nil, unassigned: false, purchased: false)
                ]
            }
            .buttonStyle(.bordered)
            Button("Empty trip") {
                data = Data()
                flights = []
            }
                .buttonStyle(.bordered)
            Spacer()
        }
        .padding()
        Divider()
        NavigationStack {
            DestinationList(title: "Japan in December", canAdd: true, data: $data, savedFlights: flights)
        }
    }
}
