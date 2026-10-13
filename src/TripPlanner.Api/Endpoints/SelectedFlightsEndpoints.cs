using System.Text.Json;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services;

namespace TripPlanner.Api.Endpoints;

public static class SelectedFlightsEndpoints
{
    public static void MapSelectedFlightsEndpoints(this RouteGroupBuilder api)
    {
        var flights = api.MapGroup("/trips/{tripId:guid}/flights")
            .WithTags("Flights")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        flights.MapGet("", GetSelectedFlights).WithName("GetTripFlights");
        flights.MapPut("/{partyId:guid}", SelectFlight).WithName("SelectTripFlight");
        flights
            .MapPut("/{partyId:guid}/purchases", SetPurchases)
            .WithName("SetTripFlightPurchases");
        flights.MapDelete("/{partyId:guid}", DeselectFlight).WithName("DeselectTripFlight");
        var choices = api.MapGroup("/trips/{tripId:guid}/flights/choices")
            .WithTags("Flights")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        choices.MapGet("", GetFlightChoices).WithName("GetFlightChoices");
        choices.MapPut("/{partyId:guid}", SetFlightChoices).WithName("SetFlightChoices");
    }

    private static async Task<IResult> GetFlightChoices(
        Guid tripId,
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
            return error;
        if (await database.GetVisibleTripAsync(user!.Id, tripId, context.RequestAborted) is null)
            return Results.NotFound();
        return Results.Ok(
            await database.GetFlightChoicesAsync(user.Id, tripId, context.RequestAborted)
        );
    }

    private static async Task<IResult> SetFlightChoices(
        Guid tripId,
        Guid partyId,
        SetFlightChoicesRequest request,
        HttpContext context,
        IPlannerDb database,
        ISearchPlanBuilder planner,
        AirportCatalog airports,
        ICurrentUser currentUser
    )
    {
        var (user, error) = await EndpointAuthorization.AuthorizeCurrentUserAsync(
            context,
            database,
            currentUser.Profile!
        );
        if (error is not null)
            return error;
        var trip = await database.GetTripAsync(user!.Id, tripId, context.RequestAborted);
        if (trip is null)
            return Results.NotFound();
        var parties = await database.GetPartiesAsync(user.Id, tripId, context.RequestAborted);
        if (!parties.Any(p => p.Id == partyId))
            return Results.NotFound();
        var document = PlanningDocument.FromJson(trip.FlightConstraints);
        var keys = request.LegKeys;
        if (
            keys is null
            || keys.Length > document.Visits.Length + 1
            || keys.Any(key => string.IsNullOrWhiteSpace(key) || key.Length > 4096)
        )
            return Results.BadRequest(
                new { title = "Provide a valid flight choice for each selected leg." }
            );
        IReadOnlyList<FareSearchResult> fares = [];
        if (keys.Length > 0)
        {
            var preview = planner.Build(document, parties, context.RequestAborted);
            if (!preview.Ready)
                return Results.Conflict(
                    new { title = "The trip's current planning details need attention." }
                );
            fares =
                await database.GetFareSearchResultsAsync(
                    user.Id,
                    tripId,
                    preview,
                    context.RequestAborted
                ) ?? [];
        }
        var nextOrigins = FlightChoiceRoute.NextOrigins(document, partyId, keys, fares, airports);
        if (nextOrigins is null)
            return Results.BadRequest(
                new
                {
                    title = "This flight is no longer available in the current search or does not follow the trip's destination order. Refresh the flight results and choose again.",
                }
            );
        return Results.Ok(
            await database.SetFlightChoicesAsync(
                user.Id,
                tripId,
                new(partyId, keys, nextOrigins),
                context.RequestAborted
            )
        );
    }

    private static async Task<IResult> GetSelectedFlights(
        Guid tripId,
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
            return error;
        if (await database.GetVisibleTripAsync(user!.Id, tripId, context.RequestAborted) is null)
            return Results.NotFound();
        IReadOnlyList<SelectedFlight> selected = await database.GetSelectedFlightsAsync(
            user.Id,
            tripId,
            context.RequestAborted
        );
        return selected.Count == 0 ? Results.NoContent() : Results.Ok(selected);
    }

