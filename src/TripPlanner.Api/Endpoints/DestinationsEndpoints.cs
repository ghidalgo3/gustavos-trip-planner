using System.Text.Json;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services;
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
            .MapGet("/{destinationCity}/stay", GetStayLocation)
            .WithName("GetDestinationStayLocation");
        destinations
            .MapPut("/{destinationCity}/stay", SaveStayLocation)
            .WithName("SaveDestinationStayLocation");
        destinations
            .MapDelete("/{destinationCity}/stay", DeleteStayLocation)
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

    private static async Task<IResult> GetStayLocation(
        Guid tripId,
        string destinationCity,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        var (_, user, error) = await AuthorizeAsync(tripId, false, context, database, currentUser);
        if (error is not null)
            return error;
        var locations = await database.GetStayLocationsAsync(
            user!.Id,
            tripId,
            context.RequestAborted
        );
        return locations.TryGetValue(destinationCity, out var feature)
            ? GeoJson(feature)
            : Results.NotFound();
    }

    private static async Task<IResult> SaveStayLocation(
        Guid tripId,
        string destinationCity,
        StayLocationRequest request,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        var (_, user, error) = await AuthorizeAsync(tripId, true, context, database, currentUser);
        if (error is not null)
            return error;
        if (
            request.Type != "Feature"
            || request.Properties?.Name?.Trim() is not { Length: > 0 and <= 200 } name
            || request.Geometry is not { Type: "Point", Coordinates.Length: 2 } point
            || !double.IsFinite(point.Coordinates[0])
            || !double.IsFinite(point.Coordinates[1])
            || Math.Abs(point.Coordinates[0]) > 180
            || Math.Abs(point.Coordinates[1]) > 90
        )
            return Results.BadRequest(new { title = "Select a valid Stay location." });
        var feature = new GeoJsonFeature<StayLocationProperties>(
            "Feature",
            "stay",
            point,
            new(name)
        );
        return await database.SaveStayLocationAsync(
            user!.Id,
            tripId,
            destinationCity,
            feature,
            context.RequestAborted
        )
            ? GeoJson(feature)
            : Results.NotFound();
    }

    private static async Task<IResult> DeleteStayLocation(
        Guid tripId,
        string destinationCity,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        var (_, user, error) = await AuthorizeAsync(tripId, true, context, database, currentUser);
        if (error is not null)
            return error;
        return await database.SaveStayLocationAsync(
            user!.Id,
            tripId,
            destinationCity,
            null,
            context.RequestAborted
        )
            ? Results.NoContent()
            : Results.NotFound();
    }

    private static async Task<IResult> AddDestination(
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
            return error;
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
            return Results.BadRequest(
                new
                {
                    title = "Supply a destination Feature with a city name, country, valid Point coordinates, object constraints, and valid optional dates.",
                }
            );
        var input = new DestinationVisitInput(
            request.Properties.Name,
            request.Properties.CountryCode,
            request.Properties.ArrivalDate,
            request.Properties.DepartureDate,
            request.Geometry!.Coordinates[0],
            request.Geometry.Coordinates[1],
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
        && geometry is { Type: "Point", Coordinates: { Length: 2 } }
        && geometry.Coordinates.All(double.IsFinite)
        && Math.Abs(geometry.Coordinates[0]) <= 180
        && Math.Abs(geometry.Coordinates[1]) <= 90
        && !string.IsNullOrWhiteSpace(name)
        && name.Length <= 150
        && country is { Length: 2 }
        && country.All(char.IsAsciiLetter)
        && (timeZone is null || timeZone.Length <= 100)
        && ValidConstraints(constraints);

    private static bool ValidConstraints(JsonElement? constraints)
    {
        if (constraints is null)
            return true;
        if (constraints.Value.ValueKind != JsonValueKind.Object)
            return false;
        foreach (string key in new[] { "arrivalFlexibilityDays", "departureFlexibilityDays" })
            if (
                constraints.Value.TryGetProperty(key, out var value)
                && (
                    value.ValueKind != JsonValueKind.Number
                    || !value.TryGetInt32(out int days)
                    || days is < 0 or > 5
                )
            )
                return false;
        return !constraints.Value.TryGetProperty("keepAfterPrevious", out var order)
            || order.ValueKind is JsonValueKind.True or JsonValueKind.False;
    }

    private static async Task<IResult> ReplaceDestination(
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
            return error;
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
            return Results.BadRequest(
                new { title = "Supply a valid destination Feature whose id matches the URL." }
            );
        var place = new DestinationPlace(
            tripId,
            destinationCity,
            request.Properties.Name.Trim(),
            request.Properties.CountryCode.ToUpperInvariant(),
            request.Properties.TimeZone?.Trim() ?? "",
            request.Geometry!.Coordinates[0],
            request.Geometry.Coordinates[1]
        )
        {
            Constraints =
                request.Properties.Constraints?.Clone()
                ?? JsonSerializer.SerializeToElement(new { }),
        };
        var saved = await database.ReplaceDestinationPlaceAsync(
            user!.Id,
            place,
            context.RequestAborted
        );
        if (saved is null)
            return Results.NotFound();
        var snapshot = await service.GetAsync(user.Id, trip!, context.RequestAborted);
        return GeoJson(snapshot.Find(destinationCity) ?? InactiveDestination(saved));
    }

    private static async Task<IResult> DeleteDestination(
        Guid tripId,
        string destinationCity,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        var (_, user, error) = await AuthorizeAsync(tripId, true, context, database, currentUser);
        if (error is not null)
            return error;
        return await database.DeleteDestinationAsync(
            user!.Id,
            tripId,
            destinationCity,
            context.RequestAborted
        )
            ? Results.NoContent()
            : Results.NotFound();
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
}
