using System.Text.Json;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Flights;

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
        choices
            .MapPost("/{partyId:guid}/bookingLinks", GetChoiceBookingLinks)
            .WithName("GetFlightChoiceBookingLinks");
    }

    private static async Task<IResult> GetFlightChoices(
        Guid tripId,
        HttpContext context,
        IPlannerDb database,
        DestinationFlightPlanning flightPlanning,
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
        {
            return error;
        }

        var trip = await database.GetVisibleTripAsync(user!.Id, tripId, context.RequestAborted);
        if (trip is null)
        {
            return Results.NotFound();
        }

        var document = await flightPlanning.GetAsync(user.Id, trip, context.RequestAborted);
        var parties = await database.GetPartiesAsync(user.Id, tripId, context.RequestAborted);
        return Results.Ok(
            (await database.GetFlightChoicesAsync(user.Id, tripId, context.RequestAborted)).Select(
                choice =>
                    ChoiceDto(
                        choice,
                        document,
                        parties.FirstOrDefault(p => p.Id == choice.PartyId),
                        routes
                    )
            )
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
        RouteFareComposer routes,
        DestinationFlightPlanning flightPlanning,
        ICurrentUser currentUser
    )
    {
        var (user, error) = await EndpointAuthorization.AuthorizeCurrentUserAsync(
            context,
            database,
            currentUser.Profile!
        );
        if (error is not null)
        {
            return error;
        }

        var trip = await database.GetTripAsync(user!.Id, tripId, context.RequestAborted);
        if (trip is null)
        {
            return Results.NotFound();
        }

        var parties = await database.GetPartiesAsync(user.Id, tripId, context.RequestAborted);
        if (!parties.Any(p => p.Id == partyId))
        {
            return Results.NotFound();
        }

        var document = await flightPlanning.GetAsync(user!.Id, trip, context.RequestAborted);
        var keys = request.LegKeys;
        if (
            keys is null
            || keys.Length > document.Visits.Length + 1
            || keys.Any(key =>
                key is not null && (string.IsNullOrWhiteSpace(key) || key.Length > 4096)
            )
        )
        {
            return Results.BadRequest(
                new { title = "Provide a valid flight choice for each selected leg." }
            );
        }

        keys = keys.Reverse().SkipWhile(key => key is null).Reverse().ToArray();
        var previous = (
            await database.GetFlightChoicesAsync(user.Id, tripId, context.RequestAborted)
        ).FirstOrDefault(choice => choice.PartyId == partyId);
        if (request.PurchasedOfferIds is not null && !(previous?.LegKeys ?? []).SequenceEqual(keys))
        {
            return Results.Conflict(
                new { title = "Flight selections changed. Reload before updating purchases." }
            );
        }
        IReadOnlyList<FareSearchResult> fares = [];
        if (keys.Length > 0)
        {
            var preview = planner.Build(document, parties, context.RequestAborted);
            if (!preview.Ready)
            {
                return Results.Conflict(
                    new { title = "The trip's current planning details need attention." }
                );
            }

            fares =
                await database.GetFareSearchResultsAsync(
                    user.Id,
                    tripId,
                    preview,
                    context.RequestAborted
                ) ?? [];
            fares = SavedFlightChoices.Restore(
                fares,
                await database.GetFlightChoicesAsync(user.Id, tripId, context.RequestAborted),
                preview
            );
        }
        var nextOrigins = FlightChoiceRoute.NextOrigins(document, partyId, keys, fares, airports);
        if (nextOrigins is null)
        {
            return Results.BadRequest(
                new
                {
                    title = "This flight is no longer available in the current search or does not follow the trip's destination order. Refresh the flight results and choose again.",
                }
            );
        }

        var choice = new FlightChoiceProgress(partyId, keys, nextOrigins)
        {
            SavedFares = SavedFlightChoices.Capture(partyId, keys, fares),
        };
        var bookings = routes.ChoiceBookings(
            document,
            parties.Single(p => p.Id == partyId),
            choice
        );
        var purchased =
            request.PurchasedOfferIds
            ?? (previous?.PurchasedOfferIds ?? [])
                .Where(id => bookings.Any(booking => booking.IgnavId == id))
                .ToArray();
        if (
            purchased.Any(id => !bookings.Any(booking => booking.IgnavId == id))
            || bookings
                .Where(booking => purchased.Contains(booking.IgnavId))
                .SelectMany(booking => booking.LegIndexes)
                .GroupBy(index => index)
                .Any(group => group.Count() > 1)
        )
        {
            return Results.BadRequest(
                new
                {
                    title = "Purchases must cover selected flights using non-overlapping whole bookings.",
                }
            );
        }
        var saved = await database.SetFlightChoicesAsync(
            user.Id,
            tripId,
            choice with
            {
                PurchasedOfferIds = purchased.Distinct().ToArray(),
            },
            context.RequestAborted
        );
        var selected = (
            await database.GetSelectedFlightsAsync(user.Id, tripId, context.RequestAborted)
        ).FirstOrDefault(flight => flight.PartyId == partyId);
        // Choosing every leg is enough to save a complete itinerary. Other features
        // consume this resource, so they must not depend on a separate UI review step.
        FareSearchResult? completeFare = null;
        int completeIndex = -1;
        if (
            document.Visits.Length > 0
            && keys.Length == document.Visits.Length + 1
            && keys.All(key => key is not null)
        )
        {
            foreach (
                var fare in routes.Compose(
                    document,
                    [parties.Single(p => p.Id == partyId)],
                    fares,
                    [saved]
                )
            )
            {
                var itineraries = fare.Response.GetProperty("itineraries");
                for (int index = 0; index < itineraries.GetArrayLength(); index++)
                {
                    if (
                        itineraries[index]
                            .GetProperty("legs")
                            .EnumerateArray()
                            .Select(FlightChoiceRoute.FlightKey)
                            .SequenceEqual(keys)
                    )
                    {
                        completeFare = fare;
                        completeIndex = index;
                        break;
                    }
                }
                if (completeFare is not null)
                {
                    break;
                }
            }
        }
        if (completeFare is not null)
        {
            var itinerary = completeFare.Response.GetProperty("itineraries")[completeIndex].Clone();
            bool sameFlights =
                selected is not null
                && selected.Itinerary.TryGetProperty("legs", out var selectedLegs)
                && selectedLegs
                    .EnumerateArray()
                    .Select(FlightChoiceRoute.FlightKey)
                    .SequenceEqual(keys);
            await database.SetSelectedFlightAsync(
                user.Id,
                new SelectedFlight(
                    tripId,
                    partyId,
                    completeFare.CacheKey,
                    completeIndex,
                    completeFare.Request,
                    itinerary,
                    sameFlights ? selected!.SelectedAt : DateTimeOffset.UtcNow,
                    PurchaseFlags(itinerary, saved.PurchasedOfferIds)
                ),
                context.RequestAborted
            );
        }
        else if (selected is not null)
        {
            // A changed or incomplete choice must not leave an old route active.
            await database.DeleteSelectedFlightAsync(
                user.Id,
                tripId,
                partyId,
                context.RequestAborted
            );
        }
        return Results.Ok(ChoiceDto(saved, document, parties.Single(p => p.Id == partyId), routes));
    }

    private static FlightChoiceProgressDto ChoiceDto(
        FlightChoiceProgress choice,
        PlanningDocument document,
        Party? party,
        RouteFareComposer routes
    ) =>
        new(choice.PartyId, choice.LegKeys, choice.NextOrigins)
        {
            Flights = SavedFlightChoices.SelectedLegs(choice),
            PurchasedOfferIds = choice.PurchasedOfferIds,
            Bookings = party is null ? [] : routes.ChoiceBookings(document, party, choice),
        };

    private static async Task<IResult> GetChoiceBookingLinks(
        Guid tripId,
        Guid partyId,
        BookingLinksRequest request,
        HttpContext context,
        IPlannerDb database,
        DestinationFlightPlanning flightPlanning,
        RouteFareComposer routes,
        IIgnavClient ignav,
        ICurrentUser currentUser
    )
    {
        var (user, error) = await EndpointAuthorization.AuthorizeCurrentUserAsync(
            context,
            database,
            currentUser.Profile!
        );
        if (error is not null)
        {
            return error;
        }
        var trip = await database.GetTripAsync(user!.Id, tripId, context.RequestAborted);
        if (trip is null)
        {
            return Results.NotFound();
        }
        var party = (
            await database.GetPartiesAsync(user.Id, tripId, context.RequestAborted)
        ).FirstOrDefault(p => p.Id == partyId);
        var choice = (
            await database.GetFlightChoicesAsync(user.Id, tripId, context.RequestAborted)
        ).FirstOrDefault(c => c.PartyId == partyId);
        if (party is null || choice is null)
        {
            return Results.NotFound();
        }
        var document = await flightPlanning.GetAsync(user.Id, trip, context.RequestAborted);
        if (
            !routes
                .ChoiceBookings(document, party, choice)
                .Any(booking => booking.IgnavId == request.IgnavId)
        )
        {
            return Results.Conflict(
                new { title = "Select every flight in this booking before requesting its link." }
            );
        }
        return Results.Ok(
            await ignav.GetBookingLinksAsync(request.IgnavId, context.RequestAborted)
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
        {
            return error;
        }

        if (await database.GetVisibleTripAsync(user!.Id, tripId, context.RequestAborted) is null)
        {
            return Results.NotFound();
        }

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
        DestinationFlightPlanning flightPlanning,
        ICurrentUser currentUser
    )
    {
        var (user, error) = await EndpointAuthorization.AuthorizeCurrentUserAsync(
            context,
            database,
            currentUser.Profile!
        );
        if (error is not null)
        {
            return error;
        }

        if (string.IsNullOrWhiteSpace(request.CacheKey) || request.ItineraryIndex is null or < 0)
        {
            return Results.BadRequest(
                new { title = "A fare cache key and nonnegative itinerary index are required." }
            );
        }

        int index = request.ItineraryIndex.Value;
        if (
            request.LegKeys is { } keys
            && (
                keys.Length < 1
                || keys.Any(key => string.IsNullOrWhiteSpace(key) || key.Length > 4096)
                || request.PriceAmount is null or < 0
                || request.PriceCurrency is not { Length: 3 }
            )
        )
        {
            return Results.BadRequest(
                new { title = "Supply valid flight identifiers and the displayed itinerary price." }
            );
        }

        Trip? trip = await database.GetTripAsync(user!.Id, tripId, context.RequestAborted);
        if (trip is null)
        {
            return Results.NotFound();
        }

        var parties = await database.GetPartiesAsync(user.Id, tripId, context.RequestAborted);
        Party? party = parties.SingleOrDefault(p => p.Id == partyId);
        if (party is null)
        {
            return Results.NotFound();
        }

        var document = await flightPlanning.GetAsync(user!.Id, trip, context.RequestAborted);
        var preview = planner.Build(document, parties, context.RequestAborted);
        if (!preview.Ready)
        {
            return Results.Conflict(
                new { title = "The trip's current planning details need attention." }
            );
        }

        var fares = await database.GetFareSearchResultsAsync(
            user.Id,
            tripId,
            preview,
            context.RequestAborted
        );
        var choices = await database.GetFlightChoicesAsync(user.Id, tripId, context.RequestAborted);
        if (document.Visits.Length > 0)
        {
            fares = SavedFlightChoices.Restore(fares, choices, preview);
        }
        if (fares is null || fares.Count == 0)
        {
            return Results.Conflict(
                new
                {
                    title = "Flight results have expired. Find flights again before selecting one.",
                }
            );
        }

        fares = routes.Compose(document, parties, fares, choices);
        FareSearchResult? fare = fares.SingleOrDefault(f =>
            f.PartyId == partyId && f.CacheKey == request.CacheKey
        );
        if (request.LegKeys is not null)
        {
            // More results can arrive between displaying and saving a composed route.
            // Resolve the displayed flights and quote against current validated server data.
            fare = null;
            foreach (var candidate in fares.Where(item => item.PartyId == partyId))
            {
                if (
                    !candidate.Response.TryGetProperty("itineraries", out var options)
                    || options.ValueKind != JsonValueKind.Array
                )
                {
                    continue;
                }

                for (int currentIndex = 0; currentIndex < options.GetArrayLength(); currentIndex++)
                {
                    if (!MatchesDisplayedItinerary(options[currentIndex], request))
                    {
                        continue;
                    }

                    fare = candidate;
                    index = currentIndex;
                    break;
                }
                if (fare is not null)
                {
                    break;
                }
            }
            if (fare is null)
            {
                return Results.Conflict(
                    new
                    {
                        title = "These flights or their price changed. Review the current results and save again.",
                    }
                );
            }
        }
        if (fare is null)
        {
            return Results.NotFound();
        }

        if (
            fare.Response.ValueKind != JsonValueKind.Object
            || !fare.Response.TryGetProperty("itineraries", out var itineraries)
            || itineraries.ValueKind != JsonValueKind.Array
            || index >= itineraries.GetArrayLength()
        )
        {
            return Results.NotFound();
        }

        var evaluation = validator.Evaluate(fare, document, party)[index];
        if (evaluation.Status != "Eligible")
        {
            return Results.Conflict(
                new
                {
                    title = "This flight does not meet the current trip requirements.",
                    issues = evaluation.Issues,
                }
            );
        }

        var selected = new SelectedFlight(
            tripId,
            partyId,
            fare.CacheKey,
            index,
            fare.Request,
            itineraries[index].Clone(),
            DateTimeOffset.UtcNow,
            PurchaseFlags(
                itineraries[index],
                choices.FirstOrDefault(choice => choice.PartyId == partyId)?.PurchasedOfferIds ?? []
            )
        );
        return Results.Ok(
            await database.SetSelectedFlightAsync(user.Id, selected, context.RequestAborted)
        );
    }

    private static bool[] PurchaseFlags(JsonElement itinerary, string[] purchasedIds)
    {
        var flags = new bool[CountFlightLegs(itinerary)];
        if (itinerary.TryGetProperty("bookingOffers", out var offers))
        {
            foreach (
                var offer in offers
                    .EnumerateArray()
                    .Where(offer => purchasedIds.Contains(offer.GetProperty("ignavId").GetString()))
            )
            {
                foreach (
                    var index in offer
                        .GetProperty("legIndexes")
                        .EnumerateArray()
                        .Select(value => value.GetInt32())
                )
                {
                    flags[index] = true;
                }
            }
        }
        return flags;
    }

    private static bool MatchesDisplayedItinerary(
        JsonElement itinerary,
        SelectFlightRequest request
    ) =>
        itinerary.TryGetProperty("legs", out var legs)
        && legs.ValueKind == JsonValueKind.Array
        && legs.GetArrayLength() == request.LegKeys!.Length
        && legs.EnumerateArray().Select(FlightChoiceRoute.FlightKey).SequenceEqual(request.LegKeys)
        && itinerary.TryGetProperty("price", out var price)
        && price.ValueKind == JsonValueKind.Object
        && price.TryGetProperty("amount", out var amount)
        && amount.ValueKind == JsonValueKind.Number
        && amount.TryGetDecimal(out decimal value)
        && value == request.PriceAmount
        && price.TryGetProperty("currency", out var currency)
        && currency.ValueKind == JsonValueKind.String
        && string.Equals(
            currency.GetString(),
            request.PriceCurrency,
            StringComparison.OrdinalIgnoreCase
        );

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
        {
            return error;
        }

        if (await database.GetTripAsync(user!.Id, tripId, context.RequestAborted) is null)
        {
            return Results.NotFound();
        }

        var selected = (
            await database.GetSelectedFlightsAsync(user.Id, tripId, context.RequestAborted)
        ).SingleOrDefault(flight => flight.PartyId == partyId);
        if (selected is null)
        {
            return Results.NotFound();
        }

        if (
            selected.CacheKey != request.CacheKey
            || selected.ItineraryIndex != request.ItineraryIndex
        )
        {
            return Results.Conflict(
                new
                {
                    title = "The selected itinerary changed. Reload it before updating purchases.",
                }
            );
        }

        if (
            request.PurchasedLegs is null
            || request.PurchasedLegs.Length != CountFlightLegs(selected.Itinerary)
        )
        {
            return Results.BadRequest(
                new
                {
                    title = "Supply one purchase status for every flight in the selected itinerary.",
                }
            );
        }

        var statuses = request.PurchasedLegs.ToArray();
        if (selected.Itinerary.TryGetProperty("bookingOffers", out var offers))
        {
            foreach (var offer in offers.EnumerateArray())
            {
                var indexes = offer
                    .GetProperty("legIndexes")
                    .EnumerateArray()
                    .Select(index => index.GetInt32())
                    .ToArray();
                var changes = indexes
                    .Where(index =>
                        statuses[index]
                        != (selected.PurchasedLegs?.ElementAtOrDefault(index) ?? false)
                    )
                    .Select(index => statuses[index])
                    .Distinct()
                    .ToArray();
                if (changes.Length > 1)
                {
                    return Results.BadRequest(
                        new
                        {
                            title = "Flights sharing a booking must share their purchase status.",
                        }
                    );
                }
                if (changes.Length == 1)
                {
                    foreach (var index in indexes)
                    {
                        statuses[index] = changes[0];
                    }
                }
            }
            var choice = (
                await database.GetFlightChoicesAsync(user.Id, tripId, context.RequestAborted)
            ).FirstOrDefault(choice => choice.PartyId == partyId);
            if (
                choice is not null
                && selected
                    .Itinerary.GetProperty("legs")
                    .EnumerateArray()
                    .Select(FlightChoiceRoute.FlightKey)
                    .SequenceEqual(choice.LegKeys)
            )
            {
                var purchased = offers
                    .EnumerateArray()
                    .Where(offer =>
                        offer
                            .GetProperty("legIndexes")
                            .EnumerateArray()
                            .All(index => statuses[index.GetInt32()])
                    )
                    .Select(offer => offer.GetProperty("ignavId").GetString()!)
                    .ToArray();
                await database.SetFlightChoicesAsync(
                    user.Id,
                    tripId,
                    choice with
                    {
                        PurchasedOfferIds = purchased,
                    },
                    context.RequestAborted
                );
            }
        }
        return Results.Ok(
            await database.SetSelectedFlightAsync(
                user.Id,
                selected with
                {
                    PurchasedLegs = statuses,
                },
                context.RequestAborted
            )
        );
    }

    private static int CountFlightLegs(JsonElement itinerary)
    {
        if (itinerary.ValueKind != JsonValueKind.Object)
        {
            return 0;
        }

        if (itinerary.TryGetProperty("legs", out var legs) && legs.ValueKind == JsonValueKind.Array)
        {
            return legs.GetArrayLength();
        }

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
        {
            return error;
        }

        if (await database.GetTripAsync(user!.Id, tripId, context.RequestAborted) is null)
        {
            return Results.NotFound();
        }

        if (
            !(await database.GetPartiesAsync(user.Id, tripId, context.RequestAborted)).Any(p =>
                p.Id == partyId
            )
        )
        {
            return Results.NotFound();
        }

        await database.DeleteSelectedFlightAsync(user.Id, tripId, partyId, context.RequestAborted);
        return Results.NoContent();
    }
}
