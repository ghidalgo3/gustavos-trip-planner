using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services;

namespace TripPlanner.Api.Endpoints;

public static class PartyEndpoints
{
    public static void MapPartyEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet("/trips/{tripId:guid}/parties", ListTripParties)
            .WithName("ListTripParties")
            .WithTags("Parties")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);

        api.MapGet("/users", SearchUsers)
            .WithName("SearchUsers")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);

        var members = api.MapGroup(
                "/user/{userId:guid}/trips/{tripId:guid}/parties/{partyId:guid}/members"
            )
            .WithTags("Parties")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        members.MapPut("/{memberId:guid}", AddMember).WithName("AddPartyMember");
        members.MapDelete("/{memberId:guid}", RemoveMember).WithName("RemovePartyMember");
    }

    private static async Task<IResult> ListTripParties(
        Guid tripId,
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
        Trip? trip = await database.GetVisibleTripAsync(user!.Id, tripId, context.RequestAborted);
        if (trip is null)
            return Results.NotFound();
        var parties = await database.GetPartiesAsync(user.Id, tripId, context.RequestAborted);
        User? owner = await database.GetUserAsync(trip.OwnerUserId, context.RequestAborted);
        SearchLocation? ownerOrigin = owner is null ? null : airports.SuggestOrigin([owner]);
        var result = new List<PlanningParty>();
        foreach (Party party in parties)
        {
            var members = new List<PlanningMember>();
            foreach (Guid memberId in party.UserIds)
            {
                User? member = await database.GetUserAsync(memberId, context.RequestAborted);
                members.Add(
                    new(memberId, member?.DisplayName ?? "Unknown traveler", member?.HomeCityName)
                );
            }
            result.Add(new(party.Id, members, ownerOrigin, owner?.PreferredAirport));
        }
        return Results.Ok(result);
    }

    private static async Task<IResult> SearchUsers(
        string? query,
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
        string text = query?.Trim() ?? "";
        if (text.Length is < 2 or > 100)
            return Results.ValidationProblem(
                new Dictionary<string, string[]>
                {
                    [nameof(query)] = ["Search by at least two and at most 100 characters."],
                }
            );
        return Results.Ok(await database.SearchUsersAsync(user!.Id, text, context.RequestAborted));
    }

    private static Task<IResult> AddMember(
        Guid userId,
        Guid tripId,
        Guid partyId,
        Guid memberId,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    ) => ChangeMember(userId, tripId, partyId, memberId, true, context, database, currentUser);

    private static Task<IResult> RemoveMember(
        Guid userId,
        Guid tripId,
        Guid partyId,
        Guid memberId,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    ) => ChangeMember(userId, tripId, partyId, memberId, false, context, database, currentUser);

    private static async Task<IResult> ChangeMember(
        Guid userId,
        Guid tripId,
        Guid partyId,
        Guid memberId,
        bool add,
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
        PartyMemberChangeStatus status = await database.ChangePartyMemberAsync(
            user.Id,
            tripId,
            partyId,
            memberId,
            add,
            context.RequestAborted
        );
        return status switch
        {
            PartyMemberChangeStatus.Success => Results.NoContent(),
            PartyMemberChangeStatus.PartyNotFound or PartyMemberChangeStatus.UserNotFound =>
                Results.NotFound(),
            PartyMemberChangeStatus.AlreadyInAnotherParty => Results.Conflict(
                new { message = "This traveler is already in another party on this trip." }
            ),
            PartyMemberChangeStatus.PartyFull => Results.Conflict(
                new { message = "A party can have at most nine travelers." }
            ),
            PartyMemberChangeStatus.OwnerCannotLeave => Results.ValidationProblem(
                new Dictionary<string, string[]>
                {
                    ["memberId"] = ["The trip owner must remain in the party."],
                }
            ),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }
}
