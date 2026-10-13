namespace TripPlanner.Api.DTO;

public sealed record SelectFlightRequest(
    string? CacheKey,
    int? ItineraryIndex,
    string[]? LegKeys = null,
    decimal? PriceAmount = null,
    string? PriceCurrency = null
);

public sealed record SetFlightChoicesRequest(string[]? LegKeys);

public sealed record SetFlightPurchasesRequest(
    string CacheKey,
    int ItineraryIndex,
    bool[]? PurchasedLegs
);
