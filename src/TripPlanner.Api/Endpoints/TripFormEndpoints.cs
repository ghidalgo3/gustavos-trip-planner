using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services;

namespace TripPlanner.Api.Endpoints;

public static class TripFormEndpoints
{
    public static void MapTripFormEndpoints(this RouteGroupBuilder api)
    {
        api.MapPost("/user/{userId:guid}/trips/{tripId:guid}/formProposal", Propose)
            .WithName("StartTripFormFill")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        api.MapGet(
                "/user/{userId:guid}/trips/{tripId:guid}/formProposal/{operationId:guid}",
                GetProposal
            )
            .WithName("GetTripFormProposal")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
    }

    private sealed record ProposalRequest(Guid RequestId, string Input, PlanningDocument Draft);

    private static async Task<IResult> Propose(
        Guid userId,
        Guid tripId,
        ProposalRequest request,
        HttpContext context,
        IPlannerDb database,
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
        if (user!.Id != userId)
            return Results.Forbid();
        if (!user.FeatureFlags.Split(',').Contains("LLM", StringComparer.Ordinal))
            return Results.Forbid();
        if (string.IsNullOrWhiteSpace(request.Input) || request.Input.Length > 4000)
            return Results.ValidationProblem(
                new Dictionary<string, string[]>
                {
                    ["input"] = ["Describe the trip in 1 to 4000 characters."],
                }
            );
        if (request.Draft is null)
            return Results.ValidationProblem(
                new Dictionary<string, string[]> { ["draft"] = ["A planning draft is required."] }
            );
        if (request.RequestId == Guid.Empty)
            return Results.ValidationProblem(
                new Dictionary<string, string[]> { ["requestId"] = ["A request ID is required."] }
            );
        Trip? trip = await database.GetTripAsync(user.Id, tripId, context.RequestAborted);
        if (trip is null)
            return Results.NotFound();
        var parties = await database.GetPartiesAsync(user.Id, tripId, context.RequestAborted);
        var editorParties = new List<PlanningParty>();
        foreach (Party party in parties)
        {
            var members = new List<PlanningMember>();
            foreach (Guid id in party.UserIds)
            {
                User? member = await database.GetUserAsync(id, context.RequestAborted);
                if (member is not null)
                    members.Add(new(member.Id, member.DisplayName, member.HomeCityName));
            }
            editorParties.Add(new(party.Id, members, airports.SuggestOrigin([user])));
        }
        // Keep only the trip's real parties; client-supplied IDs cannot create new parties.
        PlanningDocument draft = request.Draft with
        {
            Parties = editorParties
                .Select(p =>
                    request.Draft.Parties.FirstOrDefault(saved => saved.PartyId == p.Id)
                    ?? new PartySearchSettings { PartyId = p.Id, Origin = p.SuggestedOrigin }
                )
                .ToArray(),
            Constraints = request
                .Draft.Constraints.Where(c =>
                    editorParties.Any(p => p.Members.Any(m => m.Id == c.UserId))
                )
                .ToArray(),
        };
        try
        {
            TrackedOperation operation = await database.CreateTripFormOperationAsync(
                user.Id,
                tripId,
                request.RequestId,
                request.Input.Trim(),
                draft,
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

    private static async Task<IResult> GetProposal(
        Guid userId,
        Guid tripId,
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
            return error;
        if (user!.Id != userId)
            return Results.Forbid();
        if (!user.FeatureFlags.Split(',').Contains("LLM", StringComparer.Ordinal))
            return Results.Forbid();
        context.Response.Headers.CacheControl = "no-store";
        TripFormProposal? proposal = await database.GetTripFormProposalAsync(
            user.Id,
            tripId,
            operationId,
            context.RequestAborted
        );
        return proposal is null ? Results.NotFound() : Results.Ok(proposal);
    }
}
