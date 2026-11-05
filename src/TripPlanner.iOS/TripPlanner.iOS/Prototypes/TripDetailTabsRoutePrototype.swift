#if DEBUG
import SwiftUI

enum PrototypeRouteLayout {
    case compact
    case tickets
    case compare
    case expandable
    case inspector
}

enum PrototypeTransport: String, CaseIterable, Identifiable {
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
}

private struct PrototypeLeg: Identifiable {
    let from: PrototypeRow
    let to: PrototypeRow

    var id: UUID { to.id }
    var title: String { "\(from.title) to \(to.title)" }

    var isSampleLeg: Bool {
        switch (from.title, to.title) {
        case ("Tokyo", "Kyoto"), ("Kyoto", "Osaka"): true
        default: false
        }
    }

    func estimate(for mode: PrototypeTransport) -> String {
        switch (from.title, to.title, mode) {
        case ("Tokyo", "Kyoto", .car): "5 hr 30 min"
        case ("Tokyo", "Kyoto", .transit): "2 hr 15 min"
        case ("Kyoto", "Osaka", .car): "1 hr"
        case ("Kyoto", "Osaka", .walking): "10 hr"
        case ("Kyoto", "Osaka", .transit): "30 min"
        case (_, _, .flight): "Search flights"
        default: "Estimate unavailable"
        }
    }
}

struct PrototypeDestinationRoute: View {
    let data: TripPrototypeData
    let layout: PrototypeRouteLayout

    @State private var modes: [UUID: PrototypeTransport] = [:]
    @State private var flights: [UUID: String] = [:]
    @State private var expanded: Set<UUID> = []
    @State private var activeLeg: PrototypeLeg?
    @State private var sheetLeg: PrototypeLeg?

