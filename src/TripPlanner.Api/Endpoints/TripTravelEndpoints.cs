using System.Text.Json;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Documents;

namespace TripPlanner.Api.Endpoints;

public static class TripTravelEndpoints
{
    public static void MapTripTravelEndpoints(this RouteGroupBuilder api)
    {
        var group = api.MapGroup("/trips/{tripId:guid}/travel")
            .WithTags("Travel")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        group.MapGet("", GetTravel).WithName("GetTripTravel");
        group.MapPut("", ReplaceTravel).WithName("ReplaceTripTravel");
    }

    internal static async Task<IResult> GetTravel(
        Guid tripId,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        var (_, user, error) = await PlanningEndpointHelpers.AuthorizeAsync(
            tripId,
            false,
            context,
            database,
            currentUser
        );
        if (error is not null)
        {
            return error;
        }
        var saved = await database.GetTripTravelAsync(user!.Id, tripId, context.RequestAborted);
        context.Response.Headers.ETag = ETag(saved.Version);
        return Results.Ok(saved);
    }

    public static string ETag(long version) => $"\"travel-{version}\"";

    internal static async Task<IResult> ReplaceTravel(
        Guid tripId,
        TripTravelRequest request,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser,
        TripReader reader,
        TripResourceProjection projection
    )
    {
        var (_, user, error) = await PlanningEndpointHelpers.AuthorizeAsync(
            tripId,
            true,
            context,
            database,
            currentUser
        );
        if (error is not null)
        {
            return error;
        }
        var data = await reader.ReadAsync(user!.Id, tripId, context.RequestAborted);
        if (data is null)
        {
            return Results.NotFound();
        }
        if (context.Request.Headers.IfMatch != ETag(data.Travel.Version))
        {
            return ActivityPlanEndpoints.VersionError(context);
        }
        var view = projection.Project(data);
        var document = view.Document;
        var reservedCalendarIds = document.Itinerary["items"]!
            .AsArray()
            .Where(item => item!["kind"]!.GetValue<string>() != "connection")
            .Select(item => Guid.Parse(item!["id"]!.GetValue<string>()))
            .ToHashSet();
        var placeIds = document.Places.Select(p => p["id"]!.GetValue<string>()).ToHashSet();
        var serviceIds = view.Services.Keys.ToHashSet();
        var derivedPlaceIds = data
            .Activities.Select(a =>
                TripResourceProjection.LocalId(tripId, "place", $"activity:{a.Id:D}")
            )
            .Concat(
                data.Visits.Select(v =>
                    TripResourceProjection.LocalId(tripId, "place", $"stay:{v.StayId:D}")
                )
            )
            .ToHashSet();
        derivedPlaceIds.UnionWith(
            data.Destinations.Select(p => TripResourceProjection.LocalId(tripId, "place", p.CityId))
        );
        bool ValidEndpoint(TravelEndpointRequest? endpoint)
        {
            if (
                endpoint is null
                || endpoint.PlaceId is null
                    && endpoint.ActivityId is null
                    && endpoint.VisitId is null
            )
            {
                return false;
            }
            if (
                endpoint.PlaceId is not null
                    && (
                        !placeIds.Contains(endpoint.PlaceId)
                        || derivedPlaceIds.Contains(endpoint.PlaceId)
                    )
                || endpoint.VisitId is { } visit && !data.Visits.Any(v => v.StayId == visit)
                || endpoint.ActivityId is { } activity
                    && !data.Activities.Any(a => a.Id == activity)
            )
            {
                return false;
            }
            if (
                endpoint.ActivityId is { } id
                && endpoint.VisitId is { } stay
                && data.Activities.Single(a => a.Id == id).CityId
                    != data.Visits.Single(v => v.StayId == stay).CityId
            )
            {
                return false;
            }
            return true;
        }
        if (
            request.Connections.Any(c =>
                c.Id == Guid.Empty
                || reservedCalendarIds.Contains(c.Id)
                || data.People.Any(p => p.Id == c.Id)
                || data.Activities.Any(a => a.Id == c.Id)
                || data.Visits.Any(v => v.StayId == c.Id)
                || c.Id == tripId
            )
            || request.Connections.Select(c => c.Id).Distinct().Count()
                != request.Connections.Length
            || request.Connections.Any(c =>
                !ValidEndpoint(c.From)
                || !ValidEndpoint(c.To)
                || c.ServiceId is not null && !serviceIds.Contains(c.ServiceId)
                || (c.Segments ?? []).Any(s => !ValidEndpoint(s.From) || !ValidEndpoint(s.To))
            )
        )
        {
            return Results.ValidationProblem(
                new Dictionary<string, string[]>
                {
                    ["connections"] =
                    [
                        "Use unique nonempty IDs and places, activities, visits, and services belonging to this trip.",
                    ],
                }
            );
        }
        TripTravelEndpoint Endpoint(TravelEndpointRequest endpoint) =>
            new(endpoint.PlaceId, endpoint.ActivityId, endpoint.VisitId);
        var connections = request
            .Connections.Select(c =>
            {
                var previous = data.Travel.Connections.FirstOrDefault(old => old.Id == c.Id);
                return new TripTravelConnection(
                    c.Id,
                    c.Name.Trim(),
                    Endpoint(c.From),
                    Endpoint(c.To),
                    c.Mode,
                    previous is not null && previous.Mode == c.Mode
                        ? previous.ModeSelectedBy
                        : "user",
                    c.DepartureDate,
                    c.DepartureTime,
                    c.TimeZone,
                    c.DurationOverride,
                    c.ServiceId,
                    (c.Segments ?? [])
                        .Select(s => new TripTravelSegment(
                            s.Mode,
                            Endpoint(s.From),
                            Endpoint(s.To),
                            s.Duration
                        ))
                        .ToArray(),
                    previous is not null
                    && previous.From == Endpoint(c.From)
                    && previous.To == Endpoint(c.To)
                    && previous.Mode == c.Mode
                    && previous.DepartureDate == c.DepartureDate
                    && previous.DepartureTime == c.DepartureTime
                    && previous.TimeZone == c.TimeZone
                        ? previous.Estimate
                        : null,
                    c.ServiceId is null
                        ? null
                        : JsonSerializer.SerializeToElement(view.Services[c.ServiceId])
                );
            })
            .ToArray();
        var saved = await database.SaveTripTravelAsync(
            user.Id,
            tripId,
            connections,
            data.Travel.Version,
            data.ContextRevision,
            context.RequestAborted
        );
        if (saved is null)
        {
            return Results.Problem(
                statusCode: 412,
                title: "Travel connections changed. Refresh before editing again."
            );
        }
        context.Response.Headers.ETag = ETag(saved.Version);
        return Results.Ok(saved);
    }
}
