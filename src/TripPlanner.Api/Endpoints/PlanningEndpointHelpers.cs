using Microsoft.Spatial;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Destinations;

namespace TripPlanner.Api.Endpoints;

internal static class PlanningEndpointHelpers
{
    // Planning tools historically call this parameter destinationCity, but storage is keyed by ID.
    // Resolve once at the boundary and use the canonical ID for every subsequent read/write.
    internal static async Task<(string? CityId, IResult? Error)> ResolvePlanningDestinationAsync(
        Guid userId,
        Guid tripId,
        string destinationCity,
        IPlannerDb database,
        CancellationToken cancellationToken
    )
    {
        string value = destinationCity.Trim();
        var place = await database.GetDestinationPlaceAsync(
            userId,
            tripId,
            value,
            cancellationToken
        );
        if (place is not null)
        {
            return (place.CityId, null);
        }

        var matches = (await database.GetDestinationPlacesAsync(userId, tripId, cancellationToken))
            .Where(p => string.Equals(p.Name, value, StringComparison.OrdinalIgnoreCase))
            .ToArray();
        return matches.Length switch
        {
            1 => (matches[0].CityId, null),
            0 => (
                null,
                Results.Problem(
                    statusCode: 404,
                    title: "Destination not found in this trip.",
                    detail: "Use a destination ID or an exact destination name from list_destinations.",
                    extensions: new Dictionary<string, object?>
                    {
                        ["code"] = "destination_not_found",
                    }
                )
            ),
            _ => (
                null,
                Results.Problem(
                    statusCode: 409,
                    title: "More than one destination has this name. Use its destination ID.",
                    extensions: new Dictionary<string, object?>
                    {
                        ["code"] = "destination_ambiguous",
                    }
                )
            ),
        };
    }

    internal static async Task<(Trip? Trip, User? User, IResult? Error)> AuthorizeAsync(
        Guid tripId,
        bool ownerOnly,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        var (user, error) = await EndpointAuthorization.AuthorizeCurrentUserAsync(
            context,
            database,
            currentUser.Profile!
        );
        if (error is not null)
        {
            return (null, null, error);
        }

        Trip? trip = await database.GetVisibleTripAsync(user!.Id, tripId, context.RequestAborted);
        if (trip is null)
        {
            return (null, user, Results.NotFound());
        }

        if (
            ownerOnly
            && await database.GetTripAsync(user.Id, tripId, context.RequestAborted) is null
        )
        {
            return (trip, user, Results.Forbid());
        }

        return (trip, user, null);
    }

    internal static async Task<(DestinationReadView? ReadView, IResult? Error)> ResolveAsync(
        Guid userId,
        Trip trip,
        string? cityId,
        DestinationService service,
        HttpContext context
    )
    {
        try
        {
            var readView = await service.GetAsync(userId, trip, context.RequestAborted);
            if (cityId is not null && readView.Find(cityId) is null)
            {
                return (null, Results.NotFound());
            }

            return (readView, null);
        }
        catch (InvalidOperationException exception)
        {
            return (
                null,
                Results.Conflict(new { code = "destination_unresolved", title = exception.Message })
            );
        }
        catch (HttpRequestException)
        {
            return (
                null,
                Results.Conflict(
                    new
                    {
                        code = "destination_unresolved",
                        title = "The destination city could not be located. Try again.",
                    }
                )
            );
        }
    }

    internal static IResult GeoJson<T>(T value) =>
        Results.Json(value, contentType: "application/geo+json");

    internal static GeoJsonFeature<DestinationProperties> InactiveDestination(
        DestinationPlace place
    ) =>
        new(
            "Feature",
            place.CityId,
            new(
                "Point",
                GeographyPoint.Create(latitude: place.Latitude, longitude: place.Longitude)
            ),
            new(place.Name, place.CountryCode, place.TimeZone, "", null, null, [], false)
            {
                Constraints = place.Constraints,
            }
        );
}
