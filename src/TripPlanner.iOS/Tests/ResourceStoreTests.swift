import Foundation
import Testing
@testable import TripPlannerCore

@MainActor
struct ResourceStoreTests {
    private func applyDestination(_ values: [Destination], _ draft: Destination) -> [Destination] {
        var updated = values
        if let stayID = draft.stayID, let index = updated.firstIndex(where: { $0.stayID == stayID }) {
            updated[index] = draft
        } else { updated.append(draft) }
        return updated
    }

    @Test func independentResourceTypesShareOneStoreAndSurviveFeatureRecreation() {
        let store = ResourceStore()
        let nameKey = ResourceKey<String, String>(path: "/trip/name")
        let countKey = ResourceKey<Int, Int>(path: "/trip/travellers")
        let name = store.state(for: nameKey, applying: { _, draft in draft })
        let count = store.state(for: countKey, applying: +)
        name.acceptRefresh("Japan")
        count.acceptRefresh(3)
        #expect(store.state(for: nameKey, applying: { _, draft in draft }) === name)
        #expect(name.displayed == "Japan")
        #expect(count.displayed == 3)
    }

    @Test func resetRejectsLateCompletionsAndClearsExistingReferences() async {
        let store = ResourceStore()
        let key = ResourceKey<String, String>(path: "/trip/name")
        let state = store.state(for: key, applying: { _, draft in draft })
        state.acceptRefresh("Original")
        var finish: CheckedContinuation<String, Never>?
        state.submit("Draft") { await withCheckedContinuation { finish = $0 } }
        for _ in 0..<100 where finish == nil { await Task.yield() }
        store.reset()
        let replacement = store.state(for: key, applying: { _, draft in draft })
        #expect(replacement !== state)
        replacement.acceptRefresh("New account")
        finish?.resume(returning: "Old account response")
        for _ in 0..<100 { await Task.yield() }
        #expect(state.confirmed == nil)
        #expect(state.draft == nil)
        #expect(!state.isSaving)
        #expect(replacement.confirmed == "New account")
        state.acceptRefresh("Stale read")
        #expect(state.confirmed == nil)
    }

    @Test func saveShowsDraftImmediatelyAndCommitsOnlyAfterSuccess() async {
        let state = ResourceState<[Destination], Destination>(applying: applyDestination)
        let stayID = UUID()
        let original = Destination(title: "Tokyo", subtitle: "", cityID: "tokyo", stayID: stayID)
        let draft = Destination(title: "Kyoto", subtitle: "", cityID: "tokyo", stayID: stayID)
        state.acceptRefresh([original])
        var finish: CheckedContinuation<[Destination], Never>?
        state.submit(draft) {
            await withCheckedContinuation { finish = $0 }
        }
        #expect(state.displayed == [draft])
        #expect(state.confirmed == [original])
        #expect(state.isSaving)
        // Neither a refresh nor another write can overwrite an in-flight draft.
        state.acceptRefresh([])
        state.submit(original) { Issue.record("Overlapping write"); return [] }
        #expect(state.displayed == [draft])
        for _ in 0..<100 where finish == nil { await Task.yield() }
        finish?.resume(returning: [draft])
        for _ in 0..<100 where state.isSaving { await Task.yield() }
        #expect(!state.isSaving)
        #expect(state.confirmed == [draft])
        #expect(state.draft == nil)
    }

    @Test(arguments: [false, true])
    func failedSaveRequiresRefreshAndDoesNotCommitDraft(creating: Bool) async {
        let state = ResourceState<[Destination], Destination>(applying: applyDestination)
        let original = Destination(title: "Tokyo", subtitle: "", cityID: "tokyo", stayID: UUID())
        let draft = Destination(title: "Kyoto", subtitle: "", cityID: creating ? nil : original.cityID,
                                stayID: creating ? nil : original.stayID)
        state.acceptRefresh([original])
        state.submit(draft) { throw APIError.server(status: 412, message: "Changed") }
        for _ in 0..<100 where state.isSaving { await Task.yield() }
        #expect(state.needsRefresh)
        #expect(state.confirmed == [original])
        #expect(state.displayed?.contains(draft) == true)
        state.submit(draft) { Issue.record("Must refresh before another write"); return [] }
        state.acceptRefresh([original])
        #expect(!state.needsRefresh)
        #expect(state.draft == nil)
        #expect(state.displayed == [original])
    }
}
