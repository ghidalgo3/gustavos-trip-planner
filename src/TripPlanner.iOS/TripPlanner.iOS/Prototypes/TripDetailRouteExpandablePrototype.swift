#if DEBUG
import SwiftUI

#Preview("04 · Expandable legs", traits: .landscapeLeft) {
    TripDetailPrototypePreview {
        TripDetailTabsPrototype(data: $0, routeLayout: .expandable)
    }
}
#endif
