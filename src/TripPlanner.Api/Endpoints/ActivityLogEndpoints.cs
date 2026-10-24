using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;

namespace TripPlanner.Api.Endpoints;

public static class ActivityLogEndpoints
{
    public static void MapActivityLogEndpoints(this RouteGroupBuilder api) =>
        api.MapGet(
                "/user/activity-log",
                async Task<IResult> (
                    int? skip,
                    HttpContext context,
                    IPlannerDb database,
                    ICurrentUser currentUser,
                    IActivityLogStore log
                ) =>
                {
                    if (skip is < 0 or > 100000)
                    {
                        return Results.BadRequest(
                            new { title = "skip must be between 0 and 100000." }
                        );
                    }

                    var user = await database.GetUserByEmailAsync(
                        currentUser.Profile!.Email,
                        context.RequestAborted
                    );
                    if (user is null)
                    {
                        return Results.NotFound();
                    }

                    var entries = await log.ListAsync(
                        user.Id,
                        51,
                        skip ?? 0,
                        context.RequestAborted
                    );
                    context.Response.Headers.CacheControl = "no-store";
                    return Results.Ok(
                        new ActivityLogPage(
                            entries.Take(50).Select(ActivityLogEntry.From).ToArray(),
                            entries.Count > 50
                        )
                    );
                }
            )
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
}
