using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Destinations;
using TripPlanner.Api.Validation;
using static TripPlanner.Api.Endpoints.PlanningEndpointHelpers;

namespace TripPlanner.Api.Endpoints;

public static class ActivityEndpoints
{
    public static void MapActivityEndpoints(this RouteGroupBuilder api)
    {
        var destinations = api.MapGroup("/trips/{tripId:guid}/destinations")
            .WithTags("Activities")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        destinations
            .MapGet("/{destinationCity}/activities", GetActivities)
            .WithName("GetDestinationActivities");
        destinations
            .MapPost("/{destinationCity}/activities", CreateActivity)
            .WithName("CreateDestinationActivity");
        destinations
            .MapGet("/{destinationCity}/activities/{activityId:guid}", GetActivity)
            .WithName("GetDestinationActivity");
        destinations
            .MapPut("/{destinationCity}/activities/{activityId:guid}", ReplaceActivity)
            .WithName("ReplaceDestinationActivity");
        destinations
            .MapDelete("/{destinationCity}/activities/{activityId:guid}", DeleteActivity)
            .WithName("DeleteDestinationActivity");
    }

    internal static async Task<IResult> GetActivities(
        Guid tripId,
        string destinationCity,
        HttpContext context,
        IPlannerDb database,
        DestinationService service,
        ICurrentUser currentUser
    )
    {
        var (trip, user, error) = await AuthorizeAsync(
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

        var (_, resolveError) = await ResolveAsync(
            user!.Id,
            trip!,
            destinationCity,
            service,
            context
        );
        if (
            resolveError is not null
            && await database.GetDestinationPlaceAsync(
                user.Id,
                tripId,
                destinationCity,
                context.RequestAborted
            )
                is null
        )
        {
            return resolveError;
        }

        var items = await database.GetActivitiesAsync(
            user.Id,
            tripId,
            destinationCity,
            context.RequestAborted
        );
        return GeoJson(
            new GeoJsonCollection<ActivityProperties>(
                "FeatureCollection",
                items.Select(a => a.ToFeature()).ToArray()
            )
        );
    }

    internal static async Task<IResult> GetActivity(
        Guid tripId,
        string destinationCity,
        Guid activityId,
        HttpContext context,
        IPlannerDb database,
        DestinationService service,
        ICurrentUser currentUser
    )
    {
        var (trip, user, error) = await AuthorizeAsync(
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

        var (_, resolveError) = await ResolveAsync(
            user!.Id,
            trip!,
            destinationCity,
            service,
            context
        );
        if (
            resolveError is not null
            && await database.GetDestinationPlaceAsync(
                user.Id,
                tripId,
                destinationCity,
                context.RequestAborted
            )
                is null
        )
        {
            return resolveError;
        }

        Activity? item = await database.GetActivityAsync(
            user.Id,
            tripId,
            destinationCity,
            activityId,
            context.RequestAborted
        );
        if (item is null)
        {
            return Results.NotFound();
        }

        context.Response.Headers.ETag = ETag(item.UpdatedAt);
        return GeoJson(item.ToFeature());
    }

    internal static async Task<IResult> CreateActivity(
        Guid tripId,
        string destinationCity,
        ActivityInput input,
        HttpContext context,
        IPlannerDb database,
        DestinationService service,
        ICurrentUser currentUser
    )
    {
        var (trip, user, error) = await AuthorizeAsync(
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

        var (readView, resolveError) = await ResolveAsync(
            user!.Id,
            trip!,
            destinationCity,
            service,
            context
        );
        if (resolveError is not null)
        {
            return resolveError;
        }

        if (!ContextMatches(context, readView!, destinationCity))
        {
            return DestinationChanged();
        }

        var validation = Validate(input, null);
        if (validation is not null)
        {
            return validation;
        }

        var now = DateTimeOffset.UtcNow;
        var item = new Activity(
            Guid.NewGuid(),
            tripId,
            destinationCity,
            input.Geometry,
            input.Properties with
            {
                Name = input.Properties.Name.Trim(),
            },
            now,
            now
        );
        var saved = await database.SaveActivityAsync(
            user.Id,
            item,
            readView!.Find(destinationCity)!.Properties.ContextVersion,
            null,
            context.RequestAborted
        );
        if (saved is null)
        {
            return DestinationChanged();
        }

        context.Response.Headers.ETag = ETag(saved.UpdatedAt);
        context.Response.Headers.Location =
            $"/trips/{tripId:D}/destinations/{destinationCity}/activities/{saved.Id:D}";
        return Results.Json(
            saved.ToFeature(),
            statusCode: StatusCodes.Status201Created,
            contentType: "application/geo+json"
        );
    }

    internal static async Task<IResult> ReplaceActivity(
        Guid tripId,
        string destinationCity,
        Guid activityId,
        ActivityInput input,
        HttpContext context,
        IPlannerDb database,
        DestinationService service,
        ICurrentUser currentUser
    )
    {
        var (trip, user, error) = await AuthorizeAsync(
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

        var (readView, resolveError) = await ResolveAsync(
            user!.Id,
            trip!,
            destinationCity,
            service,
            context
        );
        if (resolveError is not null)
        {
            return resolveError;
        }

        if (!ContextMatches(context, readView!, destinationCity))
        {
            return DestinationChanged();
        }

        var validation = Validate(input, activityId);
        if (validation is not null)
        {
            return validation;
        }

        Activity? existing = await database.GetActivityAsync(
            user.Id,
            tripId,
            destinationCity,
            activityId,
            context.RequestAborted
        );
        if (existing is null)
        {
            return Results.NotFound();
        }

        if (!MatchETag(context, existing.UpdatedAt))
        {
            return Results.StatusCode(412);
        }

        var saved = await database.SaveActivityAsync(
            user.Id,
            existing with
            {
                Geometry = input.Geometry,
                Properties = input.Properties with { Name = input.Properties.Name.Trim() },
                UpdatedAt = DateTimeOffset.UtcNow,
            },
            readView!.Find(destinationCity)!.Properties.ContextVersion,
            existing.UpdatedAt,
            context.RequestAborted
        );
        if (saved is null)
        {
            return Results.StatusCode(412);
        }

        context.Response.Headers.ETag = ETag(saved.UpdatedAt);
        return GeoJson(saved.ToFeature());
    }

    internal static async Task<IResult> DeleteActivity(
        Guid tripId,
        string destinationCity,
        Guid activityId,
        HttpContext context,
        IPlannerDb database,
        DestinationService service,
        ICurrentUser currentUser
    )
    {
        var (trip, user, error) = await AuthorizeAsync(
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

        var (readView, resolveError) = await ResolveAsync(
            user!.Id,
            trip!,
            destinationCity,
            service,
            context
        );
        if (resolveError is not null)
        {
            return resolveError;
        }

        if (!ContextMatches(context, readView!, destinationCity))
        {
            return DestinationChanged();
        }

        Activity? existing = await database.GetActivityAsync(
            user.Id,
            tripId,
            destinationCity,
            activityId,
            context.RequestAborted
        );
        if (existing is null)
        {
            return Results.NotFound();
        }

        if (!MatchETag(context, existing.UpdatedAt))
        {
            return Results.StatusCode(412);
        }

        return await database.DeleteActivityAsync(
            user.Id,
            tripId,
            destinationCity,
            activityId,
            readView!.Find(destinationCity)!.Properties.ContextVersion,
            existing.UpdatedAt,
            context.RequestAborted
        )
            ? Results.NoContent()
            : Results.StatusCode(412);
    }

    private static IResult? Validate(ActivityInput input, Guid? expectedId)
    {
        if (
            input.Type != "Feature"
            || input.Properties is null
            || (expectedId is null && !string.IsNullOrEmpty(input.Id))
            || (expectedId is not null && input.Id != expectedId.Value.ToString("D"))
        )
        {
            return Results.BadRequest(
                new { title = "Supply a GeoJSON Feature with a matching ID." }
            );
        }

        var p = input.Properties;
        if (
            string.IsNullOrWhiteSpace(p.Name)
            || p.Name.Length > 200
            || p.Description is null
            || p.Description.Length > 10000
            || p.Notes is null
            || p.Notes.Length > 10000
            || !Enum.IsDefined(p.State)
            || !new DurationRangeAttribute(1, 10080).IsValid(p.Duration)
        )
        {
            return Results.BadRequest(
                new
                {
                    title = "Check the activity name, description, notes, and duration. State must be Maybe, Yes, or No.",
                }
            );
        }

        if (
            p.Links is null
            || p.Links.Count > 20
            || p.Links.Any(link =>
                link is null
                || string.IsNullOrWhiteSpace(link.Url)
                || link.Url.Length > 2048
                || !Uri.TryCreate(link.Url, UriKind.Absolute, out var uri)
                || uri.Scheme is not ("http" or "https")
                || string.IsNullOrWhiteSpace(uri.Host)
                || !string.IsNullOrEmpty(uri.UserInfo)
                || link.Label?.Length > 200
            )
        )
        {
            return Results.BadRequest(
                new
                {
                    title = "Supply at most 20 HTTP(S) links with optional labels of up to 200 characters.",
                }
            );
        }

        if (
            p.Cost is { } cost
            && (
                cost.Amount < 0
                || cost.Currency is null
                || cost.Currency.Length != 3
                || !cost.Currency.All(char.IsAsciiLetter)
                || cost.Basis is not ("perPerson" or "total")
            )
        )
        {
            return Results.BadRequest(
                new { title = "Cost needs a nonnegative amount, three-letter currency, and basis." }
            );
        }

        if (
            input.Geometry is { } point
            && (
                point.Type != "Point"
                || point.Position is null
                || !double.IsFinite(point.Position.Longitude)
                || !double.IsFinite(point.Position.Latitude)
                || Math.Abs(point.Position.Longitude) > 180
                || Math.Abs(point.Position.Latitude) > 90
            )
        )
        {
            return Results.BadRequest(new { title = "Location must be a valid GeoJSON Point." });
        }

        return null;
    }

    private static string ETag(DateTimeOffset value) => $"\"{value.UtcTicks}\"";

    private static bool MatchETag(HttpContext context, DateTimeOffset value) =>
        context.Request.Headers.IfMatch.ToString() == ETag(value);

    private static bool ContextMatches(
        HttpContext context,
        DestinationReadView readView,
        string cityId
    ) =>
        context.Request.Headers["Destination-Context"].ToString()
        == readView.Find(cityId)!.Properties.ContextVersion;

    private static IResult DestinationChanged() =>
        Results.Conflict(
            new
            {
                code = "destination_changed",
                title = "Destination changed. Reload before saving.",
            }
        );
}
