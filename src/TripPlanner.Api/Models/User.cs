using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using TripPlanner.Api.DTO;

namespace TripPlanner.Api.Models;

public sealed record GeographicPoint(double Longitude, double Latitude);

public sealed record ProfileHomeCity(
    [property: Required, StringLength(200, MinimumLength = 1)] string Name,
    [property: JsonRequired, Range(-180d, 180d)] double Longitude,
    [property: JsonRequired, Range(-90d, 90d)] double Latitude
);

public sealed record UserProfile(
    [property: Required] ProfileHomeCity? HomeCity,
    [property: Required, MaxLength(20), StringItems("^[A-Za-z0-9]{2}$", 2)]
        string[]? PreferredAirlines,
    [property: RegularExpression("^[A-Za-z]{3}$")] string? PreferredAirport = null
);

public sealed record UserSearchResult(Guid Id, string Name, string Email);

public sealed record CurrentUserResponse(
    bool IsAuthenticated,
    Guid? Id,
    string? Name,
    string? Email,
    string? Provider,
    bool CompletedOnboarding,
    UserProfile Profile
);

public sealed record User(
    Guid Id,
    string Provider,
    string Email,
    string DisplayName,
    string? HomeCityName,
    GeographicPoint? HomeCityLocation,
    string[] PreferredAirlines,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    string? PreferredAirport = null
);
