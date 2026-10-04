using System.Text.Json;

namespace TripPlanner.Api.Models;

public sealed record OperationProgress(int Items, int CompletedItems, int FailedItems);

public sealed record TrackedOperation(
    Guid Id,
    Guid? ResourceId,
    string Type,
    string Status,
    OperationProgress Progress,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    string PollingUrl
);

public sealed record StartFlightSearchRequest(Guid RequestId);

public sealed record FareSearchResult(
    Guid PartyId,
    string CacheKey,
    IgnavFareRequest Request,
    JsonElement Response,
    DateTimeOffset FetchedAt,
    DateTimeOffset ExpiresAt
);

public sealed record FareWork(
    string CacheKey,
    IgnavFareRequest Request,
    Guid OperationId,
    Guid LeaseId,
    int Attempts
);

public sealed record TripFormWork(
    Guid OperationId,
    Guid UserId,
    Guid TripId,
    Guid LeaseId,
    int Attempts,
    string Input,
    PlanningDocument Draft
);

public static class OperationState
{
    public const string FlightSearch = "flightSearch";
    public const string TripFormFill = "tripFormFill";

    public static string Url(Guid operationId) => $"/operations/{operationId}";
}
