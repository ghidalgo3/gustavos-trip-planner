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
    public FlightChoiceProgress[] FlightChoices { get; init; } = [];

    public ActivityFlightLeg[] FlightLegs { get; init; } = [];

    public GeoJsonFeature<StayLocationProperties>? StayLocationFor(Guid stayId) =>
        StayLocations.GetValueOrDefault(stayId);
}

// Flight facts resolved once from selected itineraries and the airport catalog.
public sealed record ActivityFlightLeg(
    Guid TravellerId,
    string TravellerName,
    string DepartureAirport,
    string ArrivalAirport,
    DateTimeOffset? Departure,
    DateTimeOffset? Arrival,
    bool DepartsDestination,
    bool ArrivesDestination,
    string DepartureCandidateId,
    string ArrivalCandidateId
);
