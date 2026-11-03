// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "TripPlannerCore",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [.library(name: "TripPlannerCore", targets: ["TripPlannerCore"])],
    targets: [
        .target(
            name: "TripPlannerCore",
            path: "TripPlanner.iOS",
            exclude: [
                "Assets.xcassets", "ContentView.swift", "MyApp.swift",
                "App/AppRootView.swift", "App/TripPreview.swift", "App/Trips",
                "App/Authentication/SignInView.swift"
            ],
            sources: [
                "App/AppModel.swift", "App/TripStore.swift", "App/Models",
                "App/Networking", "App/Authentication/KeychainTokenStore.swift",
                "App/Authentication/OAuthClient.swift"
            ],
            swiftSettings: [.defaultIsolation(MainActor.self)]
        ),
        .testTarget(
            name: "TripPlannerCoreTests",
            dependencies: ["TripPlannerCore"],
            path: "Tests",
            swiftSettings: [.defaultIsolation(MainActor.self)]
        )
    ],
    swiftLanguageModes: [.v5]
)
