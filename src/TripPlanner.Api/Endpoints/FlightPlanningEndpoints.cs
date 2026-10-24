using System.Text.Json;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Flights;

namespace TripPlanner.Api.Endpoints;

public static class FlightPlanningEndpoints
{
    public static void MapFlightPlanningEndpoints(this RouteGroupBuilder api)
    {
        var flightConstraints = api.MapGroup("/trips/{tripId:guid}/flights/constraints")
            .WithTags("Flights")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        flightConstraints.MapGet("", GetConstraints).WithName("GetTripFlightConstraints");
        flightConstraints.MapPut("", SaveConstraints).WithName("SaveTripFlightConstraints");

        api.MapPost("/trips/{tripId:guid}/flights:search", StartFlightSearch)
            .WithName("StartTripFlightSearch")
            .WithTags("Flights")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        api.MapGet("/trips/{tripId:guid}/flights/search", GetFlightSearch)
            .WithName("GetTripFlightSearch")
            .WithTags("Flights")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        api.MapPost("/trips/{tripId:guid}/flights/search/{cacheKey}/bookingLinks", GetBookingLinks)
            .WithName("GetFlightBookingLinks")
            .WithTags("Flights")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
    }

    private static async Task<IResult> GetConstraints(
        Guid tripId,
        HttpContext context,
        IPlannerDb database,
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

        Trip? trip = await database.GetVisibleTripAsync(user!.Id, tripId, context.RequestAborted);
        if (trip is null)
        {
            return Results.NotFound();
        }

        return Results.Ok(await flightPlanning.GetAsync(user!.Id, trip, context.RequestAborted));
    }

    private static async Task<IResult> SaveConstraints(
        Guid tripId,
        PlanningDocument document,
        HttpContext context,
        IPlannerDb database,
        ISearchPlanBuilder planner,
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

        var parties = await database.GetPartiesAsync(user.Id, tripId, context.RequestAborted);
        var issues = planner.Validate(document, parties, false);
        if (issues.Count > 0)
        {
            return Results.BadRequest(new { title = "Check the constraint definitions.", issues });
        }

        Trip? updated = await database.SetFlightConstraintsAsync(
            user.Id,
            tripId,
            JsonSerializer.SerializeToElement(document, JsonSerializerOptions.Web),
            context.RequestAborted
        );
        return updated is null
            ? Results.NotFound()
            : Results.Ok(PlanningDocument.FromJson(updated.FlightConstraints));
    }

    private static async Task<IResult> StartFlightSearch(
        Guid tripId,
        StartFlightSearchRequest request,
        HttpContext context,
        IPlannerDb database,
        ISearchPlanBuilder planner,
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

        Trip? trip = await database.GetTripAsync(user!.Id, tripId, context.RequestAborted);
        if (trip is null)
        {
            return Results.NotFound();
        }

        if (request.RequestId == Guid.Empty)
        {
            return Results.BadRequest(new { title = "A request ID is required." });
        }

        var parties = await database.GetPartiesAsync(user.Id, tripId, context.RequestAborted);
        var preview = planner.Build(
            await flightPlanning.GetAsync(user!.Id, trip, context.RequestAborted),
            parties,
            context.RequestAborted
        );
        if (!preview.Ready)
        {
            return Results.BadRequest(
                new
                {
                    title = "Resolve the planning issues before searching.",
                    issues = preview.Issues,
                }
            );
        }

        preview = SavedFlightChoices.RemainingSearches(
            preview,
            await database.GetFlightChoicesAsync(user.Id, tripId, context.RequestAborted)
        );
        try
        {
            var operation = await database.CreateFlightSearchOperationAsync(
                user.Id,
                tripId,
                request.RequestId,
                preview,
                context.RequestAborted
            );
            context.Response.Headers.RetryAfter = "2";
            return Results.Accepted(operation.PollingUrl, operation);
        }
        catch (InvalidOperationException exception)
        {
            return Results.Conflict(new { title = exception.Message });
        }
    }

