using System.Text.Json;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services;

namespace TripPlanner.Api.Endpoints;

public static class TripsEndpoints
{
    public static void MapTripsEndpoints(this RouteGroupBuilder api)
    {
        var trips = api.MapGroup("/user/{userId:guid}/trips")
            .WithTags("Trips")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        trips.MapGet("/", ListTrips).WithName("ListUserTrips");
        trips.MapGet("/{tripId:guid}", GetTrip).WithName("GetUserTrip");
        trips.MapPost("/", CreateTrip).WithName("CreateUserTrip");
        trips.MapPut("/{tripId:guid}", UpdateTrip).WithName("UpdateUserTrip");
        trips.MapDelete("/{tripId:guid}", DeleteTrip).WithName("DeleteUserTrip");
        var flightConstraints = api.MapGroup("/trips/{tripId:guid}/flights/constraints")
            .WithTags("Flight Constraints")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        flightConstraints.MapGet("", GetConstraints).WithName("GetTripFlightConstraints");
        flightConstraints.MapPut("", SaveConstraints).WithName("SaveTripFlightConstraints");

        api.MapPost("/trips/{tripId:guid}/flights:search", StartFlightSearch)
            .WithName("StartTripFlightSearch")
            .WithTags("Flight Search")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        api.MapGet("/trips/{tripId:guid}/flights/search", GetFlightSearch)
            .WithName("GetTripFlightSearch")
            .WithTags("Flight Search")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        api.MapPost("/trips/{tripId:guid}/flights/search/{cacheKey}/bookingLinks", GetBookingLinks)
            .WithName("GetFlightBookingLinks")
            .WithTags("Flight Search")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
    }

    private static async Task<IResult> ListTrips(
        Guid userId,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        var (user, error) = await AuthorizeOwnerAsync(
            userId,
            context,
            database,
            currentUser.Profile!
        );
        return error ?? Results.Ok(await database.GetTripsAsync(user!.Id, context.RequestAborted));
    }

    private static async Task<IResult> GetTrip(
        Guid userId,
        Guid tripId,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        var (user, error) = await AuthorizeOwnerAsync(
            userId,
            context,
            database,
            currentUser.Profile!
        );
        if (error is not null)
            return error;
        Trip? trip = await database.GetVisibleTripAsync(user!.Id, tripId, context.RequestAborted);
        return trip is null ? Results.NotFound() : Results.Ok(trip);
    }

    private static async Task<IResult> CreateTrip(
        Guid userId,
        CreateTripRequest request,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        var (user, error) = await AuthorizeOwnerAsync(
            userId,
            context,
            database,
            currentUser.Profile!
        );
        if (error is not null)
            return error;
        var (name, description, validationError) = ValidateInput(request.Name, request.Description);
        if (validationError is not null)
            return validationError;
        Trip trip = await database.CreateTripAsync(
            user!.Id,
            name,
            description,
            context.RequestAborted
        );
        return Results.Created($"/user/{user.Id}/trips/{trip.Id}", trip);
    }

    private static async Task<IResult> UpdateTrip(
        Guid userId,
        Guid tripId,
        UpdateTripRequest request,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        var (user, error) = await AuthorizeOwnerAsync(
            userId,
            context,
            database,
            currentUser.Profile!
        );
        if (error is not null)
            return error;
        var (name, description, validationError) = ValidateInput(request.Name, request.Description);
        if (validationError is not null)
            return validationError;
        Trip? trip = await database.UpdateTripAsync(
            user!.Id,
            tripId,
            name,
            description,
            context.RequestAborted
        );
        return trip is null ? Results.NotFound() : Results.Ok(trip);
    }

    private static async Task<IResult> DeleteTrip(
        Guid userId,
        Guid tripId,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        var (user, error) = await AuthorizeOwnerAsync(
            userId,
            context,
            database,
            currentUser.Profile!
        );
        if (error is not null)
            return error;
        return await database.DeleteTripAsync(user!.Id, tripId, context.RequestAborted)
            ? Results.NoContent()
            : Results.NotFound();
    }

    private static async Task<IResult> GetConstraints(
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
        Trip? trip = await database.GetVisibleTripAsync(user!.Id, tripId, context.RequestAborted);
        if (trip is null)
            return Results.NotFound();
        return Results.Ok(PlanningDocument.FromJson(trip.Constraints));
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
            return error;
        if (await database.GetTripAsync(user!.Id, tripId, context.RequestAborted) is null)
            return Results.NotFound();
        var parties = await database.GetPartiesAsync(user.Id, tripId, context.RequestAborted);
        var issues = planner.Validate(document, parties, false);
        if (issues.Count > 0)
            return Results.BadRequest(new { title = "Check the constraint definitions.", issues });
        Trip? updated = await database.SetConstraintsAsync(
            user.Id,
            tripId,
            JsonSerializer.SerializeToElement(document, JsonSerializerOptions.Web),
            context.RequestAborted
        );
        return updated is null
            ? Results.NotFound()
            : Results.Ok(PlanningDocument.FromJson(updated.Constraints));
    }

