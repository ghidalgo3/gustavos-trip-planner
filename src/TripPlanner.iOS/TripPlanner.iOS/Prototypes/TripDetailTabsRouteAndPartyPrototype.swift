#if DEBUG
import SwiftUI

#Preview("03 · Tabs with route and Add people toolbar", traits: .landscapeLeft) {
    TripDetailPrototypePreview {
        TripDetailTabsPrototype(data: $0, routeLayout: .compact, showsPartyToolbar: true)
    }
}
#endif
