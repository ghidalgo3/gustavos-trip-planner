namespace TripPlanner.Api.Models;

public sealed record GeographicPoint(double Longitude, double Latitude);

public sealed record SetHomeCityRequest(string CityName, double Longitude, double Latitude);

public sealed record CurrentUserResponse(
    bool IsAuthenticated,
    Guid? Id,
    string? Name,
    string? Email,
    string? Provider,
    bool CompletedOnboarding,
    string? HomeCityName
);

public sealed record User(
    Guid Id,
    string Provider,
    string Email,
    string DisplayName,
    string? HomeCityName,
    GeographicPoint? HomeCityLocation,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt
);
