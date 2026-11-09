using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Spatial;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Instructions;
using TripPlanner.Api.Serialization;

namespace TripPlanner.Api.Models;

public sealed record ActivityPreferences(
    [property: StringLength(10000)] string Instructions = "",
    DailyPlanningSettings? Defaults = null
);

public sealed record DailyPlanningSettings
{
    [ClockTime, JsonConverter(typeof(IsoTimeOnlyConverter))]
    public TimeOnly SleepStart { get; init; } = new(23, 0);

    [ClockTime, JsonConverter(typeof(IsoTimeOnlyConverter))]
    public TimeOnly SleepEnd { get; init; } = new(7, 0);

    [DurationRange(0, 1440)]
    [JsonConverter(typeof(IsoDurationConverter))]
    public TimeSpan BreakfastDuration { get; init; } = TimeSpan.FromMinutes(30);

    [DurationRange(0, 1440)]
    [JsonConverter(typeof(IsoDurationConverter))]
    public TimeSpan LunchDuration { get; init; } = TimeSpan.FromMinutes(45);

    [DurationRange(0, 1440)]
    [JsonConverter(typeof(IsoDurationConverter))]
    public TimeSpan DinnerDuration { get; init; } = TimeSpan.FromMinutes(45);

    [DurationRange(0, 1440)]
    [JsonConverter(typeof(IsoDurationConverter))]
    public TimeSpan SlackDuration { get; init; } = TimeSpan.FromMinutes(60);

    [AllowedValues("fastest", "walking", "taxi", "driving")]
    [Description(McpInstructions.Fields.DailyTransportMode)]
    public string TransportMode { get; init; } = "fastest";

    [DurationRange(0, 1440)]
    [JsonConverter(typeof(IsoDurationConverter))]
    public TimeSpan AirportArrivalBufferDuration { get; init; } = TimeSpan.FromMinutes(60);

    [DurationRange(0, 1440)]
    [JsonConverter(typeof(IsoDurationConverter))]
    public TimeSpan AirportDepartureBufferDuration { get; init; } = TimeSpan.FromMinutes(120);

    [DurationRange(0, 1440)]
    [JsonConverter(typeof(IsoDurationConverter))]
    public TimeSpan AirportTransferDuration { get; init; } = TimeSpan.FromMinutes(60);
}

public sealed record ActivityPlan
{
    [MaxLength(1000)]
    [Description(McpInstructions.Fields.SelectedActivityIds)]
    public Guid[] SelectedActivityIds { get; init; } = [];

    [MaxLength(1000)]
    public Guid[] ExcludedActivityIds { get; init; } = [];

    [MaxLength(366)]
    [Description(McpInstructions.Fields.PlanDays)]
    public ActivityPlanDay[] Days { get; init; } = [];

    [MaxLength(1000)]
    [Description(McpInstructions.Fields.PlanRules)]
    public ActivityPlanRule[] Rules { get; init; } = [];

    [MaxLength(2000)]
    public ActivityTransportOverride[] TransportOverrides { get; init; } = [];

    [Required]
    public DailyPlanningSettings Settings { get; init; } = new();

    [TimeZoneId, StringLength(100)]
    public string? TimeZone { get; init; }
}

public sealed record ActivityPlanDay(
    Guid StayId,
    [property: SupportedDate] DateOnly Date,
    [property: MaxLength(1000)] Guid[] ActivityIds
)
{
    public DailyPlanningSettings? Settings { get; init; }

    [Description(McpInstructions.Fields.MealPositions)]
    public ActivityMealPositions? MealPositions { get; init; }

    [ClockTime, JsonConverter(typeof(IsoTimeOnlyConverter))]
    public TimeOnly? AvailableFrom { get; init; }

    [ClockTime, JsonConverter(typeof(IsoTimeOnlyConverter))]
    public TimeOnly? AvailableUntil { get; init; }
    public bool AvailabilityConfirmed { get; init; }

    [Required, MaxLength(200)]
    public ActivityFlightMatch[] FlightMatches { get; init; } = [];
}

public sealed record ActivityMealPositions(
    [property: Range(0, 1000)] int Breakfast,
    [property: Range(0, 1000)] int Lunch,
    [property: Range(0, 1000)] int Dinner
)
{
    public int Before(string meal) =>
        meal switch
        {
            "breakfast" => Breakfast,
            "lunch" => Lunch,
            "dinner" => Dinner,
            _ => throw new ArgumentOutOfRangeException(nameof(meal)),
        };
}

public sealed record ActivityFlightMatch(
    Guid TravellerId,
    [property: Required, AllowedValues("arrival", "departure")] string Direction,
    [property: Required, StringLength(64, MinimumLength = 64)] string CandidateId
);

public sealed record ActivityPlanRule(Guid ActivityId)
{
    public bool MustDo { get; init; }

    [SupportedDate]
    public DateOnly? FixedDate { get; init; }

