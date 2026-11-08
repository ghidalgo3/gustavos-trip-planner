import Foundation
import Testing
@testable import TripPlannerCore

@MainActor
@Suite("Local trips and cloud write recovery")
struct TripPersistenceTests {
    @Test func uploadUsesTheSharedDocumentShapeAndIsStableAcrossRetries() throws {
        let trip = Trip.local(name: "Japan", description: "Spring")
        let pending = PendingTripWrite(kind: .promote, accountID: UUID(), base: trip, draft: trip)
        let restored = try JSONDecoder().decode(PendingTripWrite.self, from: JSONEncoder().encode(pending))
        #expect(pending.document == restored.document)
        guard case .object(let document) = pending.document else {
            Issue.record("The document must be an object")
            return
        }
        let schemaURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("docs/schemas/trip-document-v1.schema.json")
        let schema = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: schemaURL))
        guard case .object(let schemaFields) = schema,
              case .array(let required) = schemaFields["required"] else {
            Issue.record("The pinned document schema must declare its required fields")
            return
        }
        for field in required {
            if case .string(let key) = field { #expect(document[key] != nil) }
        }
        #expect(document["sync"] == nil)
        #expect(document["assessments"] == nil)
        #expect(document["id"] == .string(trip.id.uuidString.lowercased()))
        #expect(document["schemaVersion"] == .number(1))
        #expect(document["sourceTripId"] == nil)
    }

    @Test func destinationDownloadRestoresEditingAfterFailedTripRefresh() async throws {
        let store = try SwiftDataTripStore(inMemory: true)
        let api = TestAPI(signedIn: true)
        let trip = api.cloudTrip("Japan")
        api.remote = [trip]
        let model = AppModel(api: api, store: store)
        await model.start()
        api.listFails = true
        await model.refreshTrips()
        #expect(!model.isCloudAvailable)
        _ = try await model.tripDocument(for: trip)
        #expect(model.isCloudAvailable)
        #expect(model.canEdit(trip))
        await model.networkChanged(isConnected: false)
        _ = try await model.tripDocument(for: trip)
        #expect(!model.isCloudAvailable)
    }

    @Test func firstLaunchAndRelaunchNeedNoAccount() async throws {
        let store = try SwiftDataTripStore(inMemory: true)
        let api = TestAPI()
        let model = AppModel(api: api, store: store)
        await model.start()
        #expect(model.phase == .ready)
        #expect(await model.saveTrip(existing: nil, name: "Japan", description: "Spring"))
        let reloaded = AppModel(api: api, store: store)
        await reloaded.start()
        #expect(reloaded.trips.map(\.name) == ["Japan"])
        #expect(reloaded.trips.first?.isLocal == true)
        #expect(api.accountReads == 0)
    }

    @Test func diskStoreSurvivesOpeningAnotherContainer() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("Trips.store")
        let original = Trip.local(name: "Saved locally", description: "")
        do {
            let first = try SwiftDataTripStore(url: url)
            try first.save(StoredTrip(confirmed: original))
        }
        let reopened = try SwiftDataTripStore(url: url)
        #expect(try reopened.load().first?.confirmed == original)
    }

    @Test func slowSaveDisplaysDraftButRetainsConfirmedValueAndAllowsOtherTrips() async throws {
        let store = try SwiftDataTripStore(inMemory: true)
        let api = TestAPI(signedIn: true)
        let first = api.cloudTrip("First")
        let second = api.cloudTrip("Second")
        api.remote = [first, second]
        api.pauseUpdates = true
        let model = AppModel(api: api, store: store)
        await model.start()
        #expect(await model.saveTrip(existing: first, name: "Edited", description: ""))
        await waitUntil { api.updateContinuation != nil }
        #expect(model.trips.first(where: { $0.id == first.id })?.name == "Edited")
        #expect(try store.load().first(where: { $0.confirmed.id == first.id })?.confirmed.name == "First")
        #expect(!model.canEdit(first))
        #expect(model.canEdit(second))
        #expect(!(await model.saveTrip(existing: first, name: "Overlapping", description: "")))
        api.releaseUpdate()
        await waitUntil { model.pendingWrite(for: first) == nil }
        #expect(api.updateCalls == 1)
        #expect(try store.load().first(where: { $0.confirmed.id == first.id })?.confirmed.name == "Edited")
    }

    @Test func conflictsKeepTheDraftAndNeverAutomaticallyResubmit() async throws {
        let store = try SwiftDataTripStore(inMemory: true)
        let api = TestAPI(signedIn: true)
        let trip = api.cloudTrip("Original")
        api.remote = [trip]
        api.updateError = APIError.server(status: 412, message: "Changed elsewhere")
        let model = AppModel(api: api, store: store)
        await model.start()
        #expect(await model.saveTrip(existing: trip, name: "My draft", description: "Keep this"))
        await waitUntil { model.pendingWrite(for: trip)?.status == .conflict }
        await model.refreshTrips()
        #expect(model.pendingWrite(for: trip)?.draft.name == "My draft")
        #expect(model.trips.first?.name == "Original")
        #expect(api.updateCalls == 1)
    }

    @Test func lostResponseIsReconciledWithoutRepeatingMutation() async throws {
        let store = try SwiftDataTripStore(inMemory: true)
        let api = TestAPI(signedIn: true)
        let trip = api.cloudTrip("Before")
        var draft = trip
        draft.name = "Committed"
        var pending = PendingTripWrite(kind: .update, accountID: api.accountID, base: trip, draft: draft)
        pending.status = .sending
        try store.save(StoredTrip(confirmed: trip, accountID: api.accountID, pending: pending))
        draft.etag = "\"new\""
        api.remote = [draft]
        let model = AppModel(api: api, store: store)
        await model.start()
        await waitUntil { model.pendingWrite(for: trip) == nil }
        #expect(api.updateCalls == 0)
        #expect(model.trips.first?.name == "Committed")
    }

    @Test func signInDoesNotPromoteAndSignOutPreservesLocalTrips() async throws {
        let store = try SwiftDataTripStore(inMemory: true)
        let local = Trip.local(name: "Private", description: "")
        try store.save(StoredTrip(confirmed: local))
        let api = TestAPI(signedIn: true)
        api.remote = [api.cloudTrip("Shared")]
        let model = AppModel(api: api, store: store)
        await model.start()
        #expect(model.trips.count == 2)
        #expect(api.importCalls == 0)
        model.signOut()
        #expect(model.trips == [local])
        #expect(try store.load().count == 1)
    }

    @Test func signOutDuringSlowSaveCannotRepopulateAnotherSession() async throws {
        let store = try SwiftDataTripStore(inMemory: true)
        let api = TestAPI(signedIn: true)
        let trip = api.cloudTrip("Private cloud trip")
        api.remote = [trip]
        api.pauseUpdates = true
        let model = AppModel(api: api, store: store)
        await model.start()
        #expect(await model.saveTrip(existing: trip, name: "Pending", description: ""))
        await waitUntil { api.updateContinuation != nil }
        model.signOut()
        api.releaseUpdate()
        for _ in 0..<20 { await Task.yield() }
        #expect(model.currentUser == nil)
        #expect(model.trips.isEmpty)
        #expect(try store.load().first?.pending?.status == .uncertain)
    }

    @Test func promotionDownloadFailureNeverReopensLocalEditing() async throws {
        let store = try SwiftDataTripStore(inMemory: true)
        let local = Trip.local(name: "Move me", description: "")
        try store.save(StoredTrip(confirmed: local))
        let api = TestAPI(signedIn: true)
        api.documentFails = true
        let model = AppModel(api: api, store: store)
        await model.start()
        model.moveToCloud(local)
        await waitUntil { model.pendingWrite(for: local)?.message != nil }
        #expect(model.pendingWrite(for: local)?.status == .committed)
        #expect(!model.canEdit(local))
        #expect(model.trips.first?.isLocal == false)
        api.documentFails = false
        model.retry(local)
        await waitUntil { model.pendingWrite(for: local) == nil }
        #expect(api.transferIDs.count == 1)
        #expect(model.trips.count == 1)
        #expect(model.trips.first?.id == local.id)
        #expect(try store.load().first?.document != nil)
    }

    @Test func refreshCannotOverwriteNewerSave() async throws {
        let store = try SwiftDataTripStore(inMemory: true)
        let api = TestAPI(signedIn: true)
        let trip = api.cloudTrip("Before")
        api.remote = [trip]
        let model = AppModel(api: api, store: store)
        await model.start()
        api.pauseList = true
        let refresh = Task { await model.refreshTrips() }
        await waitUntil { api.listContinuation != nil }
        #expect(await model.saveTrip(existing: trip, name: "After", description: ""))
        await waitUntil { model.pendingWrite(for: trip) == nil }
        api.listContinuation?.resume(returning: [trip])
        api.listContinuation = nil
        await refresh.value
        #expect(model.trips.first?.name == "After")
    }

    private func waitUntil(_ predicate: () -> Bool) async {
        for _ in 0..<1000 {
            if predicate() { return }
            await Task.yield()
        }
        Issue.record("The expected asynchronous state was not reached")
    }
}

