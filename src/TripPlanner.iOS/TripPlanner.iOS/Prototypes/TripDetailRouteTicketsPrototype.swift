#if DEBUG
import SwiftUI

#Preview("02 · Transfer tickets", traits: .landscapeLeft) {
    TripDetailPrototypePreview {
        TripDetailTabsPrototype(data: $0, routeLayout: .tickets)
    }
}
#endif
