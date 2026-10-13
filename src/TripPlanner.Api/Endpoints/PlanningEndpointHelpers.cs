using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services;

namespace TripPlanner.Api.Endpoints;

internal static class PlanningEndpointHelpers
{
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
            return (null, null, error);
        Trip? trip = await database.GetVisibleTripAsync(user!.Id, tripId, context.RequestAborted);
        if (trip is null)
            return (null, user, Results.NotFound());
        if (ownerOnly && trip.OwnerUserId != user.Id)
            return (trip, user, Results.Forbid());
        return (trip, user, null);
    }

    internal static async Task<(DestinationSnapshot? Snapshot, IResult? Error)> ResolveAsync(
        Guid userId,
        Trip trip,
        string? cityId,
        DestinationService service,
        HttpContext context
    )
    {
        try
        {
            var snapshot = await service.GetAsync(userId, trip, context.RequestAborted);
            if (cityId is not null && snapshot.Find(cityId) is null)
                return (null, Results.NotFound());
            return (snapshot, null);
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
            new("Point", [place.Longitude, place.Latitude]),
            new(place.Name, place.CountryCode, place.TimeZone, "", null, null, [], false)
            {
                Constraints = place.Constraints,
            }
        );
}
