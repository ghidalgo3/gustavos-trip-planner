namespace TripPlanner.Api.Models;

// Planning inputs and evaluation. Never serialize this to an HTTP or MCP response: it includes
// other travellers' personal preference instructions.
public sealed partial record ActivityPlanningContext(
    Trip Trip,
    DestinationPlace Place,
    DestinationVisit[] Visits,
    Activity[] Activities,
    Party[] Parties,
    User[] Travellers,
    Dictionary<Guid, ActivityPreferences> ProfilePreferences,
    ActivityPreferences TripPreferences,
    ActivityPreferences DestinationPreferences,
    IReadOnlyDictionary<Guid, GeoJsonFeature<StayLocationProperties>> StayLocations,
    SelectedFlight[] Flights,
    StoredActivityPlan? SavedPlan,
    ActivityPlanningEvidence Evidence,
    long InputRevision
)
{
    public GeoJsonFeature<StayLocationProperties>? StayLocationFor(Guid stayId) =>
        StayLocations.GetValueOrDefault(stayId);
}
