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
    case train = "Train"
    case unselected = "Choose transportation"
    case flight = "Flight"

    var id: Self { self }

    var icon: String {
        switch self {
        case .car: "car"
        case .walking: "figure.walk"
        case .train: "tram"
        case .flight: "airplane"
        case .unselected: "arrow.left.arrow.right"
        }
    }

    var wireMode: String? {
        switch self {
        case .car: "car"
        case .walking: "walk"
        case .train: "train"
        case .flight: "flight"
        case .unselected: nil
        }
    }
}

struct DestinationTransferSheet: View {
    let transfer: DestinationTransfer
    let model: AppModel?
    let trip: Trip?
    let api: (any TripPlannerServing)?
    var existing: TransportationResource? = nil
    var onSaved: ((TransportationResource) -> Void)? = nil

    @Environment(\.dismiss) private var dismiss
    @State private var mode: TransferMode = .unselected
    @State private var saved: TransportationResource?
    @State private var saving = false
    @State private var saveError: String?
    @State private var departureStation: MKMapItem?
    @State private var arrivalStation: MKMapItem?
    @State private var departureFeature: TransportationFeature?
    @State private var arrivalFeature: TransportationFeature?
    @State private var stationRole: StationRole?
    @State private var departure = Date.now
    @State private var arrival = Date.now.addingTimeInterval(3600)

    private enum StationRole: String, Identifiable {
        case departure, arrival
        var id: String { rawValue }
    }
    private var canSave: Bool {
        online && model?.isCloudAvailable == true && trip?.isLocal == false && trip?.canPlan == true
        && trip.map { model?.pendingWrite(for: $0) == nil } == true && !saving
    }