    private static async Task<IResult> StartFlightSearch(
        Guid tripId,
        StartFlightSearchRequest request,
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
            return error;
        Trip? trip = await database.GetTripAsync(user!.Id, tripId, context.RequestAborted);
        if (trip is null)
            return Results.NotFound();
        if (request.RequestId == Guid.Empty)
            return Results.BadRequest(new { title = "A request ID is required." });
        var parties = await database.GetPartiesAsync(user.Id, tripId, context.RequestAborted);
        var preview = planner.Build(
            PlanningDocument.FromJson(trip.Constraints),
            parties,
            context.RequestAborted
        );
        if (!preview.Ready)
            return Results.BadRequest(
                new
                {
                    title = "Resolve the planning issues before searching.",
                    issues = preview.Issues,
                }
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
        Trip? trip = await database.GetTripAsync(user!.Id, tripId, context.RequestAborted);
        if (trip is null)
            return Results.NotFound();
        var parties = await database.GetPartiesAsync(user.Id, tripId, context.RequestAborted);
        var preview = planner.Build(
            PlanningDocument.FromJson(trip.Constraints),
            parties,
            context.RequestAborted
        );
        if (!preview.Ready)
            return Results.BadRequest(
                new
                {
                    title = "The saved trip constraints cannot produce a flight search.",
                    issues = preview.Issues,
                }
            );
        var results = await database.GetFareSearchResultsAsync(
            user.Id,
            tripId,
            preview,
            context.RequestAborted
        );
        context.Response.Headers.CacheControl = "no-store";
        if (results is null)
            return Results.NotFound();
        var document = PlanningDocument.FromJson(trip.Constraints);
        if (document.Visits.Length > 0)
        {
            var assembled = routes.Compose(
                document,
                parties,
                results,
                await database.GetFlightChoicesAsync(user.Id, tripId, context.RequestAborted)
            );
            if (
                assembled.Any(result =>
                    result.Response.GetProperty("itineraries").GetArrayLength() > 0
                )
            )
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
        if (string.IsNullOrWhiteSpace(request.IgnavId))
            return Results.BadRequest(new { title = "An Ignav itinerary ID is required." });
        Trip? trip = await database.GetTripAsync(user!.Id, tripId, context.RequestAborted);
        if (trip is null)
            return Results.NotFound();
        var parties = await database.GetPartiesAsync(user.Id, tripId, context.RequestAborted);
        var preview = planner.Build(
            PlanningDocument.FromJson(trip.Constraints),
            parties,
            context.RequestAborted
        );
        if (!preview.Ready)
            return Results.BadRequest(new { title = "The saved trip constraints are invalid." });
        var fares = await database.GetFareSearchResultsAsync(
            user.Id,
            tripId,
            preview,
            context.RequestAborted
        );
        if (fares is not null)
            fares = routes.Compose(
                PlanningDocument.FromJson(trip.Constraints),
                parties,
                fares,
                await database.GetFlightChoicesAsync(user.Id, tripId, context.RequestAborted)
            );
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
            return Results.NotFound();
        var document = PlanningDocument.FromJson(trip.Constraints);
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
            return Results.Conflict(
                new { title = "This fare does not satisfy the trip's current requirements." }
            );
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
            return -1;
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
                return index;
            index++;
        }
        return -1;
    }

    private static async Task<(User? User, IResult? Error)> AuthorizeOwnerAsync(
        Guid userId,
        HttpContext context,
        IPlannerDb database,
        AuthenticatedUserProfile profile
    )
    {
        User? user = await database.GetUserAsync(userId, context.RequestAborted);
        if (
            user is null
            || !string.Equals(user.Email, profile.Email, StringComparison.OrdinalIgnoreCase)
        )
            return (null, Results.StatusCode(StatusCodes.Status403Forbidden));
        if (user.HomeCityLocation is null)
            return (
                null,
                Results.Problem(
                    statusCode: StatusCodes.Status403Forbidden,
                    title: "Complete onboarding before managing trips."
                )
            );
        return (user, null);
    }

    private static (string Name, string Description, IResult? Error) ValidateInput(
        string? requestedName,
        string? requestedDescription
    )
    {
        string name = requestedName?.Trim() ?? string.Empty;
        string description = requestedDescription?.Trim() ?? string.Empty;
        var errors = new Dictionary<string, string[]>();
        if (name.Length == 0)
            errors[nameof(CreateTripRequest.Name)] = ["Name is required."];
        else if (name.Length > 200)
            errors[nameof(CreateTripRequest.Name)] = ["Name cannot exceed 200 characters."];
        if (description.Length > 4000)
            errors[nameof(CreateTripRequest.Description)] =
            [
                "Description cannot exceed 4000 characters.",
            ];
        return (name, description, errors.Count == 0 ? null : Results.ValidationProblem(errors));
    }
}

public sealed record BookingLinksRequest(string IgnavId);
