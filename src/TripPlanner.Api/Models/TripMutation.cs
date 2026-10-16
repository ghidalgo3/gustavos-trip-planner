namespace TripPlanner.Api.Models;

public sealed record TripMutation(
    Guid Id,
    DateTimeOffset OccurredAt,
    Guid ActorUserId,
    string ActorName,
    string Source,
    string Action,
    Guid TripId,
    Guid OwnerUserId,
    string TripName,
    string? ResourceId,
    string Description
);