    [ClockTime, JsonConverter(typeof(IsoTimeOnlyConverter))]
    public TimeOnly? FixedStart { get; init; }
    public Guid? AfterActivityId { get; init; }

    [AllowedValues(null, "breakfast", "lunch", "dinner")]
    public string? CoversMeal { get; init; }

    [DurationRange(1, 10080)]
    [JsonConverter(typeof(IsoDurationConverter))]
    public TimeSpan? Duration { get; init; }
    public bool AlwaysAvailable { get; init; }

    [Required, MaxLength(366)]
    public ActivityOpeningWindow[] OpeningWindows { get; init; } = [];

    [Required, MaxLength(366)]
    public DateOnly[] ClosedDates { get; init; } = [];
}

public sealed record ActivityOpeningWindow(
    [property: SupportedDate] DateOnly Date,
    [property: JsonRequired, ClockTime, JsonConverter(typeof(IsoTimeOnlyConverter))] TimeOnly Start,
    [property: JsonRequired, ClockTime, JsonConverter(typeof(IsoTimeOnlyConverter))] TimeOnly End
);

public sealed record ActivityTransportOverride(
    [property: SupportedDate] DateOnly Date,
    Guid? FromActivityId,
    Guid? ToActivityId,
    [property: AllowedValues("walking", "taxi", "driving")] string Mode,
    [property: DurationRange(0, 1440), JsonConverter(typeof(IsoDurationConverter))]
        TimeSpan? Duration = null
);

public sealed record StoredActivityPreferences(ActivityPreferences Preferences, long Version = 0);

public sealed record StoredActivityPlan(
    ActivityPlan Plan,
    ActivityPlanAssessment Assessment,
    long Version,
    long InputRevision,
    DateTimeOffset SavedAt
);

public sealed record ActivityPlanIssue(
    string Code,
    string Severity,
    string Message,
    DateOnly? Date = null,
    Guid? ActivityId = null,
    [property: JsonConverter(typeof(IsoDurationConverter))] TimeSpan? Duration = null
);

public sealed record ActivityScheduleEntry(
    Guid ActivityId,
    Guid StayId,
    DateOnly Date,
    string Name,
    DateTimeOffset? Start,
    DateTimeOffset? End,
    [property: JsonConverter(typeof(IsoDurationConverter))] TimeSpan Duration,
    bool Provisional,
    string? Location,
    [property: JsonPropertyName("coordinates"), JsonConverter(typeof(CoordinatesConverter))]
        GeographyPoint? Position,
    ActivityLink[] Links
);

public sealed record ActivityTravelLeg(
    Guid? FromActivityId,
    Guid? ToActivityId,
    string Mode,
    [property: JsonConverter(typeof(IsoDurationConverter))] TimeSpan Duration,
    bool Provisional,
    string Source,
    [property: JsonConverter(typeof(IsoDurationConverter))] TimeSpan WalkingDuration = default,
    int Transfers = 0,
    [property: JsonConverter(typeof(IsoDurationConverter))] TimeSpan WaitingDuration = default
)
{
    public DateTimeOffset? Departure { get; init; }
}

public sealed record ActivityDayAssessment(
    Guid StayId,
    DateOnly Date,
    [property: JsonConverter(typeof(IsoDurationConverter))] TimeSpan AvailableDuration,
    [property: JsonConverter(typeof(IsoDurationConverter))] TimeSpan ActivityDuration,
    [property: JsonConverter(typeof(IsoDurationConverter))] TimeSpan TravelDuration,
    [property: JsonConverter(typeof(IsoDurationConverter))] TimeSpan MealDuration,
    [property: JsonConverter(typeof(IsoDurationConverter))] TimeSpan RestDuration,
    [property: Description(McpInstructions.Fields.WaitingDuration)]
    [property: JsonConverter(typeof(IsoDurationConverter))]
        TimeSpan WaitingDuration,
    [property: Description(McpInstructions.Fields.SlackDuration)]
    [property: JsonConverter(typeof(IsoDurationConverter))]
        TimeSpan SlackDuration,
    [property: JsonConverter(typeof(IsoDurationConverter))] TimeSpan RequiredSlackDuration,
    [property: JsonConverter(typeof(IsoDurationConverter))] TimeSpan OverrunDuration,
    ActivityScheduleEntry[] Entries,
    ActivityTravelLeg[] Travel
)
{
    public ActivityPlanBreak[] Breaks { get; init; } = [];
    public ActivityAvailabilitySuggestion? FlightAvailability { get; init; }
}

public sealed record ActivityPlanBreak(
    string Name,
    DateTimeOffset? Start,
    DateTimeOffset? End,
    [property: JsonConverter(typeof(IsoDurationConverter))] TimeSpan Duration
);

public sealed record TravellerActivityFit(
    Guid UserId,
    string Name,
    double Points,
    double AvailablePoints,
    bool Estimated
);

