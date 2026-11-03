import SwiftUI

@main
struct TripPlannerApp: App {
    @State private var dependencies = AppDependencies()

    var body: some Scene {
        WindowGroup {
            ContentView(model: dependencies.model)
                .environment(dependencies)
        }
    }
}
