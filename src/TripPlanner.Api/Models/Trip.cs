using System.Text.Json;
using System.Text.Json.Serialization;

namespace TripPlanner.Api.Models;

public sealed record Trip(
    Guid Id,
    Guid OwnerUserId,
    string Name,
    string Description,
    JsonElement Constraints,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt
)
{
    [JsonIgnore]
    public JsonElement FlightConstraints { get; init; } =
        JsonSerializer.SerializeToElement(new { });
}

public sealed record Party(Guid Id, Guid TripId, IReadOnlyList<Guid> UserIds)
{
    public IReadOnlyDictionary<Guid, PartyRole> MemberRoles { get; init; } =
        new Dictionary<Guid, PartyRole>();

    public PartyRole RoleFor(Guid userId) =>
        MemberRoles.GetValueOrDefault(userId, PartyRole.Traveller);
}

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

public sealed record FlightChoiceProgress(Guid PartyId, string?[] LegKeys, string[] NextOrigins)
{
    public FlightChoiceLegRoute[]? LegRoutes { get; init; }
    public string[] UnmatchedLegKeys { get; init; } = [];
    public string[] PurchasedOfferIds { get; init; } = [];

    // Retain only the provider offers backing saved choices, including indivisible bundles.
    public FareSearchResult[] SavedFares { get; init; } = [];
}

public sealed record FlightChoiceLegRoute(
    string Key,
    Guid? OriginVisitId,
    Guid? DestinationVisitId
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
