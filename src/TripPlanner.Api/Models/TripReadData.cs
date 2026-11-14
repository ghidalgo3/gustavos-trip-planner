namespace TripPlanner.Api.Models;

// Internal read model. Includes private evaluation inputs; never return it directly.
public sealed record TripReadData(
    Trip Trip,
    bool CanPlan,
    Party[] Parties,
    User[] People,
    DestinationPlace[] Destinations,
    DestinationVisit[] Visits,
    IReadOnlyDictionary<Guid, GeoJsonFeature<StayLocationProperties>> Stays,
    Activity[] Activities,
    StoredActivityPreferences TripPreferences,
    IReadOnlyDictionary<string, StoredActivityPreferences> DestinationPreferences,
    IReadOnlyDictionary<Guid, ActivityPreferences> PrivatePreferences,
    IReadOnlyDictionary<string, StoredActivityPlan?> Plans,
    IReadOnlyDictionary<string, ActivityPlanningEvidence> Evidence,
    SelectedFlight[] Flights,
    FlightChoiceProgress[] Choices,
    long ContextRevision,
    Transportation[] Transportation,
    DateTimeOffset ModifiedAt
)
{
    public Hotel[] Hotels { get; init; } = [];
}