    private static async Task<IResult> SelectFlight(
        Guid tripId,
        Guid partyId,
        SelectFlightRequest request,
        HttpContext context,
        IPlannerDb database,
        ISearchPlanBuilder planner,
        FareValidator validator,
        RouteFareComposer routes,
        ICurrentUser currentUser
    )
    {
        var (user, error) = await EndpointAuthorization.AuthorizeCurrentUserAsync(
            context,
            database,
            currentUser.Profile!
        );
        if (error is not null)
            return error;
        if (string.IsNullOrWhiteSpace(request.CacheKey) || request.ItineraryIndex is null or < 0)
            return Results.BadRequest(
                new { title = "A fare cache key and nonnegative itinerary index are required." }
            );
        int index = request.ItineraryIndex.Value;
        Trip? trip = await database.GetTripAsync(user!.Id, tripId, context.RequestAborted);
        if (trip is null)
            return Results.NotFound();
        var parties = await database.GetPartiesAsync(user.Id, tripId, context.RequestAborted);
        Party? party = parties.SingleOrDefault(p => p.Id == partyId);
        if (party is null)
            return Results.NotFound();

        var document = PlanningDocument.FromJson(trip.FlightConstraints);
        var preview = planner.Build(document, parties, context.RequestAborted);
        if (!preview.Ready)
            return Results.Conflict(
                new { title = "The trip's current planning details need attention." }
            );
        var fares = await database.GetFareSearchResultsAsync(
            user.Id,
            tripId,
            preview,
            context.RequestAborted
        );
        if (fares is null)
            return Results.Conflict(
                new
                {
                    title = "Flight results have expired. Find flights again before selecting one.",
                }
            );
        fares = routes.Compose(
            document,
            parties,
            fares,
            await database.GetFlightChoicesAsync(user.Id, tripId, context.RequestAborted)
        );
        FareSearchResult? fare = fares.SingleOrDefault(f =>
            f.PartyId == partyId && f.CacheKey == request.CacheKey
        );
        if (fare is null)
            return Results.NotFound();
        if (
            fare.Response.ValueKind != JsonValueKind.Object
            || !fare.Response.TryGetProperty("itineraries", out var itineraries)
            || itineraries.ValueKind != JsonValueKind.Array
            || index >= itineraries.GetArrayLength()
        )
            return Results.NotFound();
        var evaluation = validator.Evaluate(fare, document, party)[index];
        if (evaluation.Status != "Eligible")
            return Results.Conflict(
                new
                {
                    title = "This flight does not meet the current trip requirements.",
                    issues = evaluation.Issues,
                }
            );

        var selected = new SelectedFlight(
            tripId,
            partyId,
            fare.CacheKey,
            index,
            fare.Request,
            itineraries[index].Clone(),
            DateTimeOffset.UtcNow,
            new bool[CountFlightLegs(itineraries[index])]
        );
        return Results.Ok(
            await database.SetSelectedFlightAsync(user.Id, selected, context.RequestAborted)
        );
    }

    private static async Task<IResult> SetPurchases(
        Guid tripId,
        Guid partyId,
        SetFlightPurchasesRequest request,
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
            return error;
        if (await database.GetTripAsync(user!.Id, tripId, context.RequestAborted) is null)
            return Results.NotFound();
        var selected = (
            await database.GetSelectedFlightsAsync(user.Id, tripId, context.RequestAborted)
        ).SingleOrDefault(flight => flight.PartyId == partyId);
        if (selected is null)
            return Results.NotFound();
        if (
            selected.CacheKey != request.CacheKey
            || selected.ItineraryIndex != request.ItineraryIndex
        )
            return Results.Conflict(
                new
                {
                    title = "The selected itinerary changed. Reload it before updating purchases.",
                }
            );
        if (
            request.PurchasedLegs is null
            || request.PurchasedLegs.Length != CountFlightLegs(selected.Itinerary)
        )
            return Results.BadRequest(
                new
                {
                    title = "Supply one purchase status for every flight in the selected itinerary.",
                }
            );
        return Results.Ok(
            await database.SetSelectedFlightAsync(
                user.Id,
                selected with
                {
                    PurchasedLegs = request.PurchasedLegs,
                },
                context.RequestAborted
            )
        );
    }

    private static int CountFlightLegs(JsonElement itinerary)
    {
        if (itinerary.ValueKind != JsonValueKind.Object)
            return 0;
        if (itinerary.TryGetProperty("legs", out var legs) && legs.ValueKind == JsonValueKind.Array)
            return legs.GetArrayLength();
        var count =
            itinerary.TryGetProperty("outbound", out var outbound)
            && outbound.ValueKind == JsonValueKind.Object
                ? 1
                : 0;
        return count
            + (
                itinerary.TryGetProperty("inbound", out var inbound)
                && inbound.ValueKind == JsonValueKind.Object
                    ? 1
                    : 0
            );
    }

    private static async Task<IResult> DeselectFlight(
        Guid tripId,
        Guid partyId,
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
            return error;
        if (await database.GetTripAsync(user!.Id, tripId, context.RequestAborted) is null)
            return Results.NotFound();
        if (
            !(await database.GetPartiesAsync(user.Id, tripId, context.RequestAborted)).Any(p =>
                p.Id == partyId
            )
        )
            return Results.NotFound();
        await database.DeleteSelectedFlightAsync(user.Id, tripId, partyId, context.RequestAborted);
        return Results.NoContent();
    }
}
