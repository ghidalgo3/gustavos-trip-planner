using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace TripPlanner.Api.DTO;

public sealed record SelectFlightRequest(
    [property: Required, StringLength(200, MinimumLength = 1)] string? CacheKey,
    [property: Required, Range(0, int.MaxValue)] int? ItineraryIndex,
    [property: MinLength(1), MaxLength(4), StringItems("^.+$", 4096)] string[]? LegKeys = null,
    [property: Range(typeof(decimal), "0", "79228162514264337593543950335")]
        decimal? PriceAmount = null,
    [property: RegularExpression("^[A-Za-z]{3}$")] string? PriceCurrency = null
);

public sealed record SetFlightChoicesRequest(
    [property: Required, MaxLength(4), StringItems("^.+$", 4096)] string[]? LegKeys
);

public sealed record SetFlightPurchasesRequest(
    [property: Required, StringLength(200, MinimumLength = 1)] string CacheKey,
    [property: JsonRequired, Range(0, int.MaxValue)] int ItineraryIndex,
    [property: Required, MinLength(1), MaxLength(4)] bool[]? PurchasedLegs
);