    @State private var groundETA: TimeInterval?
    @State private var searchID: UUID?
    @State private var flights: [[TransferFlight.Segment]]?
    @State private var selectedFlight: Int?
    @State private var airports: [String: RouteCoordinate] = [:]
    @State private var flightError: String?
    @State private var mapPosition: MapCameraPosition = .automatic

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
                    } else if mode == .train {
                        trainContent
                    } else if mode != .unselected {
                        groundContent
                    }
                    if let saveError {
                        Text(saveError).foregroundStyle(.red)
                        Button("Refresh transportation") { Task { await refreshTransportation() } }
                            .buttonStyle(.bordered).disabled(!canSave)
                    }
                    if saving { Text("Saving transportation…").foregroundStyle(.secondary) }
                    if !canSave && !saving { Text("Connect to a cloud trip with planning access to save transportation.").foregroundStyle(.secondary) }

                }
                .frame(maxWidth: 760, alignment: .leading)
                .padding(20)
                .frame(maxWidth: .infinity)
            }
            .navigationTitle("Transportation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.disabled(saving)
                }
            }
        }
        .interactiveDismissDisabled(saving)
        .sheet(item: $stationRole) { role in
            TrainStationPicker(city: role == .departure ? transfer.origin : transfer.destination) { item in
                if role == .departure {
                    departureStation = item
                    departureFeature = feature("from", item)
                } else {
                    arrivalStation = item
                    arrivalFeature = feature("to", item)
                }
                groundETA = nil
            }
        }
        .task {
            saved = existing
            mode = TransferMode.allCases.first { $0.wireMode == existing?.mode } ?? .unselected
            if let day = transfer.origin.departure ?? transfer.destination.arrival,
               let date = try? Destination.dateFormat.parse(day) {
                departure = Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: date) ?? date
                arrival = departure.addingTimeInterval(3600)
            }
            if let value = existing {
                departure = value.departureAt.flatMap { try? Date($0, strategy: .iso8601) } ?? departure
                arrival = value.arrivalAt.flatMap { try? Date($0, strategy: .iso8601) } ?? arrival
                if value.mode == "train" {
                    departureFeature = value.features.first { $0.id == "from" }
                    arrivalFeature = value.features.first { $0.id == "to" }
                    departureStation = station(departureFeature)
                    arrivalStation = station(arrivalFeature)
                }
            }
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
            ForEach(TransferMode.allCases.filter { $0 != .unselected }) { option in
                Button {
                    guard !saving else { return }
                    if option == .train { mode = option }
                    else { Task { await choose(option) } }
                } label: {
                    Label(option.rawValue, systemImage: option.icon)
                        .frame(maxWidth: .infinity, minHeight: 32)
                }
                .buttonStyle(.bordered)
                .disabled(!canSave)
                .tint(mode == option ? .accentColor : .secondary)
                .accessibilityAddTraits(mode == option ? .isSelected : [])
            }
        }
    }

    private var trainContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            Button(departureStation?.name ?? "Departure station", systemImage: "tram") { stationRole = .departure }
                .buttonStyle(.bordered).disabled(!canSave)
            DatePicker("Departure (\(TimeZone.current.identifier))", selection: $departure).disabled(!canSave)
            Button(arrivalStation?.name ?? "Arrival station", systemImage: "tram") { stationRole = .arrival }
                .buttonStyle(.bordered).disabled(!canSave)
            DatePicker("Arrival (\(TimeZone.current.identifier))", selection: $arrival).disabled(!canSave)
            Button("Estimate transit time") { Task { await estimateTrain() } }
                .buttonStyle(.bordered).disabled(!canSave || departureStation == nil || arrivalStation == nil)
            if let groundETA {
                LabeledContent("Estimated transit time", value: duration(groundETA))
            }
            if let departureStation, let arrivalStation {
                Button("Train directions in Maps", systemImage: "arrow.up.right.square") {
                    MKMapItem.openMaps(with: [departureStation, arrivalStation], launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeTransit])
                }.buttonStyle(.bordered).disabled(!online)
            }
            Button("Save train") { Task { await saveTrain() } }
                .buttonStyle(.borderedProminent)
                .disabled(!canSave || departureStation == nil || arrivalStation == nil || arrival <= departure)
            if let saved, saved.mode == "train", saved.routeStale {
                Text("Route details need review.").foregroundStyle(.orange)
            }
        }
    }

    private func station(_ feature: TransportationFeature?) -> MKMapItem? {
        guard let feature, let geometry = feature.geometry,
              case .array(let values) = geometry.coordinates, values.count == 2,
              case .number(let longitude) = values[0], case .number(let latitude) = values[1] else { return nil }
        let item = MKMapItem(location: CLLocation(latitude: latitude, longitude: longitude), address: nil)
        item.name = feature.properties.name
        return item
    }

    private func feature(_ id: String, _ item: MKMapItem) -> TransportationFeature {
        TransportationFeature(id: id, geometry: .init(type: .point, coordinates: .array([
            .number(item.location.coordinate.longitude), .number(item.location.coordinate.latitude)
        ])), properties: .init(name: item.name ?? id, address: item.address?.fullAddress))
    }

    private func endpoint(_ id: String, _ destination: Destination, mode: TransferMode) async throws -> TransportationFeature {
        if mode == .flight, destination.stayID == nil, let ownerID = trip?.ownerUserId {
            return TransportationFeature(id: id, geometry: nil, properties: .init(reference: .init(kind: .home, id: ownerID)))
        }
        return feature(id, try await mapItem(destination))
    }

    private func routePoint(_ id: String, _ destination: Destination, draft: TransportationWrite) async throws -> TransportationFeature.Geometry {
        if let geometry = draft.features.first(where: { $0.id == id })?.geometry, geometry.type == .point {
            return geometry
        }
        return feature(id, try await mapItem(destination)).geometry!
    }

    private func choose(_ option: TransferMode) async {
        guard canSave else { return }
        saving = true; saveError = nil
        defer { saving = false }
        do {
            var draft = saved?.draft ?? TransportationWrite(name: transfer.title, notes: "", features: [])
            if draft.mode != option.wireMode {
                draft.features = [try await endpoint("from", transfer.origin, mode: option), try await endpoint("to", transfer.destination, mode: option)]
                draft.departureDate = nil; draft.departureTime = nil; draft.departureAt = nil; draft.arrivalAt = nil; draft.duration = nil
            }
            draft.mode = option.wireMode
            if option == .car || option == .walking, let trip, let api {
                let source = try await routePoint("from", transfer.origin, draft: draft)
                let target = try await routePoint("to", transfer.destination, draft: draft)
                let estimate = try await api.estimateTransportation(tripID: trip.id, from: source, to: target, mode: option.wireMode!)
                draft.duration = estimate.duration
            }
            try await persist(draft)
            mode = option
        } catch { saveError = error.localizedDescription }
    }

    private func refreshTransportation() async {
        guard canSave, let trip, let api else { return }
        saving = true
        defer { saving = false }
        do {
            saved = try await api.transportation(tripID: trip.id).first {
                $0.originStayId == transfer.origin.stayID && $0.destinationStayId == transfer.destination.stayID
            }
            saveError = nil
        } catch { saveError = "Could not refresh transportation. Try again." }
    }

    private func persist(_ input: TransportationWrite) async throws {
        guard let trip, let api else { throw APIError.invalidResponse }
        var draft = input
        draft.originStayId = transfer.origin.stayID
        draft.destinationStayId = transfer.destination.stayID
        let value: TransportationResource
        if let saved { value = try await api.replaceTransportation(tripID: trip.id, value: saved, request: draft) }
        else { value = try await api.createTransportation(tripID: trip.id, request: draft) }
        saved = value
        onSaved?(value)
        if let model { _ = try? await model.tripDocument(for: trip, allowCached: false) }
    }

    private func saveTrain() async {
        guard canSave, let departureStation, let arrivalStation, arrival > departure else { return }
        saving = true; saveError = nil
        defer { saving = false }
        do {
            var draft = saved?.draft ?? TransportationWrite(name: transfer.title, notes: "", features: [])
            let steps = draft.mode == "train" ? draft.features.filter { $0.id != "from" && $0.id != "to" } : []
            draft.features = [departureFeature ?? feature("from", departureStation), arrivalFeature ?? feature("to", arrivalStation)] + steps
            draft.mode = "train"
            draft.departureAt = departure.ISO8601Format(); draft.arrivalAt = arrival.ISO8601Format()
            draft.timeZone = TimeZone.current.identifier
            try await persist(draft)
        } catch { saveError = error.localizedDescription }
    }

    private func estimateTrain() async {
        guard let departureStation, let arrivalStation, !saving else { return }
        saving = true; saveError = nil
        defer { saving = false }
        let request = MKDirections.Request()
        request.source = departureStation; request.destination = arrivalStation
        request.transportType = .transit; request.departureDate = departure
        do {
            let estimate = try await MKDirections(request: request).calculateETA()
            groundETA = estimate.expectedTravelTime
            arrival = estimate.expectedArrivalDate
        } catch { saveError = "Transit estimate unavailable. Enter the train times manually." }
    }

    @ViewBuilder
    private var groundContent: some View {
        if let saved, let value = saved.displayDuration {
            LabeledContent("Estimated travel time", value: value)
            Text("Azure Maps").font(.caption).foregroundStyle(.secondary)
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

    private func duration(_ seconds: TimeInterval) -> String {
        Duration.seconds(seconds).formatted(.units(allowed: [.hours, .minutes], width: .abbreviated))
    }

    private func localTime(_ timestamp: String) -> String {
        String(timestamp.prefix(16)).replacingOccurrences(of: "T", with: " ")
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
