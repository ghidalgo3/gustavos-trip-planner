using System.Text.Json;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Destinations;
using static TripPlanner.Api.Endpoints.PlanningEndpointHelpers;

namespace TripPlanner.Api.Endpoints;

public static class DestinationsEndpoints
{
    public static void MapDestinationsEndpoints(this RouteGroupBuilder api)
    {
        var destinations = api.MapGroup("/trips/{tripId:guid}/destinations")
            .WithTags("Destinations")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        destinations
            .MapPost("/{destinationCity}/stay/address-proposals", CreateStayAddressProposal)
            .WithName("CreateStayAddressProposal");
        destinations
            .MapGet("/{destinationCity}/stays/{stayId:guid}/location", GetStayLocation)
            .WithName("GetDestinationStayLocation");
        destinations
            .MapPut("/{destinationCity}/stays/{stayId:guid}/location", SaveStayLocation)
            .WithName("SaveDestinationStayLocation");
        destinations
            .MapDelete("/{destinationCity}/stays/{stayId:guid}/location", DeleteStayLocation)
            .WithName("DeleteDestinationStayLocation");
        destinations.MapGet("", GetDestinations).WithName("GetTripDestinations");
        destinations.MapPost("", AddDestination).WithName("AddTripDestination");
        destinations
            .MapPut("/{destinationCity}", ReplaceDestination)
            .WithName("ReplaceTripDestination");
        destinations
            .MapDelete("/{destinationCity}", DeleteDestination)
            .WithName("DeleteTripDestination");
        destinations.MapGet("/{destinationCity}", GetDestination).WithName("GetTripDestination");
        destinations
            .MapDelete("/{destinationCity}/stays/{stayId:guid}", DeleteDestinationStay)
            .WithName("DeleteTripDestinationStay");
        destinations
            .MapPut("/{destinationCity}/stays/{stayId:guid}", ReplaceDestinationStay)
            .WithName("ReplaceTripDestinationStay");
    }

    internal static async Task<IResult> CreateStayAddressProposal(
        Guid tripId,
        string destinationCity,
        StayAddressSearchRequest request,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser,
        DestinationService destinations,
        IStayAddressResearch research
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
        if (!user!.FeatureFlags.Split(',').Contains("LLM", StringComparer.Ordinal))
        {
            return Results.Forbid();
        }
        var (snapshot, resolveError) = await ResolveAsync(
            user.Id,
            trip!,
            destinationCity,
            destinations,
            context
        );
        if (resolveError is not null)
        {
            return resolveError;
        }
        context.Response.Headers.CacheControl = "no-store";
        try
        {
            var suggestions = await research.FindAsync(
                request.Query.Trim(),
                snapshot!.Find(destinationCity)!,
                context.RequestAborted
            );
            // Preview only: the ordinary stay replacement saves the user's accepted location.
            return Results.Ok(new { suggestions });
        }
        catch (Exception exception)
            when (exception
                    is HttpRequestException
                        or InvalidOperationException
                        or JsonException
                        or OperationCanceledException
                        or IOException
            )
        {
            context.RequestAborted.ThrowIfCancellationRequested();
            context
                .RequestServices.GetRequiredService<ILoggerFactory>()
                .CreateLogger("StayAddressResearch")
                .LogWarning(
                    "Stay address research unavailable ({FailureType})",
                    exception.GetType().Name
                );
            return Results.Problem(
                "Address search is unavailable. Please try again.",
                statusCode: 502
            );
        }
    }

    internal static async Task<IResult> GetStayLocation(
        Guid tripId,
        string destinationCity,
        Guid stayId,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        var (_, user, error) = await AuthorizeAsync(tripId, false, context, database, currentUser);
        if (error is not null)
        {
            return error;
        }

        var visits = await database.GetDestinationVisitsAsync(
            user!.Id,
            tripId,
            context.RequestAborted
        );
        if (!visits.Any(v => v.StayId == stayId && v.CityId == destinationCity))
        {
            return Results.NotFound();
        }
        var locations = await database.GetStayLocationsAsync(
            user!.Id,
            tripId,
            context.RequestAborted
        );
        return locations.TryGetValue(stayId, out var feature)
            ? GeoJson(feature)
            : Results.NotFound();
    }

