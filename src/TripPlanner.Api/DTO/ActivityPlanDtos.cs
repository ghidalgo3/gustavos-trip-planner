using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using TripPlanner.Api.Models;
using TripPlanner.Api.Serialization;

namespace TripPlanner.Api.DTO;

[JsonConverter(typeof(JsonStringEnumConverter<ActivityPreferenceScope>))]
public enum ActivityPreferenceScope
{
    Profile,
    Trip,
    Destination,
}

// Transport DTOs are independent of the persisted document envelope and its versions.
public sealed record ActivityPreferencesRequest(
    [property: StringLength(10000)] string Instructions,
    DailyPlanningSettings? Defaults = null
);

public sealed record ReplaceActivityPlanRequest(
    ActivityPlan Plan,
    [property: Required, StringLength(200)] string ContextVersion,
    Guid? ProposalId = null,
    [property: StringLength(200, MinimumLength = 1)] string? ChoiceId = null
);

public sealed record PreviewActivityPlanRequest(
    [property: Required] ActivityPlan Plan,
    [property: Required, StringLength(200)] string ContextVersion
);

public sealed record CreateActivityAssessmentRequest(
    Guid RequestId,
    [property: Required, StringLength(200)] string ContextVersion,
    ActivityPlan? Plan = null,
    bool RefreshEvidence = false
);

public sealed record CreateActivityProposalRequest(
    Guid RequestId,
    [property: Required, StringLength(200)] string ContextVersion,
    ActivityPlan? Plan = null,
    bool RefreshEvidence = true,
    [property: AllowedValues("draft", "improvements", "schedule")] string Kind = "draft"
);

public sealed record ReplaceActivityProposalReviewRequest(
    [property: MaxLength(1000), StringItems("^.+$", 200)] string[] DismissedSuggestionIds
);

public sealed record ActivityPlanningOperationResponse(
    Guid OperationId,
    string ResultUrl,
    ActivityPlanningResult? Result = null
);

public sealed record ActivityPlanResponse(
    ActivityPlan Plan,
    long Version,
    string ContextVersion,
    ActivityPlanAssessment Assessment,
    ActivityPlanAssessment? SavedAssessment,
    bool TimingStale,
    ActivityPlanContext Context
);

public sealed record ActivityPlanContext(
    string DestinationName,
    DestinationVisit[] Visits,
    Guid[] TravellerIds,
    string[] TravellerNames,
    string TripInstructions,
    string DestinationInstructions,
    ActivityAvailabilitySuggestion[] SuggestedAvailability
);

public sealed record ActivityAvailabilitySuggestion(
    Guid StayId,
    DateOnly Date,
    [property: ClockTime, JsonConverter(typeof(IsoTimeOnlyConverter))] TimeOnly? AvailableFrom,
    [property: ClockTime, JsonConverter(typeof(IsoTimeOnlyConverter))] TimeOnly? AvailableUntil,
    bool Ambiguous,
    string Explanation,
    string[] FlightChoices
)
{
    public ActivityFlightCandidate[] Candidates { get; init; } = [];
    public DateTimeOffset? AvailableFromInstant { get; init; }
    public DateTimeOffset? AvailableUntilInstant { get; init; }
}

public sealed record ActivityFlightCandidate(
    string Id,
    Guid TravellerId,
    string TravellerName,
    string Direction,
    DateTimeOffset Time
)
{
    public bool Selected { get; init; }
    public string? DepartureAirport { get; init; }
    public string? ArrivalAirport { get; init; }
    public DateTimeOffset? Departure { get; init; }
    public DateTimeOffset? Arrival { get; init; }
}

public sealed record CalendarSubscriptionResponse(
    Guid Id,
    DateTimeOffset CreatedAt,
    DateTimeOffset? RevokedAt,
    string? Url = null
);
