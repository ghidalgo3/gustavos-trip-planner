using System.ComponentModel.DataAnnotations;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Endpoints;

public static class OperationsEndpoints
{
    public static void MapOperationsEndpoints(this RouteGroupBuilder api)
    {
        var operations = api.MapGroup("/operations")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        operations.MapGet("", ListOperations).WithName("ListOperations");
        operations.MapGet("/{operationId:guid}", GetOperation).WithName("GetOperation");
    }

    internal static async Task<IResult> ListOperations(
        [Range(1, 100)] int? top,
        [Range(0, 100000)] int? skip,
        [AllowedValues(
            null,
            "flightSearch",
            "tripFormFill",
            "activitySuggest",
            "activityPlanAssessment",
            "activityPlanProposal"
        )]
            string? type,
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

        int take = top ?? 50;
        int offset = skip ?? 0;
        string? operationType = string.IsNullOrWhiteSpace(type) ? null : type.Trim();
        if (take is < 1 or > 100 || offset < 0 || operationType?.Length > 100)
        {
            return Results.BadRequest(
                new
                {
                    title = "top must be 1–100, skip cannot be negative, and type cannot exceed 100 characters.",
                }
            );
        }

        context.Response.Headers.CacheControl = "no-store";
        return Results.Ok(
            await database.GetOperationsAsync(
                user!.Id,
                operationType,
                take,
                offset,
                context.RequestAborted
            )
        );
    }

    internal static async Task<IResult> GetOperation(
        Guid operationId,
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

        var operation = await database.GetOperationAsync(
            user!.Id,
            operationId,
            context.RequestAborted
        );
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers.RetryAfter = "2";
        return operation is null ? Results.NotFound() : Results.Ok(operation);
    }
}

internal static class EndpointAuthorization
{
    public static async Task<(User? User, IResult? Error)> AuthorizeCurrentUserAsync(
        HttpContext context,
        IPlannerDb database,
        AuthenticatedUserProfile profile,
        bool requireOnboarding = true
    )
    {
        bool bearer = context
            .Request.Headers.Authorization.ToString()
            .StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase);
        User? user =
            bearer && Guid.TryParse(context.User.FindFirst("sub")?.Value, out var subject)
                ? await database.GetUserAsync(subject, context.RequestAborted)
                : await database.GetUserByEmailAsync(profile.Email, context.RequestAborted);
        if (
            user is null
            || !string.Equals(user.Email, profile.Email, StringComparison.OrdinalIgnoreCase)
        )
        {
            return (null, Results.StatusCode(StatusCodes.Status403Forbidden));
        }

        if (requireOnboarding && user.HomeCityLocation is null)
        {
            return (
                null,
                Results.Problem(
                    statusCode: StatusCodes.Status403Forbidden,
                    title: "Complete onboarding before planning trips."
                )
            );
        }

        return (user, null);
    }
}
