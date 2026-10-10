using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services;

namespace TripPlanner.Api.Endpoints;

public static class ActivityEndpoints
{
    public static void MapActivityEndpoints(this RouteGroupBuilder api)
    {
        var destinations = api.MapGroup("/trips/{tripId:guid}/destinations")
            .WithTags("Activity Planning")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        destinations.MapGet("", GetDestinations).WithName("GetTripDestinations");
        destinations.MapPost("", AddDestination).WithName("AddTripDestination");
        destinations.MapGet("/{destinationCity}", GetDestination).WithName("GetTripDestination");
        destinations
            .MapDelete("/{destinationCity}/stays/{stayId:guid}", DeleteDestinationStay)
            .WithName("DeleteTripDestinationStay");
        destinations
            .MapPut("/{destinationCity}/stays/{stayId:guid}", ReplaceDestinationStay)
            .WithName("ReplaceTripDestinationStay");
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
        destinations
            .MapPost("/{destinationCity}:suggest", Suggest)
            .WithName("SuggestDestinationActivities");
        destinations
            .MapPost("/{destinationCity}:import", ImportImage)
            .WithName("ImportDestinationActivities")
            .WithMetadata(new RequestSizeLimitAttribute(11_000_000));
        destinations
            .MapGet("/{destinationCity}/suggestions/{operationId:guid}", GetSuggestionResult)
            .WithName("GetDestinationActivitySuggestions");
    }

    private static async Task<(Trip? Trip, User? User, IResult? Error)> AuthorizeAsync(
        Guid tripId,
        bool ownerOnly,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        var (user, error) = await EndpointAuthorization.AuthorizeCurrentUserAsync(
            context,
            database,
            currentUser.Profile!
        );
        if (error is not null)
            return (null, null, error);
        Trip? trip = await database.GetVisibleTripAsync(user!.Id, tripId, context.RequestAborted);
        if (trip is null)
            return (null, user, Results.NotFound());
        if (ownerOnly && trip.OwnerUserId != user.Id)
            return (trip, user, Results.Forbid());
        return (trip, user, null);
    }

    private static async Task<(DestinationSnapshot? Snapshot, IResult? Error)> ResolveAsync(
        Guid userId,
        Trip trip,
        string? cityId,
        DestinationService service,
        HttpContext context
    )
    {
        try
        {
            var snapshot = await service.GetAsync(userId, trip, context.RequestAborted);
            if (cityId is not null && snapshot.Find(cityId) is null)
                return (null, Results.NotFound());
            return (snapshot, null);
        }
        catch (InvalidOperationException exception)
        {
            return (
                null,
                Results.Conflict(new { code = "destination_unresolved", title = exception.Message })
            );
        }
        catch (HttpRequestException)
        {
            return (
                null,
                Results.Conflict(
                    new
                    {
                        code = "destination_unresolved",
                        title = "The destination city could not be located. Try again.",
                    }
                )
            );
        }
    }

    private static async Task<IResult> AddDestination(
        Guid tripId,
        DestinationVisitInput input,
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
            return error;
        if (
            string.IsNullOrWhiteSpace(input.Name)
            || input.Name.Length > 150
            || string.IsNullOrWhiteSpace(input.CountryCode)
            || input.CountryCode.Length != 2
            || !input.CountryCode.All(char.IsAsciiLetter)
            || (input.Longitude is null) != (input.Latitude is null)
            || (
                input.Longitude is { } longitude
                && (!double.IsFinite(longitude) || Math.Abs(longitude) > 180)
            )
            || (
                input.Latitude is { } latitude
                && (!double.IsFinite(latitude) || Math.Abs(latitude) > 90)
            )
            || (
                input.ArrivalDate is not null
                && input.DepartureDate is not null
                && input.DepartureDate < input.ArrivalDate
            )
        )
            return Results.BadRequest(
                new
                {
                    title = "Supply a city, a two-letter country code, valid coordinates when provided, and valid optional dates.",
                }
            );
        try
        {
            var visit = await service.AddAsync(user!.Id, trip!, input, context.RequestAborted);
            var snapshot = await service.GetAsync(user.Id, trip!, context.RequestAborted);
            context.Response.Headers.Location = $"/trips/{tripId:D}/destinations/{visit.CityId}";
            return Results.Json(
                snapshot.Find(visit.CityId),
                statusCode: 201,
                contentType: "application/geo+json"
            );
        }
        catch (InvalidOperationException exception)
        {
            return Results.Conflict(
                new { code = "destination_unresolved", title = exception.Message }
            );
        }
        catch (HttpRequestException)
        {
            return Results.Conflict(
                new
                {
                    code = "destination_unresolved",
                    title = "The city could not be located. Try again.",
                }
            );
        }
    }

