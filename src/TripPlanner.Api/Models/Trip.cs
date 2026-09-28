using System.Text.Json;

namespace TripPlanner.Api.Models;

public sealed record Trip(
    Guid Id,
    Guid OwnerUserId,
    string Name,
    string Description,
    JsonElement Constraints,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt
);

public sealed record CreateTripRequest(string Name, string? Description);

public sealed record UpdateTripRequest(string Name, string? Description);

public sealed record Party(Guid Id, Guid TripId, IReadOnlyList<Guid> UserIds);

public sealed record SelectedFlight(
    Guid TripId,
    Guid PartyId,
    string CacheKey,
    int ItineraryIndex,
    IgnavFareRequest Request,
    JsonElement Itinerary,
    DateTimeOffset SelectedAt,
    bool[]? PurchasedLegs = null
);

public enum PartyMemberChangeStatus
{
    Success,
    PartyNotFound,
    UserNotFound,
    AlreadyInAnotherParty,
    PartyFull,
    OwnerCannotLeave,
}
