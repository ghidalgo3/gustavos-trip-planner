#if DEBUG
import SwiftUI

#Preview("05 · Route with transport inspector", traits: .landscapeLeft) {
    TripDetailPrototypePreview {
        TripDetailTabsPrototype(data: $0, routeLayout: .inspector)
    }
}
#endif
