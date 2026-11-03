import SwiftUI
import UIKit

/// A Reminders-inspired trip list grouped by ownership.
struct TripListView: View {
    @Bindable var model: AppModel
    @Environment(AppDependencies.self) private var dependencies
    @State private var query = ""
    @State private var selectedTripID: UUID?
    @State private var preferredColumn: NavigationSplitViewColumn = .sidebar
    @State private var editingTrip: Trip?

    private var matchingTrips: [Trip] {
        guard !query.isEmpty else {
            return model.trips
        }

        return model.trips.filter {
            $0.name.localizedCaseInsensitiveContains(query)
                || $0.description.localizedCaseInsensitiveContains(query)
        }
    }

    private var myTrips: [Trip] {
        matchingTrips.filter {
            TripListMetadata.make(for: $0, currentUserID: model.currentUser?.id).inviterName == nil
        }
    }

    private var invitedTrips: [Trip] {
        matchingTrips.filter {
            TripListMetadata.make(for: $0, currentUserID: model.currentUser?.id).inviterName != nil
        }
    }

    var body: some View {
        NavigationSplitView(preferredCompactColumn: $preferredColumn) {
            tripList
        } detail: {
            if let trip = model.trips.first(where: { $0.id == selectedTripID }) {
                TripDestinationsView(model: model, trip: trip, resources: dependencies.resources, api: dependencies.api)
                    .id(trip.id)
            } else {
                ContentUnavailableView("Select a trip", systemImage: "suitcase")
            }
        }
    }

    private var tripList: some View {
        List(selection: $selectedTripID) {
            if !myTrips.isEmpty {
                Section("My Trips") {
                    ForEach(myTrips) { trip in
                        tripRow(trip, allowsEditing: true)
                    }
                }
            }

            if !invitedTrips.isEmpty {
                Section("Invited Trips") {
                    ForEach(invitedTrips) { trip in
                        tripRow(trip, allowsEditing: false)
                    }
                }
            }
        }
        .listStyle(.plain)
        .refreshable {
            await model.refreshTrips()
        }
        .overlay {
            if matchingTrips.isEmpty {
                ContentUnavailableView.search(text: query)
                    .allowsHitTesting(false)
            }
        }
        .navigationTitle("Trips")
        .searchable(text: $query, placement: .toolbar, prompt: "Search trips")
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if model.currentUser == nil {
                    Button("Sign In") {
                        model.showingSignIn = true
                    }
                    .buttonStyle(.bordered)
                }

                Button("Add trip", systemImage: "plus") {
                    editingTrip = Trip.local(name: "", description: "")
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .sheet(item: $editingTrip) { trip in
            TripEditorView(model: model, trip: trip.name.isEmpty ? nil : trip)
        }
    }

    private func tripRow(_ trip: Trip, allowsEditing: Bool) -> some View {
        let metadata = TripListMetadata.make(for: trip, currentUserID: model.currentUser?.id)

        return HStack(spacing: 8) {
            Button {
                selectedTripID = trip.id
                preferredColumn = .detail
            } label: {
                TripListRow(
                    name: trip.name,
                    metadata: metadata
                )
            }
            .buttonStyle(.plain)

            if !trip.isLocal {
                TripListCloudLink(tripID: trip.id)
            }
        }
        .tag(trip.id)
        .swipeActions(edge: .leading, allowsFullSwipe: false) {
            Button(allowsEditing ? "Edit" : "Details", systemImage: allowsEditing ? "pencil" : "info.circle") {
                editingTrip = trip
            }
            .tint(.blue)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: allowsEditing) {
            if allowsEditing {
                Button("Delete", systemImage: "trash", role: .destructive) {
                    Task { await model.deleteTrip(trip) }
                }
            }
        }
    }
}

private struct TripListRow: View {
    let name: String
    let metadata: TripListMetadata

    var body: some View {
        HStack(spacing: 14) {
            if let startDate = metadata.startDate {
                VStack(spacing: 1) {
                    Text(startDate, format: .dateTime.month(.abbreviated))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.tint)
                        .textCase(.uppercase)
                    Text(startDate, format: .dateTime.day())
                        .font(.title2.weight(.bold))
                }
                .frame(width: 42)
            }

            TripListIcon(symbol: metadata.symbol)

            VStack(alignment: .leading, spacing: 5) {
                Text(name)
                    .font(.headline)

                if metadata.startDate != nil || metadata.endDate != nil {
                    TripListDates(startDate: metadata.startDate, endDate: metadata.endDate)
                }

                if let inviterName = metadata.inviterName {
                    TripListOwnership(inviterName: inviterName)
                }
            }

            Spacer(minLength: 6)
        }
        .contentShape(Rectangle())
        .padding(.vertical, 8)
    }
}

#Preview("Trip list") {
    TripPreview { TripListView(model: $0) }
}
