#if DEBUG
import MapKit
import SwiftUI

struct PrototypeLegMap: View {
    let origin: String
    let destination: String
    let mode: PrototypeTransport?
    let selectedFlight: String?

    private struct Path: Identifiable {
        let id: String
        let coordinates: [CLLocationCoordinate2D]
        let color: Color
    }

    private var paths: [Path] {
        guard let mode else { return [] }
        if mode == .flight {
            guard origin == "Tokyo", destination == "Kyoto" else { return [] }
            return Self.flightPaths
        }

        guard let start = Self.cities[origin], let end = Self.cities[destination] else { return [] }
        let waypoints: [CLLocationCoordinate2D]
        switch (origin, destination, mode) {
        case ("Tokyo", "Kyoto", .car):
            waypoints = [.init(latitude: 35.10, longitude: 138.86),
                         .init(latitude: 34.82, longitude: 137.41),
                         .init(latitude: 35.03, longitude: 136.77)]
        case ("Tokyo", "Kyoto", .transit):
            waypoints = [.init(latitude: 35.26, longitude: 139.15),
                         .init(latitude: 34.97, longitude: 138.39),
                         .init(latitude: 35.17, longitude: 136.88)]
        case ("Kyoto", "Osaka", .car):
            waypoints = [.init(latitude: 34.89, longitude: 135.68),
                         .init(latitude: 34.76, longitude: 135.56)]
        case ("Kyoto", "Osaka", .walking):
            waypoints = [.init(latitude: 34.88, longitude: 135.71),
                         .init(latitude: 34.81, longitude: 135.65),
                         .init(latitude: 34.75, longitude: 135.54)]
        case ("Kyoto", "Osaka", .transit):
            waypoints = [.init(latitude: 34.85, longitude: 135.62),
                         .init(latitude: 34.73, longitude: 135.50)]
        default:
            return []
        }
        return [Path(id: mode.rawValue, coordinates: [start] + waypoints + [end], color: .blue)]
    }

    var body: some View {
        if let mode {
            VStack(alignment: .leading, spacing: 8) {
                let visiblePaths = paths
                if visiblePaths.isEmpty {
                    Label("No sample map for this option", systemImage: "map")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else {
                    Map(initialPosition: .automatic, interactionModes: [.pan, .zoom]) {
                        ForEach(visiblePaths) { path in
                            MapPolyline(coordinates: path.coordinates,
                                        contourStyle: mode == .flight ? .geodesic : .straight)
                                .stroke(path.color.opacity(isHighlighted(path) ? 1 : 0.35),
                                        lineWidth: isHighlighted(path) ? 5 : 3)
                        }
                        if mode == .flight {
                            Marker("HND", coordinate: Self.haneda)
                            Marker("ITM", coordinate: Self.itami)
                            Marker("KIX", coordinate: Self.kansai)
                        } else if let start = Self.cities[origin], let end = Self.cities[destination] {
                            Marker(origin, coordinate: start)
                            Marker(destination, coordinate: end)
                        }
                    }
                    .id(mode)
                    .mapStyle(.standard(pointsOfInterest: .excludingAll))
                    .frame(height: 260)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .accessibilityLabel(mode == .flight ? "Sample flight paths" : "Sample \(mode.rawValue) route")

                    if mode == .flight {
                        ForEach(visiblePaths) { path in
                            Label(path.id, systemImage: "line.diagonal")
                                .font(.caption)
                                .foregroundStyle(path.color)
                        }
                    }
                    Text(mode == .flight ? "Illustrative great-circle paths" : "Illustrative route")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func isHighlighted(_ path: Path) -> Bool {
        selectedFlight == nil || mode != .flight || selectedFlight == path.id
    }

    static func flightOptions(from origin: String, to destination: String) -> [String] {
        guard origin == "Tokyo", destination == "Kyoto" else { return [] }
        return flightPaths.map(\.id)
    }

    private static let cities: [String: CLLocationCoordinate2D] = [
        "Tokyo": .init(latitude: 35.681, longitude: 139.767),
        "Kyoto": .init(latitude: 34.986, longitude: 135.759),
        "Osaka": .init(latitude: 34.702, longitude: 135.495)
    ]
    private static let haneda = CLLocationCoordinate2D(latitude: 35.549, longitude: 139.780)
    private static let itami = CLLocationCoordinate2D(latitude: 34.785, longitude: 135.438)
    private static let kansai = CLLocationCoordinate2D(latitude: 34.434, longitude: 135.244)

    private static let flightPaths = [
        Path(id: "HND → ITM", coordinates: [haneda, itami], color: .blue),
        Path(id: "HND → KIX", coordinates: [haneda, kansai], color: .purple)
    ]
}

#Preview("Transfer tickets · Map sheet", traits: .landscapeLeft) {
    TripDetailPrototypePreview {
        TripDetailTabsPrototype(data: $0, routeLayout: .tickets)
    }
}
#endif
