namespace TripPlanner.Api.Models;

public sealed record MapRouteEstimate(
    TimeSpan Duration,
    DateTimeOffset RetrievedAt,
    DateTimeOffset? ExpiresAt
);
