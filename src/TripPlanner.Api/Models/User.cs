namespace TripPlanner.Api.Models;

public sealed record GeographicPoint(double Longitude, double Latitude);

public sealed record ProfileHomeCity(string Name, double Longitude, double Latitude);

public sealed record UserProfile(ProfileHomeCity? HomeCity, string[]? PreferredAirlines);

public sealed record UserSearchResult(Guid Id, string Name, string Email);

public sealed record CurrentUserResponse(
    bool IsAuthenticated,
    Guid? Id,
    string? Name,
    string? Email,
    string? Provider,
    bool CompletedOnboarding,
    UserProfile Profile,
    string[]? FeatureFlags = null
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
    string FeatureFlags = ""
);
