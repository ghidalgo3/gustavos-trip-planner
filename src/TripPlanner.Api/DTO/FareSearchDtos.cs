using System.Text.Json;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.DTO;

public sealed record FareValidationIssueDto(string Code, string Message, Guid[] ConstraintIds);

public sealed record FareEvaluationDto(string Status, IReadOnlyList<FareValidationIssueDto> Issues);

public sealed record EvaluatedFareSearchResultDto(
    Guid PartyId,
    string CacheKey,
    IgnavFareRequest Request,
    JsonElement Response,
    DateTimeOffset FetchedAt,
    DateTimeOffset ExpiresAt,
    IReadOnlyList<FareEvaluationDto> Evaluations
);
