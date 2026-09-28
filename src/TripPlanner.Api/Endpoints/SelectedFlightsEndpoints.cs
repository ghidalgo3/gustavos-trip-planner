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
        var flights = api.MapGroup("/trips/{tripId:guid}/selectedFlights")
            .WithTags("Selected Flights")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        flights.MapGet("/", GetSelectedFlights);
        flights.MapPut("/{partyId:guid}", SelectFlight);
        flights.MapPut("/{partyId:guid}/purchases", SetPurchases);
        flights.MapDelete("/{partyId:guid}", DeselectFlight);
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
        return Results.Ok(
            await database.GetSelectedFlightsAsync(user.Id, tripId, context.RequestAborted)
        );
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

        var document = PlanningDocument.FromJson(trip.Constraints);
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
        fares = routes.Compose(document, parties, fares);
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
