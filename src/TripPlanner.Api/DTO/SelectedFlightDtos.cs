namespace TripPlanner.Api.DTO;

public sealed record SelectFlightRequest(string? CacheKey, int? ItineraryIndex);

public sealed record SetFlightPurchasesRequest(
    string CacheKey,
    int ItineraryIndex,
    bool[]? PurchasedLegs
);