public sealed record ActivityPlanAssessment(
    string Status,
    ActivityPlanIssue[] Issues,
    ActivityDayAssessment[] Days,
    TravellerActivityFit[] TravellerFit,
    double GroupUtility,
    DateTimeOffset EvaluatedAt
)
{
    public PlanningEvidenceReference[] Evidence { get; init; } = [];
    public int ConflictCount => Issues.Count(i => i.Severity == "conflict");

    [JsonConverter(typeof(IsoDurationConverter))]
    public TimeSpan TravelDuration =>
        Days.Select(d => d.TravelDuration)
            .Aggregate(TimeSpan.Zero, (sum, duration) => sum + duration);

    [JsonConverter(typeof(IsoDurationConverter))]
    public TimeSpan OverrunDuration =>
        Days.Select(d => d.OverrunDuration)
            .Aggregate(TimeSpan.Zero, (sum, duration) => sum + duration);
}

public sealed record PlanningEvidenceReference(
    string Kind,
    Guid? ActivityId,
    string Source,
    DateTimeOffset RetrievedAt,
    DateOnly[] ApplicableDates,
    bool Provisional
);

public sealed record ActivityAffinity(
    Guid ActivityId,
    Guid UserId,
    double Score,
    double Confidence
);

public sealed record ActivityHoursEvidence(
    Guid ActivityId,
    ActivityOpeningWindow[] Windows,
    string SourceUrl,
    DateTimeOffset RetrievedAt,
    bool Provisional,
    string? Note = null
)
{
    public DateOnly[] ClosedDates { get; init; } = [];
    public string? ActivityContext { get; init; }
    public DateTimeOffset? ExpiresAt { get; init; }
}

public sealed record ActivityRouteEvidence(
    string Key,
    string Mode,
    [property: JsonConverter(typeof(IsoDurationConverter))] TimeSpan Duration,
    DateTimeOffset RetrievedAt,
    DateTimeOffset ExpiresAt,
    string Source,
    bool Provisional = false,
    [property: JsonConverter(typeof(IsoDurationConverter))] TimeSpan WalkingDuration = default,
    int Transfers = 0,
    double PreferenceScore = 2,
    [property: JsonConverter(typeof(IsoDurationConverter))] TimeSpan WaitingDuration = default
);

public sealed record ActivityPlanningEvidence
{
    public string? TimeZone { get; init; }
    public string? AffinityContext { get; init; }
    public ActivityAffinity[] Affinities { get; init; } = [];
    public ActivityHoursEvidence[] Hours { get; init; } = [];
    public ActivityRouteEvidence[] Routes { get; init; } = [];
    public string[] Warnings { get; init; } = [];
    public SuggestedPlanningRule[] SuggestedRules { get; init; } = [];
}

public sealed record SuggestedPlanningRule(string Description, DailyPlanningSettings Settings);

public sealed record ActivityPlanAlternative(
    string Id,
    string Title,
    ActivityPlan Plan,
    ActivityPlanAssessment Assessment
);

public sealed record ActivityPlanSuggestion(
    string Id,
    string Title,
    string Explanation,
    ActivityPlan Plan,
    ActivityPlanAssessment Assessment,
    string Fingerprint
);

public sealed record ActivityPlanningResult(
    Guid Id,
    string Kind,
    string Status,
    long BasePlanVersion,
    string ContextVersion,
    ActivityPlanAssessment Assessment,
    ActivityPlanAlternative[] Alternatives,
    ActivityPlanSuggestion[] Suggestions,
    string[] Warnings
)
{
    public SuggestedPlanningRule[] SuggestedRules { get; init; } = [];
    public ActivityRuleChange[] RuleChanges { get; init; } = [];
    public ActivityAvailabilitySuggestion[] SuggestedAvailability { get; init; } = [];
}

public sealed record ActivityRuleChange(
    Guid ActivityId,
    string Description,
    ActivityPlanRule Replacement
);

public sealed record ActivityProposalReview(string[] DismissedSuggestionIds);

public sealed record ActivityPlanningJob(
    Guid Id,
    Guid UserId,
    Guid TripId,
    string CityId,
    string Kind,
    string RequestHash,
    ActivityPlan Plan,
    long InputRevision,
    long PlanVersion,
    bool RefreshEvidence,
    bool UseAi,
    string Source,
    DateTimeOffset CreatedAt
)
{
    public Guid? LeaseId { get; init; }
    public DateTimeOffset? LeaseExpiresAt { get; init; }
    public int Attempts { get; init; }
    public ActivityPlanningResult? Result { get; init; }
    public ActivityProposalReview Review { get; init; } = new([]);
    public string Status { get; init; } = "pending";
    public string? Error { get; init; }
}

public sealed record ActivityCalendarSubscription(
    Guid Id,
    Guid UserId,
    Guid TripId,
    string TokenHash,
    DateTimeOffset CreatedAt,
    DateTimeOffset? RevokedAt = null
);