    private static async Task<IResult> GetFlightSearch(
        Guid tripId,
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

        Trip? trip = await database.GetTripAsync(user!.Id, tripId, context.RequestAborted);
        if (trip is null)
        {
            return Results.NotFound();
        }

        var parties = await database.GetPartiesAsync(user.Id, tripId, context.RequestAborted);
        var document = await flightPlanning.GetAsync(user!.Id, trip, context.RequestAborted);
        var preview = planner.Build(document, parties, context.RequestAborted);
        if (!preview.Ready)
        {
            return Results.BadRequest(
                new
                {
                    title = "The saved trip constraints cannot produce a flight search.",
                    issues = preview.Issues,
                }
            );
        }

        var results = await database.GetFareSearchResultsAsync(
            user.Id,
            tripId,
            preview,
            context.RequestAborted
        );
        var choices = await database.GetFlightChoicesAsync(user.Id, tripId, context.RequestAborted);
        if (document.Visits.Length > 0)
        {
            results = SavedFlightChoices.Restore(results, choices, preview);
        }
        context.Response.Headers.CacheControl = "no-store";
        if (results is null || results.Count == 0)
        {
            return Results.NotFound();
        }

        if (document.Visits.Length > 0)
        {
            var assembled = routes.Compose(
                document,
                parties,
                results,
                choices,
                includeAllConnections: true
            );
            results = assembled;
        }
        return Results.Ok(
            results.Select(result =>
            {
                var party = parties.Single(p => p.Id == result.PartyId);
                return new EvaluatedFareSearchResultDto(
                    result.PartyId,
                    result.CacheKey,
                    result.Request,
                    result.Response,
                    result.FetchedAt,
                    result.ExpiresAt,
                    validator.Evaluate(result, document, party)
                );
            })
        );
    }

    private static async Task<IResult> GetBookingLinks(
        Guid tripId,
        string cacheKey,
        BookingLinksRequest request,
        HttpContext context,
        IPlannerDb database,
        ISearchPlanBuilder planner,
        FareValidator validator,
        RouteFareComposer routes,
        IIgnavClient ignav,
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

        if (string.IsNullOrWhiteSpace(request.IgnavId))
        {
            return Results.BadRequest(new { title = "An Ignav itinerary ID is required." });
        }

        Trip? trip = await database.GetTripAsync(user!.Id, tripId, context.RequestAborted);
        if (trip is null)
        {
            return Results.NotFound();
        }

        var parties = await database.GetPartiesAsync(user.Id, tripId, context.RequestAborted);
        var document = await flightPlanning.GetAsync(user!.Id, trip, context.RequestAborted);
        var preview = planner.Build(document, parties, context.RequestAborted);
        if (!preview.Ready)
        {
            return Results.BadRequest(new { title = "The saved trip constraints are invalid." });
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
        if (fares is not null)
        {
            fares = routes.Compose(document, parties, fares, choices);
        }

        var matching = fares
            ?.Where(result => result.CacheKey == cacheKey)
            .Select(result => new
            {
                Fare = result,
                Index = ItineraryIndex(result.Response, request.IgnavId),
            })
            .Where(candidate => candidate.Index >= 0)
            .ToArray();
        if (matching is null || matching.Length == 0)
        {
            return Results.NotFound();
        }

        if (
            !matching.Any(candidate =>
                validator
                    .Evaluate(
                        candidate.Fare,
                        document,
                        parties.Single(p => p.Id == candidate.Fare.PartyId)
                    )[candidate.Index]
                    .Status == "Eligible"
            )
        )
        {
            return Results.Conflict(
                new { title = "This fare does not satisfy the trip's current requirements." }
            );
        }

        return Results.Ok(
            await ignav.GetBookingLinksAsync(request.IgnavId, context.RequestAborted)
        );
    }

    private static int ItineraryIndex(JsonElement response, string ignavId)
    {
        if (
            !response.TryGetProperty("itineraries", out var itineraries)
            || itineraries.ValueKind != JsonValueKind.Array
        )
        {
            return -1;
        }

        var index = 0;
        foreach (var itinerary in itineraries.EnumerateArray())
        {
            if (
                itinerary.ValueKind == JsonValueKind.Object
                && (
                    (
                        itinerary.TryGetProperty("ignav_id", out var id)
                        && id.ValueKind == JsonValueKind.String
                        && string.Equals(id.GetString(), ignavId, StringComparison.Ordinal)
                    )
                    || (
                        itinerary.TryGetProperty("bookingOffers", out var offers)
                        && offers
                            .EnumerateArray()
                            .Any(o => o.GetProperty("ignavId").GetString() == ignavId)
                    )
                )
            )
            {
                return index;
            }

            index++;
        }
        return -1;
    }
}
