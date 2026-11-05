#if DEBUG
import SwiftUI

#Preview("03 · Inline mode comparison", traits: .landscapeLeft) {
    TripDetailPrototypePreview {
        TripDetailTabsPrototype(data: $0, routeLayout: .compare)
    }
}
#endif
