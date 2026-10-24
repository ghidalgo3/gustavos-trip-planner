using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using TripPlanner.Api.Models;
using TripPlanner.Api.Serialization;

namespace TripPlanner.Api.DTO;

public sealed record ActivityDurationSuggestion(
    [property: DurationRange(1, 10080), JsonConverter(typeof(IsoDurationConverter))] TimeSpan Value,
    [property: Required] ActivityResearchEvidence Evidence
);

public sealed record ActivityCostSuggestion(
    [property: Required] ActivityCost Value,
    [property: Required] ActivityResearchEvidence Evidence
);

public sealed record ActivityDetailsSuggestion(
    ActivityDurationSuggestion? Duration,
    ActivityCostSuggestion? Cost
);
