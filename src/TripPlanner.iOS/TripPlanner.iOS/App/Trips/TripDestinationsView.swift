import MapKit
import SwiftUI

struct TripDestinationsView: View {
    let model: AppModel
    let trip: Trip
    @State private var feature: DestinationsModel
    @State private var retry = 0
    @AppStorage private var savedDestinations: Data

    init(model: AppModel, trip: Trip, resources: ResourceStore, api: any DestinationServing) {
        self.model = model
        self.trip = trip
        _feature = State(initialValue: DestinationsModel(model: model, trip: trip, resources: resources, api: api))
        _savedDestinations = AppStorage(
            wrappedValue: Data(),
            "prototype.destinations.\(trip.id.uuidString)"
        )
    }

    var body: some View {
        if trip.isLocal {
            DestinationList(title: trip.name, canAdd: trip.canPlan, data: $savedDestinations)
        } else {
            Group {
                if let serverDestinations = feature.saveState.displayed {
                    DestinationList(
                        title: trip.name,
                        canAdd: model.isCloudAvailable && trip.canPlan && model.pendingWrite(for: trip) == nil
                            && !feature.loading && !feature.loadFailed && !feature.saveState.isSaving && !feature.saveState.needsRefresh,
                        data: .constant(Data()), serverDestinations: serverDestinations,
                        unavailableReason: feature.editingUnavailableReason,
                        saveToServer: { destination, completion in
                            feature.submit(destination, completion: completion)
                        }
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
    var unavailableReason: String? = nil
    var saveToServer: (@MainActor (Destination, MKLocalSearchCompletion?) async throws -> Void)? = nil
    @State private var edit: Edit?

    private struct Edit: Identifiable {
        let index: Int?
        var original: Destination? = nil
        var id: Int { index ?? -1 }
    }

    private var destinations: [Destination] {
        serverDestinations ?? (try? JSONDecoder().decode([Destination].self, from: data)) ?? []
    }

    var body: some View {
        Group {
            if destinations.isEmpty {
                ContentUnavailableView("No destinations", systemImage: "mappin.and.ellipse")
            } else {
                List(Array(destinations.enumerated()), id: \.offset) { index, destination in
                    HStack {
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
                        if saveToServer == nil || (destination.cityID != nil && destination.stayID != nil) {
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
        .sheet(item: $edit) { edit in
            let original = edit.original
            DestinationEditor(destination: original) { destination, completion in
                if let saveToServer {
                    try await saveToServer(destination, completion)
                    self.edit = nil
                    return
                }
                guard canAdd else { return }
                var updated = destinations
                if let index = edit.index {
                    guard updated.indices.contains(index), updated[index] == original else { return }
                    updated[index] = destination
                } else {
                    updated.append(destination)
                }
                if let encoded = try? JSONEncoder().encode(updated) {
                    data = encoded
                    self.edit = nil
                }
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
    let onSave: @MainActor (Destination, MKLocalSearchCompletion?) async throws -> Void
    @State private var completion: MKLocalSearchCompletion?
    @State private var saving = false
    @State private var saveError: String?
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
        onSave: @escaping @MainActor (Destination, MKLocalSearchCompletion?) async throws -> Void
    ) {
        self.destination = destination
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
            .disabled(saving)
            .interactiveDismissDisabled(saving)
            .alert("Could not save destination", isPresented: Binding(
                get: { saveError != nil },
                set: { if !$0 { saveError = nil } }
            )) {
                Button("OK") { saveError = nil }
            } message: {
                Text(saveError ?? "")
            }
            .navigationTitle(destination == nil ? "Add destination" : "Edit destination")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .buttonStyle(.bordered)
                        .disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
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
                                saveError = error.localizedDescription
                            }
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(saving || city?.title != query || arrival > departure)
                }
            }
            .onChange(of: query) { _, value in
                if city?.title != value { city = nil }
            }
            .task(id: SearchInput(query: query, retryCount: retryCount)) {
                await search.update(city?.title == query ? "" : query)
            }
        }
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

    HStack(spacing: 0) {
        VStack(alignment: .leading, spacing: 12) {
            Button("Sample destinations") {
                data = (try? JSONEncoder().encode([
                    Destination(title: "Tokyo", subtitle: "Japan", arrival: "2027-04-09", departure: "2027-04-12"),
                    Destination(title: "Kyoto", subtitle: "Japan", arrival: "2027-04-12", departure: "2027-04-16")
                ])) ?? Data()
            }
            .buttonStyle(.bordered)
            Button("Empty trip") { data = Data() }
                .buttonStyle(.bordered)
            Spacer()
        }
        .padding()
        Divider()
        NavigationStack {
            DestinationList(title: "Japan in spring", canAdd: true, data: $data)
        }
    }
}
