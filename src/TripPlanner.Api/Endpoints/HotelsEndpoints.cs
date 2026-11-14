using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Endpoints;

public static class HotelsEndpoints
{
    public static void MapHotelsEndpoints(this RouteGroupBuilder api)
    {
        var group = api.MapGroup("/trips/{tripId:guid}/hotels")
            .WithTags("Hotels")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        group.MapGet("", List).WithName("ListHotels");
        group.MapGet("/{hotelId:guid}", Get).WithName("GetHotel");
        group.MapPost("", Create).WithName("CreateHotel");
        group.MapPut("/{hotelId:guid}", Replace).WithName("ReplaceHotel");
        group.MapDelete("/{hotelId:guid}", Delete).WithName("DeleteHotel");
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
            ?? Results.Ok(await database.GetHotelsAsync(user!.Id, tripId, context.RequestAborted));
    }

    internal static async Task<IResult> Get(
        Guid tripId,
        Guid hotelId,
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
            await database.GetHotelsAsync(user!.Id, tripId, context.RequestAborted)
        ).FirstOrDefault(h => h.Id == hotelId);
        if (value is null)
        {
            return Results.NotFound();
        }
        context.Response.Headers.ETag = TransportationEndpoints.Quote(value.Etag);
        return Results.Ok(value);
    }

    internal static Task<IResult> Create(
        Guid tripId,
        HotelRequest request,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    ) => Save(tripId, Guid.NewGuid(), request, true, context, database, currentUser);

    internal static Task<IResult> Replace(
        Guid tripId,
        Guid hotelId,
        HotelRequest request,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    ) => Save(tripId, hotelId, request, false, context, database, currentUser);

    private static async Task<IResult> Save(
        Guid tripId,
        Guid hotelId,
        HotelRequest request,
        bool create,
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
        var old = (
            await database.GetHotelsAsync(user!.Id, tripId, context.RequestAborted)
        ).FirstOrDefault(h => h.Id == hotelId);
        if (!create && old is null)
        {
            return Results.NotFound();
        }
        if (!create && context.Request.Headers.IfMatch != TransportationEndpoints.Quote(old!.Etag))
        {
            return ActivityPlanEndpoints.VersionError(context);
        }
        var saved = await database.SaveHotelAsync(
            user.Id,
            tripId,
            new(
                hotelId,
                tripId,
                request.Name.Trim(),
                request.Address,
                request.Geometry,
                request.TimeZone
            ),
            create ? null : old!.Version,
            context.RequestAborted
        );
        if (saved is null)
        {
            return Results.Problem(
                statusCode: 412,
                title: "Hotel changed. Refresh before editing."
            );
        }
        context.Response.Headers.ETag = TransportationEndpoints.Quote(saved.Etag);
        return create
            ? Results.Created($"/trips/{tripId}/hotels/{saved.Id}", saved)
            : Results.Ok(saved);
    }

    internal static async Task<IResult> Delete(
        Guid tripId,
        Guid hotelId,
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
        var old = (
            await database.GetHotelsAsync(user!.Id, tripId, context.RequestAborted)
        ).FirstOrDefault(h => h.Id == hotelId);
        if (old is null)
        {
            return Results.NotFound();
        }
        if (context.Request.Headers.IfMatch != TransportationEndpoints.Quote(old.Etag))
        {
            return ActivityPlanEndpoints.VersionError(context);
        }
        return await database.DeleteHotelAsync(
            user.Id,
            tripId,
            hotelId,
            old.Version,
            context.RequestAborted
        )
            ? Results.NoContent()
            : Results.Problem(statusCode: 412, title: "Hotel changed. Refresh before deleting.");
    }
}
