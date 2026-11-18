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
        var (items, error) = await ReadActivities(
            tripId,
            destinationCity,
            context,
            database,
            service,
            currentUser
        );
        return error
            ?? GeoJson(
                new GeoJsonCollection<ActivityProperties>(
                    "FeatureCollection",
                    items!.Select(a => a.ToFeature()).ToArray()
                )
            );
    }

    internal static async Task<(IReadOnlyList<Activity>? Items, IResult? Error)> ReadActivities(
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
            return (null, error);
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
            return (null, resolveError);
        }

        var items = await database.GetActivitiesAsync(
            user.Id,
            tripId,
            destinationCity,
            context.RequestAborted
        );
        return (items, null);
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

        return ValidateLocation(input);
    }

    private static IResult? ValidateLocation(ActivityInput input)
    {
        var properties = input.Properties;
        if (properties.LocationVerification is not { } verification)
        {
            return null;
        }

        bool hasAddress = !string.IsNullOrWhiteSpace(properties.Address);
        bool hasPoint = input.Geometry is not null;
        var urls = verification.SourceUrls;
        if (
            urls is null
            || urls.Count > 20
            || urls.Any(url => !properties.Links.Any(link => link.Url == url))
        )
        {
            return Results.BadRequest(
                new { title = "Include each location source URL in properties.links." }
            );
        }

        bool hasEvidence = urls.Count > 0 && !string.IsNullOrWhiteSpace(verification.Method);
        // An area may have no postal address. A venue always needs both fields.
        string? problem = verification.Precision switch
        {
            ActivityLocationPrecision.VerifiedEntrance
            or ActivityLocationPrecision.VerifiedVenue when hasAddress && hasPoint && hasEvidence =>
                null,
            ActivityLocationPrecision.VerifiedEntrance or ActivityLocationPrecision.VerifiedVenue =>
                "A verified venue or entrance requires an address, a Point, a verification method, and source URLs.",
            ActivityLocationPrecision.RepresentativeArea when hasPoint && hasEvidence => null,
            ActivityLocationPrecision.RepresentativeArea =>
                "A representative area requires a Point, a verification method, and source URLs.",
            ActivityLocationPrecision.Unresolved
                when !hasPoint
                    && hasEvidence
                    && !string.IsNullOrWhiteSpace(verification.Uncertainty) => null,
            ActivityLocationPrecision.Unresolved =>
                "An unresolved location requires null geometry, attempted source URLs, a research method, and the specific uncertainty.",
            ActivityLocationPrecision.Nonphysical
                when !hasPoint && !hasAddress && urls.Count == 0 => null,
            ActivityLocationPrecision.Nonphysical =>
                "Nonphysical activities cannot have a physical address, Point, or geographic sources.",
            _ => "Supply a supported location precision.",
        };
        return problem is null ? null : Results.BadRequest(new { title = problem });
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
