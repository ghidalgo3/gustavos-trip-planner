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
                    [AsParameters] ActivityLogQuery query,
                    HttpContext context,
                    IPlannerDb database,
                    ICurrentUser currentUser,
                    IActivityLogStore log
                ) =>
                {
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
                        ActivityLogQuery.PageSize + 1,
                        query.Skip,
                        query.Source,
                        context.RequestAborted
                    );
                    context.Response.Headers.CacheControl = "no-store";
                    return Results.Ok(
                        new ActivityLogPage(
                            entries
                                .Take(ActivityLogQuery.PageSize)
                                .Select(ActivityLogEntry.From)
                                .ToArray(),
                            entries.Count > ActivityLogQuery.PageSize
                        )
                    );
                }
            )
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
}
