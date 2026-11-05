import Foundation
import Observation

@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable { case launching, ready, storageFailed }

    private let api: any TripPlannerServing
    private var store: (any TripStoring)?
    private var records: [StoredTrip] = []
    private let resources: ResourceStore
    private var workers: [UUID: Task<Void, Never>] = [:]
    private var generation = 0
    private var mutationRevision = 0
    private var started = false
    private(set) var hasNetworkPath = true

    private(set) var phase = Phase.launching
    private(set) var currentUser: CurrentUser?
    private(set) var trips: [Trip] = []
    private(set) var errorMessage: String?
    private(set) var authorizationAttempt: AuthorizationAttempt?
    private(set) var isCloudAvailable = false
    private(set) var isRefreshing = false
    var showingSignIn = false

    init(api: (any TripPlannerServing)? = nil, store: (any TripStoring)? = nil, resources: ResourceStore? = nil) {
        self.api = api ?? TripPlannerAPI()
        self.store = store
        self.resources = resources ?? ResourceStore()
    }

    func start() async {
        guard !started else { return }
        started = true
        do {
            if store == nil { store = try SwiftDataTripStore() }
            records = try requireStore().load()
            // A terminated process cannot establish whether an in-flight request committed.
            for index in records.indices where records[index].pending?.status == .sending {
                records[index].pending?.status = .uncertain
            }
            try requireStore().replace(records)
            if try api.restoreSession() {
                currentUser = try requireStore().loadAccount()
            }
            publish()
            phase = .ready
        } catch {
            errorMessage = error.localizedDescription
            phase = .storageFailed
            started = false
            return
        }
        await refreshTrips()
    }

    func beginSignIn(provider: IdentityProvider) async throws -> URL {
        errorMessage = nil
        let attempt = try api.makeAuthorizationAttempt(provider: provider)
        authorizationAttempt = attempt
        return attempt.authorizationURL
    }

    func completeSignIn(callbackURL: URL) async {
        guard let attempt = authorizationAttempt else { return }
        let ticket = generation
        do {
            try await api.finishAuthorization(callbackURL: callbackURL, attempt: attempt)
            guard ticket == generation else { return }
            authorizationAttempt = nil
            await refreshTrips()
            if isCloudAvailable { showingSignIn = false }
        } catch {
            guard ticket == generation else { return }
            authorizationAttempt = nil
            errorMessage = error.localizedDescription
        }
    }

    func cancelSignIn(with error: any Error) {
        authorizationAttempt = nil
        let nsError = error as NSError
        if nsError.domain != "com.apple.AuthenticationServices.WebAuthenticationSession" || nsError.code != 1 {
            errorMessage = error.localizedDescription
        }
    }

    func networkChanged(isConnected: Bool) async {
        hasNetworkPath = isConnected
        if !isConnected {
            isCloudAvailable = false
        } else {
            await refreshTrips()
        }
    }

    func refreshTrips() async {
        guard phase == .ready, !isRefreshing, hasNetworkPath else { return }
        isRefreshing = true
        let readRevision = mutationRevision
        defer { isRefreshing = false }
        let ticket = generation
        do {
            guard try api.restoreSession() else { return }
            let user = try await api.currentUser()
            guard ticket == generation else { return }
            guard user.isAuthenticated, let accountID = user.id else {
                isCloudAvailable = false
                return
            }
            try requireStore().saveAccount(user)
            currentUser = user
            publish()
            let remote = try await api.trips()
            guard ticket == generation, readRevision == mutationRevision else { return }
            // A read started before a save must never overwrite the save's result.
            var merged = records.filter { record in
                record.accountID != accountID || record.pending != nil || remote.contains(where: { $0.id == record.confirmed.id })
            }
            for trip in remote {
                // Promotion owns this ID until its atomic local handoff completes.
                if merged.contains(where: { $0.confirmed.id == trip.id && $0.pending?.kind == .promote }) { continue }
                if let index = merged.firstIndex(where: { $0.accountID == accountID && $0.confirmed.id == trip.id }) {
                    if merged[index].pending == nil { merged[index].confirmed = trip }
                } else {
                    merged.append(StoredTrip(confirmed: trip, accountID: accountID))
                }
            }
            try requireStore().replace(merged)
            records = merged
            isCloudAvailable = hasNetworkPath
            errorMessage = nil
            publish()
            for record in records {
                guard let pending = record.pending, pending.accountID == accountID,
                      [.queued, .sending, .uncertain, .committed].contains(pending.status) else { continue }
                launch(record.confirmed.id)
            }
        } catch {
            guard ticket == generation else { return }
            isCloudAvailable = false
            errorMessage = "Cloud trips could not refresh. Local trips remain available. \(error.localizedDescription)"
        }
    }

    func pendingWrite(for trip: Trip) -> PendingTripWrite? {
        record(for: trip.id)?.pending
    }

    func tripDocument(for trip: Trip, allowCached: Bool = true) async throws -> Data {
        if trip.isLocal {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            return try encoder.encode(trip)
        }

        let ticket = generation
        do {
            guard hasNetworkPath else { throw URLError(.notConnectedToInternet) }
            let snapshot = try await api.snapshot(id: trip.id)
            try Task.checkCancellation()
            guard ticket == generation, var value = record(for: trip.id) else {
                throw CancellationError()
            }
            isCloudAvailable = hasNetworkPath
            value.snapshot = snapshot
            try? requireStore().save(value)
            if let index = records.firstIndex(where: { $0.key == value.key }) {
                records[index].snapshot = snapshot
            }
            return snapshot
        } catch {
            try Task.checkCancellation()
            guard ticket == generation, let value = record(for: trip.id) else {
                throw CancellationError()
            }
            if allowCached, let urlError = error as? URLError,
               urlError.code == .notConnectedToInternet,
               let cached = value.snapshot {
                return cached
            }
            throw error
        }
    }

    func canEdit(_ trip: Trip) -> Bool {
        guard pendingWrite(for: trip) == nil else { return false }
        return trip.isLocal || (isCloudAvailable && trip.canPlan && trip.etag != nil)
    }

    func saveTrip(existing: Trip?, name: String, description: String) async -> Bool {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 200, description.count <= 4000 else {
            errorMessage = "Enter a name of up to 200 characters and a description of up to 4,000 characters."
            return false
        }
        do {
            guard let existing else {
                let value = StoredTrip(confirmed: .local(name: trimmed, description: description))
                try persist(value)
                return true
            }
            guard var value = record(for: existing.id), canEdit(existing) else { return false }
            guard value.confirmed.etag == existing.etag, value.confirmed.updatedAt == existing.updatedAt else {
                errorMessage = "This trip changed while you were editing. Close and reopen the editor; keep your draft for reference."
                return false
            }
            var draft = value.confirmed
            draft.name = trimmed
            draft.description = description
            if existing.isLocal {
                draft.updatedAt = Date()
                value.confirmed = draft
            } else {
                guard let accountID = currentUser?.id else { return false }
                value.pending = PendingTripWrite(kind: .update, accountID: accountID, base: value.confirmed, draft: draft)
            }
            try persist(value)
            if value.pending != nil { launch(existing.id) }
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func deleteTrip(_ trip: Trip) async {
        guard var value = record(for: trip.id), canEdit(trip) else { return }
        do {
            if trip.isLocal {
                try remove(value)
            } else if let accountID = currentUser?.id, trip.ownerUserId == accountID {
                value.pending = PendingTripWrite(kind: .delete, accountID: accountID, base: value.confirmed, draft: value.confirmed)
                try persist(value)
                launch(trip.id)
            }
        } catch { errorMessage = error.localizedDescription }
    }

    func moveToCloud(_ trip: Trip) {
        guard trip.isLocal, var value = record(for: trip.id), value.pending == nil else { return }
        guard isCloudAvailable, let accountID = currentUser?.id else {
            showingSignIn = true
            return
        }
        do {
            value.pending = PendingTripWrite(kind: .promote, accountID: accountID, base: value.confirmed, draft: value.confirmed)
            try persist(value)
            launch(trip.id)
        } catch { errorMessage = error.localizedDescription }
    }

    func retry(_ trip: Trip) {
        guard isCloudAvailable, let pending = pendingWrite(for: trip),
              pending.accountID == currentUser?.id, pending.status != .conflict else { return }
        launch(trip.id)
    }

    /// Explicitly discard only definitively failed writes; uncertain requests must be reconciled.
    func discardFailedWrite(_ trip: Trip) {
        guard var value = record(for: trip.id), let pending = value.pending,
              pending.status == .failed || pending.status == .conflict else { return }
        guard !(pending.kind == .promote && pending.status == .conflict) else { return }
        value.pending = nil
        do { try persist(value) } catch { errorMessage = error.localizedDescription }
    }

    func refreshConflict(_ trip: Trip) async {
        guard var value = record(for: trip.id), value.pending?.status == .conflict,
              value.pending?.accountID == currentUser?.id else { return }
        let ticket = generation
        do {
            let fresh = try await api.trip(id: trip.id)
            guard ticket == generation else { return }
            value.confirmed = fresh
            try persist(value)
            // The draft deliberately remains available; it is never automatically rebased.
        } catch { errorMessage = error.localizedDescription }
    }

    func signOut() {
        resources.reset()
        generation += 1
        for task in workers.values { task.cancel() }
        workers.removeAll()
        do {
            try api.signOut()
            try requireStore().saveAccount(nil)
            // Keep journals for unresolved writes, hidden from other accounts. They are not editable caches.
            records = records.filter { $0.accountID == nil || $0.pending != nil }
            for index in records.indices {
                records[index].snapshot = nil
                if records[index].pending?.status == .sending { records[index].pending?.status = .uncertain }
            }
            try requireStore().replace(records)
            currentUser = nil
            isCloudAvailable = false
            authorizationAttempt = nil
            publish()
        } catch {
            currentUser = nil
            isCloudAvailable = false
            publish()
            errorMessage = error.localizedDescription
        }
    }

    private func launch(_ id: UUID) {
        guard workers[id] == nil else { return }
        let ticket = generation
        workers[id] = Task {
            await process(id, ticket: ticket)
            if ticket == generation { workers[id] = nil }
        }
    }

    private func process(_ id: UUID, ticket: Int) async {
        guard var value = record(for: id), var pending = value.pending,
              pending.accountID == currentUser?.id, isCloudAvailable else { return }
        let wasUncertain = pending.status == .uncertain || pending.status == .sending
        let wasCommitted = pending.status == .committed
        pending.status = wasCommitted ? .committed : .sending
        pending.message = nil
        value.pending = pending
        do {
            try persist(value)
            if pending.kind == .promote {
                // The server's PUT is idempotent. Always reuse the journal's immutable payload/ID.
                let saved = try await api.importTrip(pending)
                guard ticket == generation else { return }
                value.confirmed = saved
                value.pending?.status = .committed
                try persist(value)
                let snapshot = try await api.snapshot(id: saved.id)
                guard ticket == generation else { return }
                value.snapshot = snapshot
                value.accountID = pending.accountID
                value.pending = nil
                var next = records.filter { $0.confirmed.id != id }
                next.append(value)
                try requireStore().replace(next)
                records = next
                publish()
                return
            }

            if wasUncertain {
                do {
                    let fresh = try await api.trip(id: id)
                    guard ticket == generation else { return }
                    if pending.kind == .update && fresh.hasSameContent(as: pending.draft) {
                        value.confirmed = fresh
                        value.pending = nil
                        try persist(value)
                        return
                    }
                    guard fresh.etag == pending.base.etag else {
                        value.confirmed = fresh
                        value.pending?.status = .conflict
                        value.pending?.message = "This trip changed elsewhere. Review your draft before saving again."
                        try persist(value)
                        return
                    }
                } catch APIError.server(let status, _) where status == 404 && pending.kind == .delete {
                    guard ticket == generation else { return }
                    try remove(value)
                    return
                }
            }

            if pending.kind == .delete {
                try await api.deleteTrip(pending.base)
                guard ticket == generation else { return }
                try remove(value)
            } else {
                let saved = try await api.updateTrip(
                    pending.base, name: pending.draft.name, description: pending.draft.description
                )
                guard ticket == generation else { return }
                value.confirmed = saved
                value.pending = nil
                try persist(value)
            }
        } catch {
            guard ticket == generation else { return }
            // Read the durable status: a successful import cannot become a failed local trip.
            guard var current = record(for: id), current.pending != nil else { return }
            if current.pending?.status == .committed {
                current.pending?.message = "Moved to cloud. Download needs retry: \(error.localizedDescription)"
            } else if case APIError.server(let status, _) = error, (400..<500).contains(status),
                      status != 408 && status != 429 {
                current.pending?.status = status == 409 || status == 412 || (status == 410 && pending.kind == .promote) ? .conflict : .failed
                current.pending?.message = error.localizedDescription
                if status == 401 || status == 403 { isCloudAvailable = false }
            } else {
                current.pending?.status = .uncertain
                current.pending?.message = "The save could not be confirmed. Retry checks the server before sending again."
                if error is URLError { isCloudAvailable = false }
            }
            do { try persist(current) } catch { errorMessage = error.localizedDescription }
        }
    }

    private func record(for id: UUID) -> StoredTrip? {
        records.first { $0.confirmed.id == id && isVisible($0) }
    }

    private func requireStore() throws -> any TripStoring {
        guard let store else { throw APIError.invalidResponse }
        return store
    }

    private func persist(_ value: StoredTrip) throws {
        try requireStore().save(value)
        mutationRevision += 1
        records.removeAll { $0.key == value.key }
        records.append(value)
        publish()
    }

    private func remove(_ value: StoredTrip) throws {
        try requireStore().remove(key: value.key)
        mutationRevision += 1
        records.removeAll { $0.key == value.key }
        publish()
    }

    private func isVisible(_ record: StoredTrip) -> Bool {
        if record.accountID == nil && record.confirmed.isLocal { return true }
        guard let accountID = currentUser?.id else { return false }
        return record.accountID == accountID ||
            (record.accountID == nil && record.pending?.accountID == accountID)
    }

    private func publish() {
        trips = records.filter(isVisible).map(\.displayed).sorted { $0.updatedAt > $1.updatedAt }
    }
}
