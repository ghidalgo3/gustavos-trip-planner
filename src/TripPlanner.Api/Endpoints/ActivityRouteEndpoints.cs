using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Services.ActivityPlanning;
using TripPlanner.Api.Services.Maps;

namespace TripPlanner.Api.Endpoints;

public static class ActivityRouteEndpoints
{
    public static void MapActivityRouteEndpoints(this RouteGroupBuilder api)
    {
        // Map-only, destination-scoped preview. Not exposed as an MCP tool: routing
        // geometry must not become a general Azure Maps proxy for agents.
        api.MapPost(
                "/trips/{tripId:guid}/destinations/{destinationCity}/activity-plan/route-previews",
                Preview
            )
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
    }

    private static async Task<IResult> Preview(
        Guid tripId,
        string destinationCity,
        ActivityRoutePreviewRequest request,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser,
        ActivityPlanningService planning,
        IAzureMapsClient maps,
        TimeProvider clock
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
        var (cityId, destinationError) =
            await PlanningEndpointHelpers.ResolvePlanningDestinationAsync(
                user!.Id,
                tripId,
                destinationCity,
                database,
                context.RequestAborted
            );
        if (destinationError is not null)
        {
            return destinationError;
        }
        destinationCity = cityId!;
        var inputs = await planning.ReadAsync(
            user!.Id,
            tripId,
            destinationCity,
            context.RequestAborted
        );
        if (inputs is null)
        {
            return ActivityPlanEndpoints.LookupFailed();
        }
        context.Response.Headers.CacheControl = "no-store";
        if (request.ContextVersion != ActivityPlanningService.ContextVersion(inputs))
        {
            return ActivityPlanEndpoints.Stale();
        }
        var errors = ActivityPlanRules.Validate(request.Plan, inputs);
        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }
        var day = inputs
            .Evaluate(request.Plan, clock.GetUtcNow())
            .Days.FirstOrDefault(d => d.StayId == request.StayId && d.Date == request.Date);
        var leg = day?.Travel.FirstOrDefault(t =>
            t.FromActivityId == request.FromActivityId && t.ToActivityId == request.ToActivityId
        );
        if (leg?.Departure is not { } departure)
        {
            return Results.BadRequest(new { title = "Choose a travel step in this day's plan." });
        }
        GeographyPoint? Point(Guid? id) =>
            id is { } value
                ? inputs.Activities.FirstOrDefault(a => a.Id == value)?.Geometry?.Position
                : inputs.StayLocationFor(request.StayId)?.Geometry?.Position;
        if (
            Point(request.FromActivityId) is not { } from
            || Point(request.ToActivityId) is not { } to
        )
        {
            return Results.Problem(
                statusCode: 422,
                title: "Set both locations before showing this route."
            );
        }
        try
        {
            var path = await maps.RouteAsync(from, to, departure, leg.Mode, context.RequestAborted);
            return path is null
                ? Results.Problem(
                    statusCode: 422,
                    title: "Route unavailable. Azure Maps could not return a valid street route between these locations."
                )
                : Results.Ok(new ActivityRoutePreviewResponse(leg.Mode, path));
        }
        catch (Exception exception)
            when (exception is HttpRequestException or JsonException or OperationCanceledException)
        {
            context.RequestAborted.ThrowIfCancellationRequested();
            return Results.Problem(
                statusCode: 502,
                title: "The route could not be loaded. Try again."
            );
        }
    }
}
