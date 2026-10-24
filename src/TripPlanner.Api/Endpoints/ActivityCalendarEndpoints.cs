using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services.ActivityPlanning;

namespace TripPlanner.Api.Endpoints;

public static class ActivityCalendarEndpoints
{
    public static void MapActivityCalendarEndpoints(this WebApplication app, RouteGroupBuilder api)
    {
        var subscriptions = api.MapGroup("/trips/{tripId:guid}/calendar-subscriptions")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        subscriptions.MapGet("", List);
        subscriptions.MapPost("", Create);
        subscriptions.MapDelete("/{id:guid}", Revoke);
        app.MapGet("/calendars/{token}.ics", Feed)
            .AllowAnonymous()
            .AddEndpointFilter(
                async (invocation, next) =>
                {
                    try
                    {
                        return await next(invocation);
                    }
                    catch (Exception e) when (e is not OutOfMemoryException)
                    {
                        // Do not let exception-page diagnostics capture a bearer path.
                        invocation
                            .HttpContext.RequestServices.GetRequiredService<ILoggerFactory>()
                            .CreateLogger("ActivityCalendar")
                            .LogWarning("Calendar feed unavailable.");
                        return Results.StatusCode(503);
                    }
                }
            );
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
        if (error is not null)
        {
            return error;
        }

        context.Response.Headers.CacheControl = "no-store";
        return Results.Ok(
            (
                await database.GetActivityCalendarSubscriptionsAsync(
                    user!.Id,
                    tripId,
                    context.RequestAborted
                )
            ).Select(s => new CalendarSubscriptionResponse(s.Id, s.CreatedAt, s.RevokedAt))
        );
    }

    internal static async Task<IResult> Create(
        Guid tripId,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser,
        IOptions<ActivityPlanningOptions> options,
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

        string? baseUrl = options.Value.PublicBaseUrl;
        if (
            !Uri.TryCreate(baseUrl, UriKind.Absolute, out var origin)
            || origin.Scheme != "https" && !(origin.IsLoopback && origin.Scheme == "http")
        )
        {
            return Results.Problem(
                statusCode: 503,
                title: "Configure ActivityPlanning:PublicBaseUrl to enable calendar subscriptions."
            );
        }

        string token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        var saved = await database.CreateActivityCalendarSubscriptionAsync(
            user!.Id,
            tripId,
            new(Guid.NewGuid(), user.Id, tripId, TokenHash(token), clock.GetUtcNow()),
            context.RequestAborted
        );
        if (saved is null)
        {
            return Results.NotFound();
        }

        context.Response.Headers.CacheControl = "no-store";
        return Results.Created(
            $"/trips/{tripId}/calendar-subscriptions/{saved.Id}",
            new CalendarSubscriptionResponse(
                saved.Id,
                saved.CreatedAt,
                null,
                new Uri(origin, $"/calendars/{token}.ics").AbsoluteUri
            )
        );
    }

    internal static async Task<IResult> Revoke(
        Guid tripId,
        Guid id,
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

        return await database.RevokeActivityCalendarSubscriptionAsync(
            user!.Id,
            tripId,
            id,
            context.RequestAborted
        )
            ? Results.NoContent()
            : Results.NotFound();
    }

    private static string TokenHash(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();

    private static async Task<IResult> Feed(string token, HttpContext context, IPlannerDb database)
    {
        context.Response.Headers.CacheControl = "private, no-store";
        context.Response.Headers["Referrer-Policy"] = "no-referrer";
        if (token.Length != 64 || token.Any(c => !char.IsAsciiHexDigit(c)))
        {
            return Results.NotFound();
        }

        var sub = await database.FindActivityCalendarSubscriptionAsync(
            TokenHash(token),
            context.RequestAborted
        );
        if (
            sub is null
            || await database.GetVisibleTripAsync(sub.UserId, sub.TripId, context.RequestAborted)
                is not { } trip
        )
        {
            return Results.NotFound();
        }

        var plans = new List<(StoredActivityPlan, Activity[], DestinationVisit[])>();
        var visits = await database.GetDestinationVisitsAsync(
            sub.UserId,
            sub.TripId,
            context.RequestAborted
        );
        foreach (
            var place in await database.GetDestinationPlacesAsync(
                sub.UserId,
                sub.TripId,
                context.RequestAborted
            )
        )
        {
            if (
                await database.GetActivityPlanAsync(
                    sub.UserId,
                    sub.TripId,
                    place.CityId,
                    context.RequestAborted
                ) is
                { } plan
            )
            {
                plans.Add(
                    (
                        plan,
                        (
                            await database.GetActivitiesAsync(
                                sub.UserId,
                                sub.TripId,
                                place.CityId,
                                context.RequestAborted
                            )
                        ).ToArray(),
                        visits.Where(v => v.CityId == place.CityId).ToArray()
                    )
                );
            }
        }

        return Results.Text(ActivityCalendar.Render(trip, plans), "text/calendar; charset=utf-8");
    }
}
