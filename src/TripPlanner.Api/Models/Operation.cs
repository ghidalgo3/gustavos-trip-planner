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
    IgnavRoundTripRequest Request,
    JsonElement Response,
    DateTimeOffset FetchedAt,
    DateTimeOffset ExpiresAt
);

public sealed record FareWork(
    string CacheKey,
    IgnavRoundTripRequest Request,
    Guid OperationId,
    Guid LeaseId,
    int Attempts
);

public static class OperationState
{
    public const string FlightSearch = "flightSearch";

    public static string Url(Guid operationId) => $"/api/operations/{operationId}";
}
