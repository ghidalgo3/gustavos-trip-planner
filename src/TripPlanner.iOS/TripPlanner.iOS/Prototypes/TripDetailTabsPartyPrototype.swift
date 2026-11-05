#if DEBUG
import SwiftUI

#Preview("02 · Tabs with Add people toolbar", traits: .landscapeLeft) {
    TripDetailPrototypePreview {
        TripDetailTabsPrototype(data: $0, showsPartyToolbar: true)
    }
}
#endif
