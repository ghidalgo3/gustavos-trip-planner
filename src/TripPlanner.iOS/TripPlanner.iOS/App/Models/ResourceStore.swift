import Foundation
import Observation

struct ResourceVersion: Codable, Equatable {
    let etag: String
    let data: JSONValue
}

struct ResourceKey<Value, Draft>: Hashable {
    let path: String
}

@MainActor
private protocol ResourceEntry: AnyObject {
    func invalidate()
}

/// App-lifetime ownership, independent of any feature or view hierarchy.
@MainActor
final class ResourceStore {
    private var entries: [String: any ResourceEntry] = [:]

    func state<Value, Draft>(
        for key: ResourceKey<Value, Draft>,
        applying: @escaping (Value, Draft) -> Value
    ) -> ResourceState<Value, Draft> {
        if let entry = entries[key.path] {
            guard let typed = entry as? ResourceState<Value, Draft> else {
                preconditionFailure("A resource path must have one consistent value and draft type")
            }
            return typed
        }
        let state = ResourceState(applying: applying)
        entries[key.path] = state
        return state
    }

    func reset() {
        for entry in entries.values { entry.invalidate() }
        entries.removeAll()
    }
}

@MainActor
@Observable
final class ResourceState<Value, Draft>: ResourceEntry {
    private(set) var confirmed: Value?
    private(set) var draft: Draft?
    private(set) var isSaving = false
    private(set) var needsRefresh = false
    private let applying: (Value, Draft) -> Value
    private var task: Task<Void, Never>?
    private var generation = 0
    private var invalidated = false

    init(applying: @escaping (Value, Draft) -> Value) { self.applying = applying }

    var displayed: Value? {
        guard let confirmed else { return nil }
        return draft.map { applying(confirmed, $0) } ?? confirmed
    }

    func acceptRefresh(_ value: Value) {
        guard !isSaving, !invalidated else { return }
        confirmed = value
        draft = nil
        needsRefresh = false
    }

    func submit(_ draft: Draft, operation: @escaping @MainActor () async throws -> Value) {
        guard !isSaving, !needsRefresh, !invalidated else { return }
        self.draft = draft
        isSaving = true
        let ticket = generation
        task = Task {
            do {
                let saved = try await operation()
                guard ticket == generation else { return }
                confirmed = saved
                self.draft = nil
            } catch {
                guard ticket == generation else { return }
                needsRefresh = true
            }
            isSaving = false
            task = nil
        }
    }

    fileprivate func invalidate() {
        generation += 1
        invalidated = true
        task?.cancel()
        task = nil
        confirmed = nil
        draft = nil
        isSaving = false
        needsRefresh = false
    }
}
