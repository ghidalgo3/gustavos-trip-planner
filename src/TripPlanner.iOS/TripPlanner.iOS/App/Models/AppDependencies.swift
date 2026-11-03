import Observation

/// Composition root: owns shared services without putting feature state in AppModel.
@MainActor
@Observable
final class AppDependencies {
    let api: any TripPlannerServing
    let resources: ResourceStore
    let model: AppModel

    init(api: (any TripPlannerServing)? = nil, store: (any TripStoring)? = nil) {
        let api = api ?? TripPlannerAPI()
        let resources = ResourceStore()
        self.api = api
        self.resources = resources
        self.model = AppModel(api: api, store: store, resources: resources)
    }
}
