import MapKit
import SwiftUI

struct DestinationTransfer: Identifiable {
    let origin: Destination
    let destination: Destination

    var homeLeg: HomeLeg? = nil

    enum HomeLeg {
        case outbound
        case returning
    }

    var hasFlightEndpoints: Bool {
        switch homeLeg {
        case .outbound: destination.stayID != nil
        case .returning: origin.stayID != nil
        case nil: origin.stayID != nil && destination.stayID != nil
        }
    }

    var home: Destination? {
        switch homeLeg {
        case .outbound: origin
        case .returning: destination
        case nil: nil
        }
    }

    let id = UUID()
    var title: String { "\(origin.title) to \(destination.title)" }
}

private enum TransferMode: String, CaseIterable, Identifiable {
    case car = "Car"
    case walking = "Walking"
    case transit = "Public transit"
    case flight = "Flight"

    var id: Self { self }

    var icon: String {
        switch self {
        case .car: "car"
        case .walking: "figure.walk"
        case .transit: "tram"
        case .flight: "airplane"
        }
    }

    var mapKitMode: MKDirectionsTransportType {
        switch self {
        case .car: .automobile
        case .walking: .walking
        case .transit: .transit
        case .flight: []
        }
    }
}

struct DestinationTransferSheet: View {
    let transfer: DestinationTransfer
    let model: AppModel?
    let trip: Trip?
    let api: (any TransferFlightServing)?

    @Environment(\.dismiss) private var dismiss
    @State private var mode: TransferMode = .car
    @State private var retry = 0
    @State private var endpoints: [MKMapItem] = []
    @State private var groundRoutes: [MKRoute] = []
    @State private var groundETA: TimeInterval?
    @State private var selectedRoute: Int?
    @State private var groundError: String?
    @State private var loadingGround = false
    @State private var searchID: UUID?
    @State private var flights: [[TransferFlight.Segment]]?
    @State private var selectedFlight: Int?
    @State private var airports: [String: RouteCoordinate] = [:]
    @State private var flightError: String?
    @State private var mapPosition: MapCameraPosition = .automatic

    private struct GroundRequest: Equatable {
        let mode: TransferMode
        let online: Bool
        let retry: Int
    }