    private static async Task<IResult> DeleteDestinationStay(
        Guid tripId,
        string destinationCity,
        Guid stayId,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        var (_, user, error) = await AuthorizeAsync(tripId, true, context, database, currentUser);
        if (error is not null)
            return error;
        return await database.DeleteDestinationVisitAsync(
            user!.Id,
            tripId,
            destinationCity,
            stayId,
            context.RequestAborted
        )
            ? Results.NoContent()
            : Results.NotFound();
    }

    private static async Task<IResult> ReplaceDestinationStay(
        Guid tripId,
        string destinationCity,
        Guid stayId,
        DestinationStayInput input,
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
            return error;
        if (
            input.ArrivalDate is not null
            && input.DepartureDate is not null
            && input.DepartureDate < input.ArrivalDate
        )
            return Results.BadRequest(
                new { title = "Departure date cannot precede arrival date." }
            );
        var saved = await database.ReplaceDestinationVisitAsync(
            user!.Id,
            tripId,
            destinationCity,
            stayId,
            input,
            context.RequestAborted
        );
        if (saved is null)
            return Results.NotFound();
        var snapshot = await service.GetAsync(user.Id, trip!, context.RequestAborted);
        return GeoJson(snapshot.Find(destinationCity)!);
    }

    private static async Task<IResult> GetDestinations(
        Guid tripId,
        bool? includeInactive,
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
            return error;
        var (snapshot, resolveError) = await ResolveAsync(user!.Id, trip!, null, service, context);
        if (snapshot is null && resolveError is not null && includeInactive != true)
            return resolveError;
        var active = snapshot?.Collection.Features ?? [];
        if (includeInactive != true)
            return GeoJson(snapshot!.Collection);
        var known = await database.GetDestinationPlacesAsync(
            user.Id,
            tripId,
            context.RequestAborted
        );
        var inactive = known
            .Where(p => active.All(f => f.Id != p.CityId))
            .Select(InactiveDestination);
        return GeoJson(
            new GeoJsonCollection<DestinationProperties>(
                "FeatureCollection",
                [.. active, .. inactive],
                snapshot?.Collection.Route ?? []
            )
        );
    }

    private static async Task<IResult> GetDestination(
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
            return error;
        var (snapshot, resolveError) = await ResolveAsync(
            user!.Id,
            trip!,
            destinationCity,
            service,
            context
        );
        if (resolveError is null)
            return GeoJson(snapshot!.Find(destinationCity)!);
        DestinationPlace? place = await database.GetDestinationPlaceAsync(
            user.Id,
            tripId,
            destinationCity,
            context.RequestAborted
        );
        return place is null ? resolveError : GeoJson(InactiveDestination(place));
    }