    var body: some View {
        Group {
            if layout == .inspector {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 16) {
                        route.frame(minWidth: 245)
                        inspector.frame(minWidth: 265)
                    }
                    VStack(spacing: 16) {
                        route
                        inspector
                    }
                }
            } else {
                route
            }
        }
        .sheet(item: $sheetLeg) { leg in
            NavigationStack {
                ScrollView {
                    legDetails(leg)
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .navigationTitle("Transportation")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { sheetLeg = nil }
                    }
                }
            }
            .presentationDetents(layout == .tickets ? [.large] : [.medium, .large])
        }
    }

    private var route: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("Destinations", systemImage: "map")
                .font(.title3.bold())
                .accessibilityAddTraits(.isHeader)

            let stops = data[.destinations]
            if stops.isEmpty {
                Text("No destinations yet").foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(stops.enumerated()), id: \.element.id) { index, stop in
                    stopRow(stop, number: index + 1)
                    if index + 1 < stops.count {
                        connector(PrototypeLeg(from: stop, to: stops[index + 1]))
                    }
                }
            }

            Button("Add destination", systemImage: "plus") { data.editor = .destinations }
                .buttonStyle(.bordered)
                .controlSize(.large)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background, in: RoundedRectangle(cornerRadius: 20))
    }

    private func stopRow(_ stop: PrototypeRow, number: Int) -> some View {
        HStack(spacing: 12) {
            Text(number, format: .number)
                .font(.subheadline.bold().monospacedDigit())
                .frame(width: 36, height: 36)
                .background(.tint.opacity(0.14), in: Circle())
                .accessibilityLabel("Stop \(number)")
            VStack(alignment: .leading, spacing: 4) {
                Text(stop.title).font(.headline)
                Text(stop.detail).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private func connector(_ leg: PrototypeLeg) -> some View {
        HStack(spacing: 12) {
            Rectangle()
                .fill(Color.secondary.opacity(0.35))
                .frame(width: 2)
                .frame(width: 36)
                .accessibilityHidden(true)
            legControl(leg)
                .padding(.vertical, 8)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private func legControl(_ leg: PrototypeLeg) -> some View {
        switch layout {
        case .compact:
            Button {
                sheetLeg = leg
            } label: {
                Label(summary(leg), systemImage: mode(for: leg)?.icon ?? "arrow.down")
                    .multilineTextAlignment(.leading)
                    .frame(minHeight: 32)
            }
            .buttonStyle(.bordered)
            .accessibilityHint(leg.title)

        case .tickets:
            VStack(alignment: .leading, spacing: 8) {
                Text(leg.title).font(.caption).foregroundStyle(.secondary)
                Label(summary(leg), systemImage: mode(for: leg)?.icon ?? "arrow.down")
                    .font(.headline)
                Button(mode(for: leg) == .flight ? "Find flights" : "Compare options") { sheetLeg = leg }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))

        case .compare:
            VStack(alignment: .leading, spacing: 8) {
                modeOptions(leg)
                if mode(for: leg) == .flight {
                    Button(flights[leg.id] ?? "Find flights", systemImage: "airplane") { sheetLeg = leg }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                }
            }

        case .expandable:
            DisclosureGroup(isExpanded: expansion(for: leg)) {
                legDetails(leg, showsTitle: false)
                    .padding(.top, 12)
            } label: {
                Label(summary(leg), systemImage: mode(for: leg)?.icon ?? "arrow.down")
                    .font(.subheadline.weight(.semibold))
                    .frame(minHeight: 44)
            }
            .padding(.horizontal, 12)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))

        case .inspector:
            Button {
                activeLeg = leg
            } label: {
                Label(summary(leg), systemImage: mode(for: leg)?.icon ?? "arrow.down")
                    .multilineTextAlignment(.leading)
                    .frame(minHeight: 32)
            }
            .buttonStyle(.borderedProminent)
            .tint(activeLeg?.id == leg.id ? .accentColor : .gray)
            .accessibilityHint(leg.title)
            .accessibilityAddTraits(activeLeg?.id == leg.id ? .isSelected : [])
        }
    }

    private var inspector: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Transportation", systemImage: "arrow.triangle.swap")
                .font(.title3.bold())
                .accessibilityAddTraits(.isHeader)
            if let activeLeg {
                legDetails(activeLeg)
            } else {
                Text("Select a leg").foregroundStyle(.secondary)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background, in: RoundedRectangle(cornerRadius: 20))
    }

    private func legDetails(_ leg: PrototypeLeg, showsTitle: Bool = true) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if showsTitle {
                Text(leg.title).font(.headline).accessibilityAddTraits(.isHeader)
            }
            modeOptions(leg)
            if layout == .tickets {
                PrototypeLegMap(
                    origin: leg.from.title,
                    destination: leg.to.title,
                    mode: mode(for: leg),
                    selectedFlight: flights[leg.id]
                )
            }
            if let mode = mode(for: leg) {
                if mode == .flight {
                    PrototypeFlightChoices(
                        legTitle: leg.title,
                        options: layout == .tickets
                            ? PrototypeLegMap.flightOptions(from: leg.from.title, to: leg.to.title)
                            : ["Morning flight", "Afternoon flight"],
                        selection: Binding {
                            flights[leg.id]
                        } set: {
                            flights[leg.id] = $0
                        }
                    )
                } else {
                    Label("Sample route estimate · \(leg.estimate(for: mode))", systemImage: "map")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.bottom, 8)
    }

    private func modeOptions(_ leg: PrototypeLeg) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 108), spacing: 8)], spacing: 8) {
            ForEach(PrototypeTransport.allCases) { option in
                Button {
                    modes[leg.id] = option
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Label(option.rawValue, systemImage: option.icon)
                            .font(.subheadline.weight(.semibold))
                        Text(leg.estimate(for: option))
                            .font(.caption)
                    }
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
                }
                .buttonStyle(.bordered)
                .tint(mode(for: leg) == option ? .accentColor : .secondary)
                .accessibilityAddTraits(mode(for: leg) == option ? .isSelected : [])
            }
        }
    }

    private func mode(for leg: PrototypeLeg) -> PrototypeTransport? {
        modes[leg.id] ?? (leg.isSampleLeg ? .transit : nil)
    }

    private func summary(_ leg: PrototypeLeg) -> String {
        guard let mode = mode(for: leg) else { return "Choose transportation" }
        if mode == .flight {
            return flights[leg.id] ?? "Find flights"
        }
        return "\(mode.rawValue) · \(leg.estimate(for: mode))"
    }

    private func expansion(for leg: PrototypeLeg) -> Binding<Bool> {
        Binding {
            expanded.contains(leg.id)
        } set: { isExpanded in
            if isExpanded {
                expanded.insert(leg.id)
            } else {
                expanded.remove(leg.id)
            }
        }
    }
}

private struct PrototypeFlightChoices: View {
    let legTitle: String
    let options: [String]
    @Binding var selection: String?
    @State private var showsResults = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button("Search sample flights", systemImage: "magnifyingglass") { showsResults = true }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .accessibilityHint(legTitle)

            if showsResults {
                if options.isEmpty {
                    Text("No sample flights for this leg").foregroundStyle(.secondary)
                }
                ForEach(options, id: \.self) { flight in
                    Button {
                        selection = flight
                    } label: {
                        Label(flight, systemImage: selection == flight ? "checkmark.circle.fill" : "airplane")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .accessibilityAddTraits(selection == flight ? .isSelected : [])
                }
            } else if let selection {
                Label(selection, systemImage: "checkmark.circle")
                    .font(.subheadline)
            }
        }
    }
}

#Preview("01 · Compact route timeline", traits: .landscapeLeft) {
    TripDetailPrototypePreview {
        TripDetailTabsPrototype(data: $0, routeLayout: .compact)
    }
}
#endif
