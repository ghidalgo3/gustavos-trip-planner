import SwiftUI

struct ContentView: View {
    let model: AppModel

    var body: some View {
        AppRootView(model: model)
    }
}

#Preview("Application") {
    TripPreview { ContentView(model: $0) }
}
