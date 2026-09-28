using TripPlanner.Api.Authentication;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services;

namespace TripPlanner.Api.Endpoints;

public static class AirportsEndpoints
{
    public static void MapAirportsEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet(
                "/airports/cities",
                (string codes, AirportCatalog airports) =>
                {
                    var requested = codes.Split(
                        ',',
                        StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries
                    );
                    if (
                        requested.Length is < 1 or > 50
                        || requested.Any(code => code.Length != 3 || !code.All(char.IsAsciiLetter))
                    )
                        return Results.BadRequest();
                    return Results.Ok(
                        requested
                            .Distinct(StringComparer.OrdinalIgnoreCase)
                            .Where(code => airports.CityName(code) is not null)
                            .ToDictionary(
                                code => code.ToUpperInvariant(),
                                code => airports.CityName(code)!
                            )
                    );
                }
            )
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        api.MapGet(
                "/airports/home",
                (string city, double longitude, double latitude, AirportCatalog airports) =>
                {
                    if (
                        string.IsNullOrWhiteSpace(city)
                        || !double.IsFinite(longitude)
                        || !double.IsFinite(latitude)
                        || longitude is < -180 or > 180
                        || latitude is < -90 or > 90
                    )
                        return Results.BadRequest();
                    return Results.Ok(
                        airports.HomeAirports(new ProfileHomeCity(city, longitude, latitude))
                    );
                }
            )
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
    }
}
