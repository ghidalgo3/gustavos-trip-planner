using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.Json.Serialization;
using TripPlanner.Api.DTO;

namespace TripPlanner.Api.Models;

// SchemaVersion describes the JSON format, not a revision of a trip.
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record PlanningDocument
{
    [Range(1, 1)]
    public int SchemaVersion { get; init; } = 1;
    public TravelDates? TravelDates { get; init; }

    [TimeZoneId, StringLength(100)]
    public string? UserTimeZone { get; init; }
    public SearchLocation? Destination { get; init; }

    [Required]
    public PlannedVisit[] Visits { get; init; } = [];
    public RouteSearchLimits SearchLimits { get; init; } = new();

    [MaxLength(20)]
    public PartySearchSettings[] Parties { get; init; } = [];

    [MaxLength(100)]
    public PlanningConstraint[] Constraints { get; init; } = [];

    [StringLength(4000)]
    public string? AiPrompt { get; init; }
    public bool? AiPromptLocked { get; init; }
    public Guid? AiFormOperationId { get; init; }

    public static PlanningDocument FromJson(JsonElement json) =>
        json.Deserialize<PlanningDocument>(JsonSerializerOptions.Web) ?? new();
}

public sealed record TravelDates(
    [property: SupportedDate] DateOnly? StartDate,
    [property: SupportedDate] DateOnly? EndDate
);

public sealed record SearchLocation(
    [property: Required, RegularExpression("^[A-Z]{3}$")] string Code,
    [property: Required, TimeZoneId, StringLength(100)] string TimeZone,
    [property: StringLength(200)] string? Label = null,
    [property: MaxLength(10), StringItems("^[A-Z]{3}$", 3)] string[]? Codes = null
)
{
    [JsonIgnore]
    public IReadOnlyList<string> AirportCodes => Codes is { Length: > 0 } ? Codes : [Code];
}

public sealed record PartySearchSettings
{
    public Guid PartyId { get; init; }
    public SearchLocation? Origin { get; init; }

    [AllowedValues("economy", "premium_economy", "business", "first")]
    public string Cabin { get; init; } = "economy";

    [Required, RegularExpression("^[A-Z]{2}$")]
    public string Market { get; init; } = "US";

    [Range(1, 168)]
    public int MaxJourneyHours { get; init; } = 48;

    [Range(0, 2)]
    public int? MaxStops { get; init; }

    [MaxLength(30), StringItems("^[A-Z0-9]{2}$", 2)]
    public string[] PreferredAirlines { get; init; } = [];

    [RegularExpression("^[A-Z]{3}$")]
    public string? PreferredAirport { get; init; }
}

public sealed record DateWindow(
    [property: SupportedDate] DateOnly? Earliest,
    [property: SupportedDate] DateOnly? Latest,
    [property: SupportedDate] DateOnly? Preferred = null
);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record PlanningConstraint
{
    public Guid Id { get; init; }
    public Guid UserId { get; init; }

    [AllowedValues(
        "departureWindow",
        "returnHomeWindow",
        "presence",
        "travelTogether",
        "nonstop",
        "avoidLayover"
    )]
    public string Type { get; init; } = "";
    public DateWindow? Window { get; init; }

    [SupportedDate]
    public DateOnly? StartDate { get; init; }

    [SupportedDate]
    public DateOnly? EndDate { get; init; }
    public Guid? OtherUserId { get; init; }

    [AllowedValues(null, "airport", "city", "country", "region")]
    public string? LocationType { get; init; }

    [StringLength(200)]
    public string? Location { get; init; }

    [MaxLength(250), StringItems("^[A-Z]{2}$", 2)]
    public string[] CountryCodes { get; init; } = [];

    [StringLength(4000)]
    public string? OriginalInput { get; init; }
}

public sealed record PlanningMember(
    Guid Id,
    string Name,
    string? HomeCity,
    PartyRole Role = PartyRole.Traveller
);

public sealed record PlanningParty(
    Guid Id,
    IReadOnlyList<PlanningMember> Members,
    SearchLocation? SuggestedOrigin = null,
    string? PreferredAirport = null
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

public sealed record PreparedSearch(IgnavFareRequest Body, string CacheKey, double DateDistance)
{
    public int[] LegIndexes { get; init; } = [];
}

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
    bool AllowSelfTransfer = false,
    int SearchPriority = 1
);

public sealed record PlannedVisit
{
    [Range(0, 5)]
    public int? ArrivalFlexibilityDays { get; init; }

    [Range(0, 5)]
    public int? DepartureFlexibilityDays { get; init; }
    public Guid Id { get; init; }
    public SearchLocation? Location { get; init; }

    [Range(1, 60)]
    public int? Nights { get; init; }

    [SupportedDate]
    public DateOnly? PresentFrom { get; init; }

    [SupportedDate]
    public DateOnly? PresentThrough { get; init; }

    [Required]
    public Guid[] AfterVisitIds { get; init; } = [];

    [StringLength(4000)]
    public string? OriginalInput { get; init; }
}

public sealed record RouteSearchLimits
{
    [Range(0, 5)]
    public int FlexibilityDays { get; init; } = 5;

    [Range(1, 36890)]
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