    internal static async Task<IResult> SaveStayLocation(
        Guid tripId,
        string destinationCity,
        Guid stayId,
        StayLocationRequest request,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        var (_, user, error) = await AuthorizeAsync(tripId, true, context, database, currentUser);
        if (error is not null)
        {
            return error;
        }

        if (
            request.Type != "Feature"
            || request.Properties?.Name?.Trim() is not { Length: > 0 and <= 200 } name
            || request.Geometry is not { Type: "Point", Position: not null } point
            || !double.IsFinite(point.Position.Longitude)
            || !double.IsFinite(point.Position.Latitude)
            || Math.Abs(point.Position.Longitude) > 180
            || Math.Abs(point.Position.Latitude) > 90
        )
        {
            return Results.BadRequest(new { title = "Select a valid Stay location." });
        }

        var feature = new GeoJsonFeature<StayLocationProperties>(
            "Feature",
            stayId.ToString("D"),
            point,
            new(name)
        );
        return await database.SaveStayLocationAsync(
            user!.Id,
            tripId,
            destinationCity,
            stayId,
            feature,
            context.RequestAborted
        )
            ? GeoJson(feature)
            : Results.NotFound();
    }

    internal static async Task<IResult> DeleteStayLocation(
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
        {
            return error;
        }

        return await database.SaveStayLocationAsync(
            user!.Id,
            tripId,
            destinationCity,
            stayId,
            null,
            context.RequestAborted
        )
            ? Results.NoContent()
            : Results.NotFound();
    }

