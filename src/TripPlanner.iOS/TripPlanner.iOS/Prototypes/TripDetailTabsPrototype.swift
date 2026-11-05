#if DEBUG
import SwiftUI

struct TripDetailTabsPrototype: View {
    @State private var selection = PrototypeSection.destinations
    let data: TripPrototypeData
    var routeLayout: PrototypeRouteLayout? = nil
    var showsPartyToolbar = false

    var body: some View {
        TabView(selection: $selection) {
            ForEach(PrototypeSection.allCases) { section in
                Tab(section.rawValue, systemImage: section.icon, value: section) {
                    ScrollView {
                        VStack(spacing: 24) {
                            PrototypeTripHeading()
                            if let routeLayout, section == .destinations {
                                PrototypeDestinationRoute(data: data, layout: routeLayout)
                            } else {
                                PrototypePanel(
                                    section: section,
                                    data: data,
                                    showsAction: section != .people || !showsPartyToolbar
                                )
                            }
                        }
                        .frame(maxWidth: 760)
                        .padding(24)
                        .frame(maxWidth: .infinity)
                    }
                    .background(Color(uiColor: .systemGroupedBackground))
                }
            }
        }
        .tabViewStyle(.tabBarOnly)
        .toolbar {
            if showsPartyToolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Add people", systemImage: "person.badge.plus") {
                        data.editor = .people
                    }
                }
            }
        }
    }
}

#Preview("Focused tabs · Original", traits: .landscapeLeft) {
    TripDetailPrototypePreview { TripDetailTabsPrototype(data: $0) }
}
#endif
