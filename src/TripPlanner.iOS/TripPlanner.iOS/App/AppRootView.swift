import SwiftUI
import Network

struct AppRootView: View {
    @Bindable var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            switch model.phase {
            case .launching:
                ScrollView {
                    VStack(spacing: 16) {
                        ForEach(0..<3) { _ in
                            VStack(alignment: .leading, spacing: 14) {
                                Image(systemName: "suitcase.rolling")
                                    .font(.title2)
                                    .frame(width: 48, height: 48)
                                    .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 14))
                                VStack(alignment: .leading, spacing: 6) {
                                    Text("A trip to remember").font(.title2.weight(.semibold))
                                    Text("Destinations and plans").font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(20)
                            .background(.background, in: RoundedRectangle(cornerRadius: 20))
                            .overlay {
                                RoundedRectangle(cornerRadius: 20)
                                    .strokeBorder(Color.primary.opacity(0.08))
                            }
                            .redacted(reason: .placeholder)
                        }
                    }
                    .frame(maxWidth: 680)
                    .padding(20)
                    .frame(maxWidth: .infinity)
                }
                .background(Color(.systemGroupedBackground))
                .navigationTitle("Trips")
                .accessibilityLabel("Loading saved trips")
            case .storageFailed:
                ContentUnavailableView {
                    Label("Could not open saved trips", systemImage: "externaldrive.badge.exclamationmark")
                } description: {
                    Text(model.errorMessage ?? "Your saved trips have not been changed.")
                } actions: {
                    Button("Try again") { Task { await model.start() } }
                        .buttonStyle(.borderedProminent)
                }
            case .ready:
                TripListView(model: model)
            }
        }
        .task { await model.start() }
        .task {
            for await path in NWPathMonitor() {
                await model.networkChanged(isConnected: path.status == .satisfied)
            }
        }
        .task(id: scenePhase) {
            if scenePhase == .active { await model.refreshTrips() }
        }
        .sheet(isPresented: $model.showingSignIn) { SignInView(model: model) }
    }
}

#Preview("Application states") {
    TripPreview { AppRootView(model: $0) }
}
