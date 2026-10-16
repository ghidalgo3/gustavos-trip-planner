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
        var canonical = api.MapGroup("/trips")
            .WithTags("Trips")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        canonical
            .MapGet(
                "",
                (HttpContext context, IPlannerDb database, ICurrentUser currentUser) =>
                    ListTrips(null, context, database, currentUser)
            )
            .WithName("ListTrips");
        canonical
            .MapGet(
                "/{tripId:guid}",
                (Guid tripId, HttpContext context, IPlannerDb database, ICurrentUser currentUser) =>
                    GetTrip(null, tripId, context, database, currentUser)
            )
            .WithName("GetTrip");
        canonical
            .MapPost(
                "",
                (
                    CreateTripRequest request,
                    HttpContext context,
                    IPlannerDb database,
                    ICurrentUser currentUser
                ) => CreateTrip(null, request, context, database, currentUser)
            )
            .WithName("CreateTrip");
        canonical
            .MapPut(
                "/{tripId:guid}",
                (
                    Guid tripId,
                    UpdateTripRequest request,
                    HttpContext context,
                    IPlannerDb database,
                    ICurrentUser currentUser
                ) => UpdateTrip(null, tripId, request, context, database, currentUser)
            )
            .WithName("ReplaceTrip");
        canonical
            .MapDelete(
                "/{tripId:guid}",
                (Guid tripId, HttpContext context, IPlannerDb database, ICurrentUser currentUser) =>
                    DeleteTrip(null, tripId, context, database, currentUser)
            )
            .WithName("DeleteTrip");
    }

    internal static async Task<IResult> ListTrips(
        Guid? userId,
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
        return error
            ?? Results.Ok(
                (await database.GetTripsAsync(user!.Id, context.RequestAborted)).Select(
                    TripResponse.From
                )
            );
    }

    internal static async Task<IResult> GetTrip(
        Guid? userId,
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
        return trip is null
            ? Results.NotFound()
            : Results.Ok(
                TripResponse.From(trip) with
                {
                    CanPlan =
                        await database.GetTripAsync(user.Id, tripId, context.RequestAborted)
                            is not null,
                }
            );
    }

    internal static async Task<IResult> CreateTrip(
        Guid? userId,
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
        if (request.Constraints is { ValueKind: not JsonValueKind.Object })
            return Results.BadRequest(new { title = "Constraints must be a JSON object." });
        Trip trip = await database.CreateTripAsync(
            user!.Id,
            name,
            description,
            context.RequestAborted,
            request.Constraints
                ?? (userId is null ? JsonSerializer.SerializeToElement(new { }) : null)
        );
        return Results.Created(
            userId is null ? $"/trips/{trip.Id}" : $"/user/{user.Id}/trips/{trip.Id}",
            TripResponse.From(trip)
        );
    }

    internal static async Task<IResult> UpdateTrip(
        Guid? userId,
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
        if (request.Constraints is { ValueKind: not JsonValueKind.Object })
            return Results.BadRequest(new { title = "Constraints must be a JSON object." });
        Trip? trip = await database.UpdateTripAsync(
            user!.Id,
            tripId,
            name,
            description,
            context.RequestAborted,
            request.Constraints
                ?? (userId is null ? JsonSerializer.SerializeToElement(new { }) : null)
        );
        return trip is null
            ? Results.NotFound()
            : Results.Ok(TripResponse.From(trip) with { CanPlan = true });
    }

    internal static async Task<IResult> DeleteTrip(
        Guid? userId,
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

    private static async Task<(User? User, IResult? Error)> AuthorizeOwnerAsync(
        Guid? userId,
        HttpContext context,
        IPlannerDb database,
        AuthenticatedUserProfile profile
    )
    {
        if (userId is null)
            return await EndpointAuthorization.AuthorizeCurrentUserAsync(
                context,
                database,
                profile
            );
        User? user = await database.GetUserAsync(userId.Value, context.RequestAborted);
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