    private var online: Bool { model?.hasNetworkPath ?? true }
    private var canSearchFlights: Bool {
        online && model?.isCloudAvailable == true && trip?.isLocal == false && trip?.canPlan == true
            && transfer.hasFlightEndpoints
            && trip.map { model?.pendingWrite(for: $0) == nil } == true
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(transfer.title)
                        .font(.title2.bold())
                        .accessibilityAddTraits(.isHeader)
                    modePicker
                    if mode == .flight {
                        flightContent
                    } else {
                        groundContent
                    }
                }
                .frame(maxWidth: 760, alignment: .leading)
                .padding(20)
                .frame(maxWidth: .infinity)
            }
            .navigationTitle("Transportation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .task(id: GroundRequest(mode: mode, online: online, retry: retry)) {
            await loadGround(mode)
        }
        .task(id: searchID) {
            if searchID != nil {
                await searchFlights()
            }
        }
        .onChange(of: mode) { mapPosition = .automatic }
    }

    private var modePicker: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 8)], spacing: 8) {
            ForEach(TransferMode.allCases) { option in
                Button {
                    mode = option
                } label: {
                    Label(option.rawValue, systemImage: option.icon)
                        .frame(maxWidth: .infinity, minHeight: 32)
                }
                .buttonStyle(.bordered)
                .tint(mode == option ? .accentColor : .secondary)
                .accessibilityAddTraits(mode == option ? .isSelected : [])
            }
        }
    }

    @ViewBuilder
    private var groundContent: some View {
        if endpoints.count == 2 {
            Map(position: $mapPosition) {
                ForEach(Array(groundRoutes.enumerated()), id: \.offset) { index, route in
                    MapPolyline(route)
                        .stroke(Color.accentColor.opacity(selectedRoute == index ? 1 : 0.4),
                                lineWidth: selectedRoute == index ? 6 : 3)
                }
                Marker(transfer.origin.title, coordinate: endpoints[0].location.coordinate)
                Marker(transfer.destination.title, coordinate: endpoints[1].location.coordinate)
            }
            .frame(height: 280)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .accessibilityLabel("\(mode.rawValue) map")
        } else if loadingGround {
            mapPlaceholder
        }

        if loadingGround {
            Text("Finding routes…").foregroundStyle(.secondary)
        } else if !online {
            Text("Connect to the internet to find routes.").foregroundStyle(.secondary)
        } else if let groundError {
            Text(groundError).foregroundStyle(.secondary)
            if transfer.home == nil || transfer.home?.coordinate != nil {
                Button("Try again") { retry += 1 }.buttonStyle(.bordered)
            }
        }

        ForEach(Array(groundRoutes.enumerated()), id: \.offset) { index, route in
            Button {
                selectedRoute = index
            } label: {
                LabeledContent(route.name.isEmpty ? "Route \(index + 1)" : route.name) {
                    Text(duration(route.expectedTravelTime))
                }
            }
            .buttonStyle(.bordered)
            .accessibilityAddTraits(selectedRoute == index ? .isSelected : [])
        }
        if let groundETA {
            LabeledContent("Estimated transit time", value: duration(groundETA))
        }
        if endpoints.count == 2 && online {
            Button("Directions in Maps", systemImage: "arrow.up.right.square") {
                let directionsMode: String = switch mode {
                case .car: MKLaunchOptionsDirectionsModeDriving
                case .walking: MKLaunchOptionsDirectionsModeWalking
                case .transit: MKLaunchOptionsDirectionsModeTransit
                case .flight: MKLaunchOptionsDirectionsModeDefault
                }
                MKMapItem.openMaps(with: endpoints, launchOptions: [MKLaunchOptionsDirectionsModeKey: directionsMode])
            }
            .buttonStyle(.bordered)
        }
    }

    @ViewBuilder
    private var flightContent: some View {
        let paths = flightPaths
        if !paths.isEmpty {
            Map(position: $mapPosition) {
                ForEach(paths) { path in
                    MapPolyline(coordinates: [path.origin, path.destination], contourStyle: .geodesic)
                        .stroke(Color.accentColor.opacity(path.highlighted ? 1 : 0.3),
                                lineWidth: path.highlighted ? 5 : 2)
                }
                ForEach(Array(airports.keys.sorted()), id: \.self) { code in
                    if let coordinate = airports[code], paths.contains(where: { $0.includes(code) }) {
                        Marker(code, coordinate: coordinate.mapCoordinate)
                    }
                }
            }
            .frame(height: 280)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .accessibilityLabel("Illustrative airport-to-airport flight paths")
            Text("Great-circle paths").font(.caption).foregroundStyle(.secondary)
        } else if let flights, !flights.isEmpty {
            Text("Flight paths unavailable").foregroundStyle(.secondary)
        }

        if searchID != nil {
            ProgressView("Searching trip flights…")
        } else {
            Button("Search trip flights", systemImage: "magnifyingglass") { searchID = UUID() }
                .buttonStyle(.borderedProminent)
                .disabled(!canSearchFlights)
        }
        if !canSearchFlights {
            Text(flightUnavailableReason).foregroundStyle(.secondary)
        }
        if let flightError {
            Text(flightError).foregroundStyle(.secondary)
        }
        if let flights {
            if flights.isEmpty {
                Text("No flights found for this leg").foregroundStyle(.secondary)
            }
            ForEach(Array(flights.enumerated()), id: \.offset) { index, segments in
                Button {
                    selectedFlight = index
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(([segments[0].departureAirport] + segments.map(\.arrivalAirport)).joined(separator: " → "))
                            .font(.headline)
                        Text(segments.map { [$0.marketingCarrierCode, $0.flightNumber].compactMap { $0 }.joined() }
                            .filter { !$0.isEmpty }.joined(separator: " · "))
                        if let departure = segments.first?.departureTimeLocal,
                           let arrival = segments.last?.arrivalTimeLocal {
                            Text("\(localTime(departure)) → \(localTime(arrival))")
                                .font(.subheadline)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.bordered)
                .tint(selectedFlight == index ? .accentColor : .secondary)
                .accessibilityAddTraits(selectedFlight == index ? .isSelected : [])
            }
        }
    }

    private var flightUnavailableReason: String {
        if trip?.isLocal == true { return "Move this trip to the cloud to search flights." }
        if trip?.canPlan == false { return "Flight search requires planning access." }
        if !transfer.hasFlightEndpoints {
            return "Add stay dates to search flights."
        }
        if let trip, model?.pendingWrite(for: trip) != nil { return "Finish syncing the trip to search flights." }
        return "Connect to the cloud to search flights."
    }

    private var mapPlaceholder: some View {
        RoundedRectangle(cornerRadius: 16)
            .fill(.quaternary)
            .frame(height: 280)
            .accessibilityHidden(true)
    }

    private func duration(_ seconds: TimeInterval) -> String {
        Duration.seconds(seconds).formatted(.units(allowed: [.hours, .minutes], width: .abbreviated))
    }

    private func localTime(_ timestamp: String) -> String {
        String(timestamp.prefix(16)).replacingOccurrences(of: "T", with: " ")
    }

    private func loadGround(_ mode: TransferMode) async {
        groundRoutes = []
        groundETA = nil
        selectedRoute = nil
        groundError = nil
        loadingGround = false
        guard mode != .flight, online else { return }
        if let home = transfer.home, home.coordinate == nil {
            groundError = "Set a home city to compare ground routes."
            return
        }
        loadingGround = true
        defer {
            if !Task.isCancelled { loadingGround = false }
        }
        do {
            if endpoints.isEmpty {
                let source = try await mapItem(transfer.origin)
                let destination = try await mapItem(transfer.destination)
                try Task.checkCancellation()
                endpoints = [source, destination]
            }

            let request = MKDirections.Request()
            request.source = endpoints[0]
            request.destination = endpoints[1]
            request.transportType = mode.mapKitMode
            request.requestsAlternateRoutes = mode != .transit
            let directions = MKDirections(request: request)
            if mode == .transit {
                let eta = try await directions.calculateETA()
                try Task.checkCancellation()
                groundETA = eta.expectedTravelTime
            } else {
                let response = try await directions.calculate()
                try Task.checkCancellation()
                groundRoutes = response.routes
                selectedRoute = groundRoutes.isEmpty ? nil : 0
                if groundRoutes.isEmpty { groundError = "No routes found" }
            }
            mapPosition = .automatic
        } catch {
            guard !Task.isCancelled else { return }
            groundError = mode == .transit ? "Transit estimate unavailable" : "Could not find a route"
        }
    }

    private func mapItem(_ destination: Destination) async throws -> MKMapItem {
        if let coordinate = destination.coordinate {
            let item = MKMapItem(location: CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude),
                                 address: nil)
            item.name = destination.title
            return item
        }
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = [destination.title, destination.subtitle].filter { !$0.isEmpty }.joined(separator: ", ")
        request.resultTypes = .address
        request.addressFilter = MKAddressFilter(including: .locality)
        let response = try await MKLocalSearch(request: request).start()
        guard let item = response.mapItems.first else { throw APIError.invalidResponse }
        return item
    }

    private func searchFlights() async {
        defer { searchID = nil }
        guard canSearchFlights, let trip, let api else { return }
        flightError = nil
        do {
            let found = try await api.searchTransferFlights(tripID: trip.id, from: transfer.origin.stayID, to: transfer.destination.stayID)
            try Task.checkCancellation()
            flights = found
            selectedFlight = nil
            let segments = found.flatMap { $0 }
            let codes = Set(segments.flatMap { [$0.departureAirport, $0.arrivalAirport] }).sorted()
            for code in codes where airports[code] == nil {
                let coordinate = try? await api.airportCoordinate(code: code)
                try Task.checkCancellation()
                airports[code] = coordinate
            }
            mapPosition = .automatic
        } catch {
            guard !Task.isCancelled else { return }
            flightError = error.localizedDescription
        }
    }

    private struct FlightPath: Identifiable {
        struct Key: Hashable {
            let origin: String
            let destination: String
        }

        let id: Key
        let origin: CLLocationCoordinate2D
        let destination: CLLocationCoordinate2D
        let highlighted: Bool

        func includes(_ code: String) -> Bool { id.origin == code || id.destination == code }
    }

    private var flightPaths: [FlightPath] {
        let options = flights ?? []
        let keys = options.map { segments in
            segments.map { FlightPath.Key(origin: $0.departureAirport, destination: $0.arrivalAirport) }
        }
        let selected = selectedFlight.map { Set(keys[$0]) }
        var seen = Set<FlightPath.Key>()
        return keys.flatMap { $0 }.compactMap { key in
            guard seen.insert(key).inserted, let origin = airports[key.origin],
                  let destination = airports[key.destination] else { return nil }
            return FlightPath(id: key, origin: origin.mapCoordinate, destination: destination.mapCoordinate,
                              highlighted: selected?.contains(key) ?? true)
        }
        .sorted { !$0.highlighted && $1.highlighted }
    }
}

private extension RouteCoordinate {
    var mapCoordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

#Preview("Destination transfer") {
    TripPreview { model in
        DestinationTransferSheet(
            transfer: DestinationTransfer(
                origin: Destination(title: "Kyoto", subtitle: "Japan"),
                destination: Destination(title: "Osaka", subtitle: "Japan")
            ),
            model: model, trip: nil, api: nil
        )
    }
}
