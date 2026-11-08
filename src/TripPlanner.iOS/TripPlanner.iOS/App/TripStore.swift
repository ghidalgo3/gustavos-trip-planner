import Foundation
import SwiftData

enum TripStoreSchema: VersionedSchema {
    static var versionIdentifier: Schema.Version { Schema.Version(1, 0, 0) }
    static var models: [any PersistentModel.Type] { [Record.self] }

    @Model
    final class Record {
        @Attribute(.unique) var key: String
        var payload: Data

        init(key: String, payload: Data) {
            self.key = key
            self.payload = payload
        }
    }
}

enum TripStoreMigration: SchemaMigrationPlan {
    static var schemas: [any VersionedSchema.Type] { [TripStoreSchema.self] }
    static var stages: [MigrationStage] { [] }
}

/// The confirmed value and pending edit are separate, so refreshing never destroys a draft.
struct StoredTrip: Codable, Equatable {
    var confirmed: Trip
    var accountID: UUID?
    var pending: PendingTripWrite?
    var document: Data?

    var displayed: Trip {
        guard let pending, pending.kind == .update,
              pending.status == .sending || pending.status == .queued || pending.status == .uncertain else {
            return confirmed
        }
        return pending.draft
    }

    var key: String { "\(accountID?.uuidString ?? "device")/\(confirmed.id.uuidString)" }
}

struct PendingTripWrite: Codable, Equatable, Identifiable {
    enum Kind: String, Codable { case update, delete, promote }
    enum Status: String, Codable {
        case queued, sending, uncertain, failed, conflict, committed
    }

    var id: UUID = UUID()
    let kind: Kind
    let accountID: UUID
    let base: Trip
    let draft: Trip
    var status: Status = .queued
    var message: String?
}

@MainActor
protocol TripStoring {
    func load() throws -> [StoredTrip]
    func save(_ trip: StoredTrip) throws
    func remove(key: String) throws
    func replace(_ trips: [StoredTrip]) throws
    func loadAccount() throws -> CurrentUser?
    func saveAccount(_ user: CurrentUser?) throws
}

/// Explicit saves are atomic; autosave must never persist a half-finished handoff.
@MainActor
final class SwiftDataTripStore: TripStoring {
    private let container: ModelContainer
    private let context: ModelContext

    init(inMemory: Bool = false, url: URL? = nil) throws {
        let schema = Schema(TripStoreSchema.models)
        let configuration: ModelConfiguration
        if let url {
            configuration = ModelConfiguration("Trips", schema: schema, url: url, cloudKitDatabase: .none)
        } else {
            configuration = ModelConfiguration(
                "Trips", schema: schema, isStoredInMemoryOnly: inMemory, cloudKitDatabase: .none
            )
        }
        container = try ModelContainer(
            for: schema, migrationPlan: TripStoreMigration.self, configurations: [configuration]
        )
        context = ModelContext(container)
        context.autosaveEnabled = false
    }

    func load() throws -> [StoredTrip] {
        try records().filter { $0.key != "account" }.map {
            try JSONDecoder().decode(StoredTrip.self, from: $0.payload)
        }
    }

    func save(_ trip: StoredTrip) throws {
        try commit { try put(key: trip.key, payload: JSONEncoder().encode(trip)) }
    }

    func remove(key: String) throws {
        try commit {
            for record in try records() where record.key == key { context.delete(record) }
        }
    }

    func replace(_ trips: [StoredTrip]) throws {
        try commit {
            let keys = Set(trips.map(\.key))
            for record in try records() where record.key != "account" && !keys.contains(record.key) {
                context.delete(record)
            }
            for trip in trips {
                try put(key: trip.key, payload: JSONEncoder().encode(trip))
            }
        }
    }

    func loadAccount() throws -> CurrentUser? {
        guard let record = try records().first(where: { $0.key == "account" }) else { return nil }
        return try JSONDecoder().decode(CurrentUser.self, from: record.payload)
    }

    func saveAccount(_ user: CurrentUser?) throws {
        if let user {
            try commit { try put(key: "account", payload: JSONEncoder().encode(user)) }
        } else {
            try remove(key: "account")
        }
    }

    private func records() throws -> [TripStoreSchema.Record] {
        try context.fetch(FetchDescriptor<TripStoreSchema.Record>())
    }

    private func put(key: String, payload: Data) throws {
        if let record = try records().first(where: { $0.key == key }) {
            record.payload = payload
        } else {
            context.insert(TripStoreSchema.Record(key: key, payload: payload))
        }
    }

    private func commit(_ change: () throws -> Void) throws {
        do {
            try change()
            try context.save()
        } catch {
            context.rollback()
            throw error
        }
    }
}
