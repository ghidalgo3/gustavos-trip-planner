using System.Text.Json;
using System.Text.Json.Serialization;

namespace TripPlanner.Api.Models;

// SchemaVersion describes the JSON format, not a revision of a trip.
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record PlanningDocument
{
    public int SchemaVersion { get; init; } = 1;
    public TravelDates? TravelDates { get; init; }
    public string? UserTimeZone { get; init; }
    public SearchLocation? Destination { get; init; }
    public PlannedVisit[] Visits { get; init; } = [];
    public RouteSearchLimits SearchLimits { get; init; } = new();
    public PartySearchSettings[] Parties { get; init; } = [];
    public PlanningConstraint[] Constraints { get; init; } = [];
    public string? AiPrompt { get; init; }
    public bool? AiPromptLocked { get; init; }
    public Guid? AiFormOperationId { get; init; }

    public static PlanningDocument FromJson(JsonElement json) =>
        json.Deserialize<PlanningDocument>(JsonSerializerOptions.Web) ?? new();
}

public sealed record TravelDates(DateOnly? StartDate, DateOnly? EndDate);

public sealed record SearchLocation(
    string Code,
    string TimeZone,
    string? Label = null,
    string[]? Codes = null
)
{
    [JsonIgnore]
    public IReadOnlyList<string> AirportCodes => Codes is { Length: > 0 } ? Codes : [Code];
}

public sealed record PartySearchSettings
{
    public Guid PartyId { get; init; }
    public SearchLocation? Origin { get; init; }
    public string Cabin { get; init; } = "economy";
    public string Market { get; init; } = "US";
    public int MaxJourneyHours { get; init; } = 48;
    public int? MaxStops { get; init; }
    public string[] PreferredAirlines { get; init; } = [];
    public string? PreferredAirport { get; init; }
}

public sealed record DateWindow(DateOnly? Earliest, DateOnly? Latest, DateOnly? Preferred = null);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record PlanningConstraint
{
    public Guid Id { get; init; }
    public Guid UserId { get; init; }
    public string Type { get; init; } = "";
    public DateWindow? Window { get; init; }
    public DateOnly? StartDate { get; init; }
    public DateOnly? EndDate { get; init; }
    public Guid? OtherUserId { get; init; }
    public string? LocationType { get; init; }
    public string? Location { get; init; }
    public string[] CountryCodes { get; init; } = [];
    public string? OriginalInput { get; init; }
}

public sealed record PlanningMember(Guid Id, string Name, string? HomeCity);

public sealed record PlanningParty(
    Guid Id,
    IReadOnlyList<PlanningMember> Members,
    SearchLocation? SuggestedOrigin = null,
    string? PreferredAirport = null
);

public sealed record PlanningEditor(
    PlanningDocument Document,
    IReadOnlyList<PlanningParty> Parties
);

public sealed record PlanningIssue(
    string Code,
    string Message,
    Guid? PartyId,
    Guid[] ConstraintIds
);

public sealed record SearchPlanPreview(
    bool Ready,
    int DatePairLimit,
    IReadOnlyList<PlanningIssue> Issues,
    IReadOnlyList<PartySearchPreview> Parties
);

public sealed record PartySearchPreview(
    Guid PartyId,
    int EligibleDatePairs,
    IReadOnlyList<PreparedSearch> Requests,
    IReadOnlyList<string> PendingChecks,
    IReadOnlyList<string> PreferredAirlines
);

public sealed record PreparedSearch(IgnavFareRequest Body, string CacheKey, double DateDistance);

public sealed record IgnavFareRequest(
    [property: JsonPropertyName("origin")] string Origin,
    [property: JsonPropertyName("destination")] string Destination,
    [property: JsonPropertyName("departure_date")] DateOnly DepartureDate,
    [property: JsonPropertyName("return_date")] DateOnly ReturnDate,
    [property: JsonPropertyName("adults")] int Adults,
    [property: JsonPropertyName("cabin_class")] string CabinClass,
    [property: JsonPropertyName("market")] string Market,
    [property:
        JsonPropertyName("max_stops"),
        JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)
    ]
        int? MaxStops,
    string SearchKind = "roundTrip",
    IgnavLegRequest[]? Legs = null,
    bool AllowSelfTransfer = false
);

public sealed record PlannedVisit
{
    public Guid Id { get; init; }
    public SearchLocation? Location { get; init; }
    public int? Nights { get; init; }
    public DateOnly? PresentFrom { get; init; }
    public DateOnly? PresentThrough { get; init; }
    public Guid[] AfterVisitIds { get; init; } = [];
    public string? OriginalInput { get; init; }
}

public sealed record RouteSearchLimits
{
    public int FlexibilityDays { get; init; } = 5;
    public int MaxTripDays { get; init; } = 21;
}

public sealed record IgnavLegRequest(
    [property: JsonPropertyName("origin")] string Origin,
    [property: JsonPropertyName("destination")] string Destination,
    [property: JsonPropertyName("departure_date")] DateOnly DepartureDate,
    [property:
        JsonPropertyName("max_stops"),
        JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)
    ]
        int? MaxStops
);