@MainActor
final class TestAPI: TripPlannerServing {
    let accountID = UUID()
    var signedIn: Bool
    var remote: [Trip] = []
    var accountReads = 0
    var updateCalls = 0
    var importCalls = 0
    var transferIDs: Set<UUID> = []
    var updateError: (any Error)?
    var pauseUpdates = false
    var pauseList = false
    var listFails = false
    var documentFails = false
    var updateContinuation: CheckedContinuation<Void, Never>?
    var listContinuation: CheckedContinuation<[Trip], Never>?

    init(signedIn: Bool = false) { self.signedIn = signedIn }
    func restoreSession() throws -> Bool { signedIn }
    func makeAuthorizationAttempt(provider: IdentityProvider) throws -> AuthorizationAttempt { throw APIError.unauthorized }
    func finishAuthorization(callbackURL: URL, attempt: AuthorizationAttempt) async throws { signedIn = true }
    func currentUser() async throws -> CurrentUser {
        accountReads += 1
        return CurrentUser(isAuthenticated: true, id: accountID, name: "Test", email: nil, provider: nil,
                           completedOnboarding: false, profile: UserProfile(homeCity: nil, preferredAirlines: [], preferredAirport: nil))
    }
    func trips() async throws -> [Trip] {
        if listFails { throw URLError(.networkConnectionLost) }
        if pauseList { return await withCheckedContinuation { listContinuation = $0 } }
        return remote
    }
    func trip(id: UUID) async throws -> Trip {
        guard let trip = remote.first(where: { $0.id == id }) else { throw APIError.server(status: 404, message: nil) }
        return trip
    }
    func document(id: UUID) async throws -> Data {
        if documentFails { throw URLError(.networkConnectionLost) }
        return Data("{}".utf8)
    }
    func importTrip(_ write: PendingTripWrite) async throws -> Trip {
        importCalls += 1
        transferIDs.insert(write.id)
        if let existing = remote.first(where: { $0.id == write.base.id }) { return existing }
        let saved = Trip(id: write.base.id, ownerUserId: accountID, canPlan: true, name: write.draft.name,
                         description: write.draft.description, constraints: write.draft.constraints,
                         createdAt: Date(), updatedAt: Date(), etag: "\"imported\"")
        remote.append(saved)
        return saved
    }
    func updateTrip(_ trip: Trip, name: String, description: String) async throws -> Trip {
        updateCalls += 1
        if pauseUpdates { await withCheckedContinuation { updateContinuation = $0 } }
        if let updateError { throw updateError }
        var saved = trip
        saved.name = name
        saved.description = description
        saved.etag = "\"updated\""
        saved.updatedAt = Date()
        remote.removeAll { $0.id == trip.id }
        remote.append(saved)
        return saved
    }
    func releaseUpdate() { updateContinuation?.resume(); updateContinuation = nil }
    func deleteTrip(_ trip: Trip) async throws { remote.removeAll { $0.id == trip.id } }
    func signOut() throws { signedIn = false }
    func cloudTrip(_ name: String) -> Trip {
        Trip(id: UUID(), ownerUserId: accountID, canPlan: true, name: name, description: "",
             constraints: .object([:]), createdAt: Date(), updatedAt: Date(), etag: "\"original\"")
    }
}
