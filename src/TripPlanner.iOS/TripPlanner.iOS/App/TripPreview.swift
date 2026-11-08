import SwiftUI

/// Every preview uses an isolated store and a network-free API.
struct TripPreview<Content: View>: View {
    @State private var selection = "Local trips"
    @State private var dependencies: AppDependencies?
    @State private var isShowingStateSheet = false
    private let usesStateSheet: Bool
    @ViewBuilder private let content: (AppModel, Binding<Bool>) -> Content

    init(@ViewBuilder content: @escaping (AppModel) -> Content) {
        usesStateSheet = false
        self.content = { model, _ in content(model) }
    }

    init(@ViewBuilder content: @escaping (AppModel, Binding<Bool>) -> Content) {
        usesStateSheet = true
        self.content = content
    }

    var body: some View {
        if usesStateSheet {
            previewContent
                .task { load() }
                .onChange(of: selection) { load() }
                .sheet(isPresented: $isShowingStateSheet) {
                    NavigationStack {
                        Form {
                            previewStatePicker
                            Button("Reload data") { load() }
                                .buttonStyle(.bordered)
                        }
                        .navigationTitle("Preview state")
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("Done") { isShowingStateSheet = false }
                                    .buttonStyle(.bordered)
                            }
                        }
                    }
                }
        } else {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Preview state").font(.headline)
                    previewStatePicker
                    Button("Reload data") { load() }.buttonStyle(.bordered)
                }
                .padding()
                .frame(width: 180)
                Divider()
                previewContent
            }
            .task { load() }
            .onChange(of: selection) { load() }
        }
    }

    @ViewBuilder
    private var previewContent: some View {
        if let dependencies {
            content(dependencies.model, $isShowingStateSheet)
                .environment(dependencies)
        } else {
            Text("Preparing preview")
        }
    }

    private var previewStatePicker: some View {
        Picker("State", selection: $selection) {
            Text("Local trips").tag("Local trips")
            Text("Empty").tag("Empty")
            Text("Cloud offline").tag("Cloud offline")
            Text("Conflict").tag("Conflict")
        }
        .pickerStyle(.inline)
    }

    private func load() {
        do {
            let store = try SwiftDataTripStore(inMemory: true)
            let api = PreviewTripAPI()
            if selection != "Empty" {
                let samples = [
                    Trip.local(name: "Japan in spring", description: "Tokyo, Kyoto, and a few quiet days."),
                    Trip.local(name: "Lisbon weekend", description: "Coffee, tiled streets, and an afternoon in Belém."),
                    Trip.local(name: "Summer along the Italian coast", description: "A slow journey from Naples to the Amalfi Coast, with time for swimming and exploring small towns."),
                    Trip.local(name: "New York", description: ""),
                    Trip.local(name: "Iceland road trip", description: "Waterfalls, hot springs, and the south coast.")
                ]
                for (index, sample) in samples.enumerated() {
                    var trip = sample
                    var record = StoredTrip(confirmed: trip)
                    if selection == "Cloud offline" || selection == "Conflict" {
                        let ownerID = index == 1 ? UUID(uuidString: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE") : api.user.id
                        trip = Trip(id: trip.id, ownerUserId: ownerID, canPlan: true, name: trip.name,
                                    description: trip.description, constraints: trip.constraints,
                                    createdAt: trip.createdAt, updatedAt: trip.updatedAt, etag: "\"preview\"")
                        record = StoredTrip(confirmed: trip, accountID: api.user.id)
                        try store.saveAccount(api.user)
                        api.hasSession = true
                        if selection == "Conflict", index == 0, let accountID = api.user.id {
                            var draft = trip
                            draft.name = "My revised Japan trip"
                            var pending = PendingTripWrite(kind: .update, accountID: accountID, base: trip, draft: draft)
                            pending.status = .conflict
                            pending.message = "This trip changed elsewhere."
                            record.pending = pending
                        }
                    }
                    try store.save(record)
                }
            }
            let next = AppDependencies(api: api, store: store)
            dependencies = next
            Task { await next.model.start() }
        } catch { dependencies = nil }
    }
}

@MainActor
final class PreviewTripAPI: TripPlannerServing {
    var hasSession = false
    let user = CurrentUser(
        isAuthenticated: true, id: UUID(), name: "Preview traveler", email: nil, provider: nil,
        completedOnboarding: false, profile: UserProfile(homeCity: nil, preferredAirlines: [], preferredAirport: nil)
    )
    func restoreSession() throws -> Bool { hasSession }
    func makeAuthorizationAttempt(provider: IdentityProvider) throws -> AuthorizationAttempt { throw APIError.unauthorized }
    func finishAuthorization(callbackURL: URL, attempt: AuthorizationAttempt) async throws { throw APIError.unauthorized }
    func currentUser() async throws -> CurrentUser { throw URLError(.notConnectedToInternet) }
    func trips() async throws -> [Trip] { [] }
    func trip(id: UUID) async throws -> Trip { throw APIError.unauthorized }
    func document(id: UUID) async throws -> Data { throw APIError.unauthorized }
    func importTrip(_ write: PendingTripWrite) async throws -> Trip { throw APIError.unauthorized }
    func updateTrip(_ trip: Trip, name: String, description: String) async throws -> Trip { throw APIError.unauthorized }
    func deleteTrip(_ trip: Trip) async throws { throw APIError.unauthorized }
    func signOut() throws { hasSession = false }
}

#Preview("Preview controls") {
    TripPreview { TripListView(model: $0) }
}