    internal static async Task<IResult> AddDestination(
        Guid tripId,
        CreateDestinationRequest request,
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

        if (
            request.Properties is null
            || !ValidDestination(
                request.Type,
                request.Geometry,
                request.Properties.Name,
                request.Properties.CountryCode,
                request.Properties.TimeZone,
                request.Properties.Constraints
            )
            || (
                request.Properties.ArrivalDate is not null
                && request.Properties.DepartureDate < request.Properties.ArrivalDate
            )
        )
        {
            return Results.BadRequest(
                new
                {
                    title = "Supply a destination Feature with a city name, country, valid Point coordinates, object constraints, and valid optional dates.",
                }
            );
        }

        var input = new DestinationVisitInput(
            request.Properties.Name,
            request.Properties.CountryCode,
            request.Properties.ArrivalDate,
            request.Properties.DepartureDate,
            request.Geometry!.Position.Longitude,
            request.Geometry.Position.Latitude,
            request.Properties.TimeZone,
            request.Properties.Constraints
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
        catch (DestinationDatesOverlapException exception)
        {
            return Results.Conflict(
                new { code = "destination_dates_overlap", title = exception.Message }
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

    private static bool ValidDestination(
        string? type,
        GeoJsonPoint? geometry,
        string? name,
        string? country,
        string? timeZone,
        JsonElement? constraints
    ) =>
        type == "Feature"
        && geometry is { Type: "Point", Position: not null }
        && double.IsFinite(geometry.Position.Longitude)
        && double.IsFinite(geometry.Position.Latitude)
        && Math.Abs(geometry.Position.Longitude) <= 180
        && Math.Abs(geometry.Position.Latitude) <= 90
        && !string.IsNullOrWhiteSpace(name)
        && name.Length <= 150
        && country is { Length: 2 }
        && country.All(char.IsAsciiLetter)
        && (timeZone is null || timeZone.Length <= 100)
        && ValidConstraints(constraints);

    private static bool ValidConstraints(JsonElement? constraints) =>
        new DestinationConstraintsAttribute().IsValid(constraints);

    internal static async Task<IResult> ReplaceDestination(
        Guid tripId,
        string destinationCity,
        ReplaceDestinationRequest request,
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

        if (
            (request.Id is not null && request.Id != destinationCity)
            || request.Properties is null
            || !ValidDestination(
                request.Type,
                request.Geometry,
                request.Properties.Name,
                request.Properties.CountryCode,
                request.Properties.TimeZone,
                request.Properties.Constraints
            )
        )
        {
            return Results.BadRequest(
                new { title = "Supply a valid destination Feature whose id matches the URL." }
            );
        }

        var place = new DestinationPlace(
            tripId,
            destinationCity,
            request.Properties.Name.Trim(),
            request.Properties.CountryCode.ToUpperInvariant(),
            request.Properties.TimeZone?.Trim() ?? "",
            request.Geometry!.Position.Longitude,
            request.Geometry.Position.Latitude
        )
        {
            Constraints =
                request.Properties.Constraints?.Clone()
                ?? JsonSerializer.SerializeToElement(new { }),
        };
        place = await service.ResolveTimeZoneAsync(place, context.RequestAborted);
        var saved = await database.ReplaceDestinationPlaceAsync(
            user!.Id,
            place,
            context.RequestAborted
        );
        if (saved is null)
        {
            return Results.NotFound();
        }

        var snapshot = await service.GetAsync(user.Id, trip!, context.RequestAborted);
        return GeoJson(snapshot.Find(destinationCity) ?? InactiveDestination(saved));
    }

    internal static async Task<IResult> DeleteDestination(
        Guid tripId,
        string destinationCity,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        var (_, user, error) = await AuthorizeAsync(tripId, true, context, database, currentUser);
        if (error is not null)
        {
            return error;
        }

        return await database.DeleteDestinationAsync(
            user!.Id,
            tripId,
            destinationCity,
            context.RequestAborted
        )
            ? Results.NoContent()
            : Results.NotFound();
    }

    internal static async Task<IResult> DeleteDestinationStay(
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
        {
            return error;
        }

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

    internal static async Task<IResult> ReplaceDestinationStay(
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
        {
            return error;
        }

        if (
            input.ArrivalDate is not null
            && input.DepartureDate is not null
            && input.DepartureDate < input.ArrivalDate
        )
        {
            return Results.BadRequest(
                new { title = "Departure date cannot precede arrival date." }
            );
        }

        DestinationVisit? saved;
        try
        {
            saved = await database.ReplaceDestinationVisitAsync(
                user!.Id,
                tripId,
                destinationCity,
                stayId,
                input,
                context.RequestAborted
            );
        }
        catch (DestinationDatesOverlapException exception)
        {
            return Results.Conflict(
                new { code = "destination_dates_overlap", title = exception.Message }
            );
        }
        if (saved is null)
        {
            return Results.NotFound();
        }

        var snapshot = await service.GetAsync(user.Id, trip!, context.RequestAborted);
        return GeoJson(snapshot.Find(destinationCity)!);
    }

    internal static async Task<IResult> GetDestinations(
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
        {
            return error;
        }

        var (snapshot, resolveError) = await ResolveAsync(user!.Id, trip!, null, service, context);
        if (snapshot is null && resolveError is not null && includeInactive != true)
        {
            return resolveError;
        }

        var active = snapshot?.Collection.Features ?? [];
        if (includeInactive != true)
        {
            return GeoJson(snapshot!.Collection);
        }

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

    internal static async Task<IResult> GetDestination(
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

        var (snapshot, resolveError) = await ResolveAsync(
            user!.Id,
            trip!,
            destinationCity,
            service,
            context
        );
        if (resolveError is null)
        {
            return GeoJson(snapshot!.Find(destinationCity)!);
        }

        DestinationPlace? place = await database.GetDestinationPlaceAsync(
            user.Id,
            tripId,
            destinationCity,
            context.RequestAborted
        );
        return place is null ? resolveError : GeoJson(InactiveDestination(place));
    }
}
