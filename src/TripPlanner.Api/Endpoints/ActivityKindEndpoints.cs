using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;

namespace TripPlanner.Api.Endpoints;

public static class ActivityKindEndpoints
{
    public static void MapActivityKindEndpoints(this RouteGroupBuilder api) =>
        api.MapGet(
                "/user/activity-kinds",
                (
                    [AsParameters] ActivityKindQuery query,
                    HttpContext context,
                    IPlannerDb database,
                    ICurrentUser currentUser
                ) => ListActivityKinds(query, context, database, currentUser)
            )
            .WithName("ListActivityKinds")
            .WithTags("Activities")
            .Produces<ActivityKindPage>()
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);

    internal static async Task<IResult> ListActivityKinds(
        ActivityKindQuery query,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        var user = await database.GetUserByEmailAsync(
            currentUser.Profile!.Email,
            context.RequestAborted
        );
        context.Response.Headers.CacheControl = "private, no-store";
        return Results.Ok(
            user is null
                ? new ActivityKindPage([], false)
                : await database.GetActivityKindPageAsync(user.Id, query, context.RequestAborted)
        );
    }
}
