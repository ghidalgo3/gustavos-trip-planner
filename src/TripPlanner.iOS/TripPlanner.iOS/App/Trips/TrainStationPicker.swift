import MapKit
import SwiftUI

struct TrainStationPicker: View {
    let city: Destination
    let onSelect: (MKMapItem) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: [MKMapItem] = []
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if loading {
                    ForEach(0..<3) { _ in
                        VStack(alignment: .leading) {
                            Text("Station name").font(.headline)
                            Text("Station address").font(.subheadline)
                        }.redacted(reason: .placeholder).accessibilityHidden(true)
                    }
                }
                ForEach(Array(results.enumerated()), id: \.offset) { _, item in
                    Button {
                        onSelect(item)
                        dismiss()
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.name ?? "Station").font(.headline)
                            if let address = item.address?.fullAddress {
                                Text(address).font(.subheadline).foregroundStyle(.secondary)
                            }
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }.buttonStyle(.bordered)
                }
                if let error { Text(error).foregroundStyle(.secondary) }
            }
            .navigationTitle("Stations in \(city.title)")
            .searchable(text: $query, prompt: "Search stations")
            .onSubmit(of: .search) { Task { await search() } }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.buttonStyle(.bordered)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Search") { Task { await search() } }.buttonStyle(.bordered)
                        .disabled(loading || query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }

    private func search() async {
        guard !loading else { return }
        loading = true; error = nil
        defer { loading = false }
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = "\(query) train station \(city.title)"
        request.resultTypes = .pointOfInterest
        request.pointOfInterestFilter = MKPointOfInterestFilter(including: [.publicTransport])
        if let coordinate = city.coordinate {
            request.region = MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: coordinate.latitude, longitude: coordinate.longitude), latitudinalMeters: 50000, longitudinalMeters: 50000)
        }
        do {
            results = try await MKLocalSearch(request: request).start().mapItems
            if results.isEmpty { error = "No stations found. Try another name." }
        } catch { self.error = "Could not search stations. Try again." }
    }
}

#Preview("Train stations") {
    TripPreview { _ in
        TrainStationPicker(city: Destination(title: "Kyoto", subtitle: "Japan")) { _ in }
    }
}