    private static async Task<IResult> GetActivities(
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
            return error;
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
            return resolveError;
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

    private static async Task<IResult> GetActivity(
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
            return error;
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
            return resolveError;
        Activity? item = await database.GetActivityAsync(
            user.Id,
            tripId,
            destinationCity,
            activityId,
            context.RequestAborted
        );
        if (item is null)
            return Results.NotFound();
        context.Response.Headers.ETag = ETag(item.UpdatedAt);
        return GeoJson(item.ToFeature());
    }

    private static async Task<IResult> CreateActivity(
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
            return error;
        var (snapshot, resolveError) = await ResolveAsync(
            user!.Id,
            trip!,
            destinationCity,
            service,
            context
        );
        if (resolveError is not null)
            return resolveError;
        if (!ContextMatches(context, snapshot!, destinationCity))
            return DestinationChanged();
        var validation = Validate(input, null);
        if (validation is not null)
            return validation;
        var now = DateTimeOffset.UtcNow;
        var item = new Activity(
            Guid.NewGuid(),
            tripId,
            destinationCity,
            input.Geometry,
            input.Properties with
            {
                Name = input.Properties.Name.Trim(),
                State = input.Properties.State.Trim(),
            },
            now,
            now
        );
        var saved = await database.SaveActivityAsync(
            user.Id,
            item,
            snapshot!.Find(destinationCity)!.Properties.ContextVersion,
            null,
            context.RequestAborted
        );
        if (saved is null)
            return DestinationChanged();
        context.Response.Headers.ETag = ETag(saved.UpdatedAt);
        context.Response.Headers.Location =
            $"/trips/{tripId:D}/destinations/{destinationCity}/activities/{saved.Id:D}";
        return Results.Json(
            saved.ToFeature(),
            statusCode: StatusCodes.Status201Created,
            contentType: "application/geo+json"
        );
    }

    private static async Task<IResult> ReplaceActivity(
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
            return error;
        var (snapshot, resolveError) = await ResolveAsync(
            user!.Id,
            trip!,
            destinationCity,
            service,
            context
        );
        if (resolveError is not null)
            return resolveError;
        if (!ContextMatches(context, snapshot!, destinationCity))
            return DestinationChanged();
        var validation = Validate(input, activityId);
        if (validation is not null)
            return validation;
        Activity? existing = await database.GetActivityAsync(
            user.Id,
            tripId,
            destinationCity,
            activityId,
            context.RequestAborted
        );
        if (existing is null)
            return Results.NotFound();
        if (!MatchETag(context, existing.UpdatedAt))
            return Results.StatusCode(412);
        var saved = await database.SaveActivityAsync(
            user.Id,
            existing with
            {
                Geometry = input.Geometry,
                Properties = input.Properties with
                {
                    Name = input.Properties.Name.Trim(),
                    State = input.Properties.State.Trim(),
                },
                UpdatedAt = DateTimeOffset.UtcNow,
            },
            snapshot!.Find(destinationCity)!.Properties.ContextVersion,
            existing.UpdatedAt,
            context.RequestAborted
        );
        if (saved is null)
            return Results.StatusCode(412);
        context.Response.Headers.ETag = ETag(saved.UpdatedAt);
        return GeoJson(saved.ToFeature());
    }

    private static async Task<IResult> DeleteActivity(
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
            return error;
        var (snapshot, resolveError) = await ResolveAsync(
            user!.Id,
            trip!,
            destinationCity,
            service,
            context
        );
        if (resolveError is not null)
            return resolveError;
        if (!ContextMatches(context, snapshot!, destinationCity))
            return DestinationChanged();
        Activity? existing = await database.GetActivityAsync(
            user.Id,
            tripId,
            destinationCity,
            activityId,
            context.RequestAborted
        );
        if (existing is null)
            return Results.NotFound();
        if (!MatchETag(context, existing.UpdatedAt))
            return Results.StatusCode(412);
        return await database.DeleteActivityAsync(
            user.Id,
            tripId,
            destinationCity,
            activityId,
            snapshot!.Find(destinationCity)!.Properties.ContextVersion,
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
            return Results.BadRequest(
                new { title = "Supply a GeoJSON Feature with a matching ID." }
            );
        var p = input.Properties;
        if (
            string.IsNullOrWhiteSpace(p.Name)
            || p.Name.Length > 200
            || p.Description is null
            || p.Description.Length > 10000
            || string.IsNullOrWhiteSpace(p.State)
            || p.State.Length > 100
            || p.DurationMinutes is <= 0 or > 10080
        )
            return Results.BadRequest(
                new { title = "Check the activity name, description, duration, and state." }
            );
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
            return Results.BadRequest(
                new { title = "Cost needs a nonnegative amount, three-letter currency, and basis." }
            );
        if (
            input.Geometry is { } point
            && (
                point.Type != "Point"
                || point.Coordinates is not { Length: 2 }
                || !double.IsFinite(point.Coordinates[0])
                || !double.IsFinite(point.Coordinates[1])
                || Math.Abs(point.Coordinates[0]) > 180
                || Math.Abs(point.Coordinates[1]) > 90
            )
        )
            return Results.BadRequest(new { title = "Location must be a valid GeoJSON Point." });
        return null;
    }

    private static string ETag(DateTimeOffset value) => $"\"{value.UtcTicks}\"";

    private static bool MatchETag(HttpContext context, DateTimeOffset value) =>
        context.Request.Headers.IfMatch.ToString() == ETag(value);

    private static bool ContextMatches(
        HttpContext context,
        DestinationSnapshot snapshot,
        string cityId
    ) =>
        context.Request.Headers["Destination-Context"].ToString()
        == snapshot.Find(cityId)!.Properties.ContextVersion;

    private static IResult DestinationChanged() =>
        Results.Conflict(
            new
            {
                code = "destination_changed",
                title = "Destination changed. Reload before saving.",
            }
        );

    private static IResult GeoJson<T>(T value) =>
        Results.Json(value, contentType: "application/geo+json");

    private static GeoJsonFeature<DestinationProperties> InactiveDestination(
        DestinationPlace place
    ) =>
        new(
            "Feature",
            place.CityId,
            new("Point", [place.Longitude, place.Latitude]),
            new(place.Name, place.CountryCode, place.TimeZone, "", null, null, [], false)
        );

    private static async Task<IResult> Suggest(
        Guid tripId,
        string destinationCity,
        ActivitySuggestionRequest request,
        HttpContext context,
        IPlannerDb database,
        DestinationService service,
        ICurrentUser currentUser
    ) =>
        await StartJob(
            tripId,
            destinationCity,
            request,
            null,
            null,
            context,
            database,
            service,
            currentUser
        );

    private static async Task<IResult> ImportImage(
        Guid tripId,
        string destinationCity,
        HttpContext context,
        IPlannerDb database,
        DestinationService service,
        ICurrentUser currentUser
    )
    {
        var (_, _, authorizationError) = await AuthorizeAsync(
            tripId,
            true,
            context,
            database,
            currentUser
        );
        if (authorizationError is not null)
            return authorizationError;
        if (context.Request.ContentLength is > 11_000_000)
            return Results.StatusCode(413);
        if (!context.Request.HasFormContentType)
            return Results.BadRequest(new { title = "Send a multipart image upload." });
        var form = await context.Request.ReadFormAsync(context.RequestAborted);
        if (!Guid.TryParse(form["requestId"], out var requestId))
            return Results.BadRequest(new { title = "A request ID is required." });
        IFormFile? file = form.Files.GetFile("image");
        if (file is null || file.Length is <= 0 or > 10_000_000)
            return Results.StatusCode(413);
        await using var stream = file.OpenReadStream();
        using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, context.RequestAborted);
        byte[] bytes = buffer.ToArray();
        string? mime = DetectImage(bytes);
        if (mime is null)
            return Results.StatusCode(415);
        if (!AcceptableImageDimensions(bytes, mime))
            return Results.BadRequest(
                new { title = "The image exceeds 20 megapixels or has invalid dimensions." }
            );
        return await StartJob(
            tripId,
            destinationCity,
            new(requestId, form["input"].ToString(), form["destinationContext"].ToString()),
            bytes,
            mime,
            context,
            database,
            service,
            currentUser
        );
    }

    private static string? DetectImage(byte[] data)
    {
        if (
            data.Length >= 8
            && data.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })
        )
            return "image/png";
        if (data.Length >= 3 && data[0] == 255 && data[1] == 216 && data[2] == 255)
            return "image/jpeg";
        if (
            data.Length >= 12
            && System.Text.Encoding.ASCII.GetString(data, 0, 4) == "RIFF"
            && System.Text.Encoding.ASCII.GetString(data, 8, 4) == "WEBP"
        )
            return "image/webp";
        return null;
    }

    private static bool AcceptableImageDimensions(byte[] data, string mime)
    {
        int width = 0,
            height = 0;
        if (mime == "image/png" && data.Length >= 24)
        {
            width = System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(16, 4));
            height = System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(20, 4));
        }
        else if (mime == "image/webp" && data.Length >= 30)
        {
            string format = System.Text.Encoding.ASCII.GetString(data, 12, 4);
            if (format == "VP8X")
            {
                width = 1 + data[24] + (data[25] << 8) + (data[26] << 16);
                height = 1 + data[27] + (data[28] << 8) + (data[29] << 16);
            }
            else if (
                format == "VP8 "
                && data.Length >= 30
                && data[23] == 0x9d
                && data[24] == 0x01
                && data[25] == 0x2a
            )
            {
                width = ((data[27] << 8) | data[26]) & 0x3fff;
                height = ((data[29] << 8) | data[28]) & 0x3fff;
            }
            else if (format == "VP8L" && data.Length >= 25 && data[20] == 0x2f)
            {
                width = 1 + (((data[22] & 0x3f) << 8) | data[21]);
                height = 1 + (((data[24] & 0x0f) << 10) | (data[23] << 2) | (data[22] >> 6));
            }
        }
        else if (mime == "image/jpeg")
        {
            int offset = 2;
            while (offset + 9 < data.Length)
            {
                if (data[offset] != 0xff)
                    break;
                byte marker = data[offset + 1];
                if (marker is 0xc0 or 0xc1 or 0xc2 or 0xc3)
                {
                    height = (data[offset + 5] << 8) | data[offset + 6];
                    width = (data[offset + 7] << 8) | data[offset + 8];
                    break;
                }
                int segmentLength = (data[offset + 2] << 8) | data[offset + 3];
                if (segmentLength < 2)
                    break;
                offset += segmentLength + 2;
            }
        }
        return width > 0 && height > 0 && (long)width * height <= 20_000_000;
    }

    private static async Task<IResult> StartJob(
        Guid tripId,
        string cityId,
        ActivitySuggestionRequest request,
        byte[]? image,
        string? mime,
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
            return error;
        if (!user!.FeatureFlags.Split(',').Contains("LLM", StringComparer.Ordinal))
            return Results.Forbid();
        if (
            request.RequestId == Guid.Empty
            || request.Input is null
            || request.Input.Length > 4000
            || (image is null && string.IsNullOrWhiteSpace(request.Input))
        )
            return Results.BadRequest(
                new { title = "Supply a request ID and a prompt of at most 4000 characters." }
            );
        var (snapshot, resolveError) = await ResolveAsync(user.Id, trip!, cityId, service, context);
        if (resolveError is not null)
            return resolveError;
        if (request.DestinationContext != snapshot!.Find(cityId)!.Properties.ContextVersion)
            return DestinationChanged();
        try
        {
            TrackedOperation operation = await database.CreateActivityJobAsync(
                user.Id,
                tripId,
                request.RequestId,
                cityId,
                request.DestinationContext,
                request.Input.Trim(),
                image,
                mime,
                context.RequestAborted
            );
            context.Response.Headers.CacheControl = "no-store";
            return Results.Accepted(operation.PollingUrl, operation);
        }
        catch (InvalidOperationException exception)
        {
            return Results.Conflict(new { title = exception.Message });
        }
    }

    private static async Task<IResult> GetSuggestionResult(
        Guid tripId,
        string destinationCity,
        Guid operationId,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        var (_, user, error) = await AuthorizeAsync(tripId, false, context, database, currentUser);
        if (error is not null)
            return error;
        var result = await database.GetActivityJobResultAsync(
            user!.Id,
            tripId,
            destinationCity,
            operationId,
            context.RequestAborted
        );
        if (result is not null)
            return Results.Ok(result);
        return Results.NotFound();
    }
}
