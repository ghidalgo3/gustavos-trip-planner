using System.ComponentModel.DataAnnotations;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Flights;

namespace TripPlanner.Api.Endpoints;

public static class AirportsEndpoints
{
    public static void MapAirportsEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet(
                "/airports",
                (
                    [Required, StringLength(100, MinimumLength = 2)] string q,
                    AirportCatalog airports
                ) =>
                {
                    if (string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2)
                    {
                        return Results.BadRequest(new { title = "Search using 2–100 characters." });
                    }

                    return Results.Ok(airports.Search(q));
                }
            )
            .WithName("SearchAirports");
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
                    {
                        return Results.BadRequest();
                    }

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
                (
                    [Required, StringLength(200)] string city,
                    double longitude,
                    double latitude,
                    AirportCatalog airports
                ) =>
                {
                    if (
                        string.IsNullOrWhiteSpace(city)
                        || !double.IsFinite(longitude)
                        || !double.IsFinite(latitude)
                        || longitude is < -180 or > 180
                        || latitude is < -90 or > 90
                    )
                    {
                        return Results.BadRequest();
                    }

                    return Results.Ok(
                        airports.HomeAirports(new ProfileHomeCity(city, longitude, latitude))
                    );
                }
            )
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
    }
}
