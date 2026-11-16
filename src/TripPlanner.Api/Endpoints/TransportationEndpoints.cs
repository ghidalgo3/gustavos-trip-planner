using System.Text.Json;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.ActivityPlanning;
using TripPlanner.Api.Services.Documents;
using TripPlanner.Api.Services.Flights;
using TripPlanner.Api.Services.Maps;

namespace TripPlanner.Api.Endpoints;

public static class TransportationEndpoints
{
    public static void MapTransportationEndpoints(this RouteGroupBuilder api)
    {
        var group = api.MapGroup("/trips/{tripId:guid}/transportation")
            .WithTags("Transportation")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        group.MapPost("/estimate", Estimate).WithName("EstimateTransportation");
        group.MapGet("", List).WithName("ListTransportation");
        group.MapPost("", Create).WithName("CreateTransportation");
        group.MapGet("/{transportationId:guid}", Get).WithName("GetTransportation");
        group.MapPut("/{transportationId:guid}", Replace).WithName("ReplaceTransportation");
        group.MapDelete("/{transportationId:guid}", Delete).WithName("DeleteTransportation");
    }

    internal static async Task<IResult> Estimate(
        Guid tripId,
        TransportationEstimateRequest request,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser,
        IAzureMapsClient maps
    )
    {
        var (_, _, error) = await PlanningEndpointHelpers.AuthorizeAsync(
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
        context.Response.Headers.CacheControl = "no-store";
        using var budget = new PlanningProviderBudget(1);
        try
        {
            var estimate = await maps.EstimateRouteAsync(
                request.From.Position,
                request.To.Position,
                request.DepartureAt,
                request.Mode == "walk" ? "walking" : "driving",
                budget,
                context.RequestAborted
            );
            var geometry =
                request.IncludeGeometry && estimate is not null
                    ? await maps.RouteAsync(
                        request.From.Position,
                        request.To.Position,
                        request.DepartureAt,
                        request.Mode == "walk" ? "walking" : "driving",
                        context.RequestAborted
                    )
                    : null;
            return estimate is null || (request.IncludeGeometry && geometry is null)
                ? Results.Problem(
                    statusCode: 422,
                    title: "Azure Maps could not find a route between these locations."
                )
                : Results.Ok(
                    new TransportationEstimateResponse(
                        TimeSpan.FromMinutes(Math.Ceiling(estimate.Duration.TotalMinutes)),
                        geometry
                    )
                );
        }
        catch (Exception ex)
            when (ex
                    is HttpRequestException
                        or JsonException
                        or PlanningProviderException
                        or OperationCanceledException
            )
        {
            context.RequestAborted.ThrowIfCancellationRequested();
            return Results.Problem(
                statusCode: 502,
                title: "Travel time could not be estimated. Try again."
            );
        }
    }

    internal static async Task<IResult> List(
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
        return error
            ?? Results.Ok(
                await database.GetTransportationAsync(user!.Id, tripId, context.RequestAborted)
            );
    }

    internal static async Task<IResult> Get(
        Guid tripId,
        Guid transportationId,
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
        var value = (
            await database.GetTransportationAsync(user!.Id, tripId, context.RequestAborted)
        ).FirstOrDefault(t => t.Id == transportationId);
        if (value is null)
        {
            return Results.NotFound();
        }
        context.Response.Headers.ETag = Quote(value.Etag);
        return Results.Json(value, contentType: "application/geo+json");
    }

    internal static Task<IResult> Create(
        Guid tripId,
        TransportationRequest request,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser,
        AirportCatalog airports
    ) => Save(tripId, Guid.NewGuid(), request, true, context, database, currentUser, airports);

    internal static Task<IResult> Replace(
        Guid tripId,
        Guid transportationId,
        TransportationRequest request,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser,
        AirportCatalog airports
    ) => Save(tripId, transportationId, request, false, context, database, currentUser, airports);

    private static async Task<IResult> Save(
        Guid tripId,
        Guid id,
        TransportationRequest request,
        bool create,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser,
        AirportCatalog airports
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
        var data = await database.ReadTripDataAsync(user!.Id, tripId, context.RequestAborted);
        if (data is null)
        {
            return Results.NotFound();
        }
        var invalid = new Dictionary<string, string[]>();
        foreach (
            var stayId in new[] { request.OriginStayId, request.DestinationStayId }.OfType<Guid>()
        )
        {
            if (!data.Visits.Any(v => v.StayId == stayId))
            {
                invalid["stayId"] = ["Transportation must connect visits in this trip."];
            }
        }
        if (request.OriginStayId is { } origin && origin == request.DestinationStayId)
        {
            invalid["destinationStayId"] = ["Choose different origin and destination visits."];
        }
        if (
            request.ArrivalAt is { } arrival
            && (
                request.DepartureAt is not { } departure
                || arrival <= departure
                || arrival - departure > TimeSpan.FromDays(365)
            )
        )
        {
            invalid["arrivalAt"] = ["Arrival must follow departure and be within one year."];
        }
        if (invalid.Count > 0)
        {
            return Results.ValidationProblem(invalid);
        }
        var previous = data.Transportation.FirstOrDefault(t => t.Id == id);
        if (!create && previous is null)
        {
            return Results.NotFound();
        }
        if (!create && context.Request.Headers.IfMatch != Quote(previous!.Etag))
        {
            return ActivityPlanEndpoints.VersionError(context);
        }
        foreach (
            var reference in request
                .Features.Select(f => f.Properties.Reference)
                .OfType<TransportationReferenceRequest>()
        )
        {
            bool exists = reference.Kind switch
            {
                "activity" => data.Activities.Any(a => a.Id == reference.Id),
                "hotel" => data.Hotels.Any(h => h.Id == reference.Id),
                "home" => data.People.Any(p => p.Id == reference.Id),
                "airport" => airports.FindById(reference.Id) is not null,
                _ => false,
            };
            if (!exists)
            {
                return Results.ValidationProblem(
                    new Dictionary<string, string[]>
                    {
                        ["features"] =
                        [
                            "References must identify an activity, hotel, or person in this trip, or a known airport.",
                        ],
                    }
                );
            }
        }
        if (
            (request.OriginStayId is not null || request.DestinationStayId is not null)
            && data.Transportation.Any(t =>
                t.Id != id
                && t.OriginStayId == request.OriginStayId
                && t.DestinationStayId == request.DestinationStayId
            )
        )
        {
            return Results.Problem(
                statusCode: 409,
                title: "Transportation already exists for these visits. Refresh before editing."
            );
        }
        var value = request.ToModel(id, previous?.Version ?? 0, false);
        if (value.DepartureAt is { } start && value.ArrivalAt is { } end)
        {
            value = value with { Duration = end - start };
        }
        static string Endpoint(TransportationFeature f) =>
            f.Properties.Reference is { } r
                ? JsonSerializer.Serialize(r)
                : JsonSerializer.Serialize(f.Geometry);
        var steps = value
            .Features.Where(f => f.Id is not ("from" or "to"))
            .OrderBy(f => f.Properties.Sequence)
            .ToArray();
        bool sameSteps =
            previous is not null
            && JsonSerializer.Serialize(steps, TripResourceProjection.JsonOptions)
                == JsonSerializer.Serialize(
                    previous
                        .Features.Where(f => f.Id is not ("from" or "to"))
                        .OrderBy(f => f.Properties.Sequence),
                    TripResourceProjection.JsonOptions
                );
        bool endpointsChanged =
            previous is not null
            && value
                .Features.Where(f => f.Id is "from" or "to")
                .Any(f => Endpoint(f) != Endpoint(previous.Features.Single(old => old.Id == f.Id)));
        value = value with
        {
            RouteStale =
                steps.Length > 0
                && !request.RouteReviewed
                && sameSteps
                && (previous!.RouteStale || endpointsChanged || previous.Mode != value.Mode),
        };
        try
        {
            var saved = await database.SaveTransportationAsync(
                user.Id,
                tripId,
                value,
                create ? null : previous!.Version,
                context.RequestAborted
            );
            if (saved is null)
            {
                return Results.Problem(
                    statusCode: 412,
                    title: "Transportation changed. Refresh before editing again."
                );
            }
            context.Response.Headers.ETag = Quote(saved.Etag);
            if (create)
            {
                context.Response.Headers.Location = $"/trips/{tripId}/transportation/{id}";
            }
            return Results.Json(
                saved,
                statusCode: create ? 201 : 200,
                contentType: "application/geo+json"
            );
        }
        catch (Npgsql.PostgresException ex)
            when (ex.SqlState is "23503" or "23505" or "23514" or "40001" or "40P01")
        {
            return Results.Problem(
                statusCode: 409,
                title: "A transportation location changed. Refresh before retrying."
            );
        }
    }

    internal static async Task<IResult> Delete(
        Guid tripId,
        Guid transportationId,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
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
        var previous = (
            await database.GetTransportationAsync(user!.Id, tripId, context.RequestAborted)
        ).FirstOrDefault(t => t.Id == transportationId);
        if (previous is null)
        {
            return Results.NotFound();
        }
        if (context.Request.Headers.IfMatch != Quote(previous.Etag))
        {
            return ActivityPlanEndpoints.VersionError(context);
        }
        return await database.DeleteTransportationAsync(
            user.Id,
            tripId,
            transportationId,
            previous.Version,
            context.RequestAborted
        )
            ? Results.NoContent()
            : Results.Problem(
                statusCode: 412,
                title: "Transportation changed. Refresh before deleting."
            );
    }

    internal static string Quote(string token) => $"\"{token}\"";
}
