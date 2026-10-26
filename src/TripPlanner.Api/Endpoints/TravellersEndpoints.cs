using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Endpoints;

public static class TravellersEndpoints
{
    public static void MapTravellersEndpoints(this RouteGroupBuilder api)
    {
        var group = api.MapGroup("/trips/{tripId:guid}/travellers")
            .WithTags("Travellers")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        group.MapGet("", GetTravellers).WithName("GetTripTravellers");
        group.MapGet("/{memberId:guid}", () => Results.NotFound()).WithName("GetTripTraveller");
        group
            .MapPut(
                "/{memberId:guid}",
                (
                    Guid tripId,
                    Guid memberId,
                    HttpContext context,
                    IPlannerDb database,
                    ICurrentUser user,
                    [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)]
                        PartyMemberRequest? request
                ) =>
                    Change(
                        tripId,
                        memberId,
                        true,
                        request?.Role ?? PartyRole.Traveller,
                        context,
                        database,
                        user
                    )
            )
            .WithName("ReplaceTripTraveller");
        group
            .MapDelete(
                "/{memberId:guid}",
                (
                    Guid tripId,
                    Guid memberId,
                    HttpContext context,
                    IPlannerDb database,
                    ICurrentUser user
                ) => Change(tripId, memberId, false, PartyRole.Traveller, context, database, user)
            )
            .WithName("DeleteTripTraveller");
    }

    private static async Task<IResult> GetTravellers(
        Guid tripId,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser user
    )
    {
        var (trip, actor, error) = await PlanningEndpointHelpers.AuthorizeAsync(
            tripId,
            false,
            context,
            database,
            user
        );
        if (error is not null)
        {
            return error;
        }

        var parties = await database.GetPartiesAsync(actor!.Id, tripId, context.RequestAborted);
        var members = new List<PlanningMember>();
        foreach (var party in parties)
        {
            foreach (var id in party.UserIds)
            {
                var person = await database.GetUserAsync(id, context.RequestAborted);
                if (person is not null)
                {
                    members.Add(
                        new(
                            person.Id,
                            person.DisplayName,
                            person.HomeCityName,
                            person.Id == trip!.OwnerUserId
                                ? PartyRole.Planner
                                : party.RoleFor(person.Id)
                        )
                    );
                }
            }
        }
        return Results.Ok(members.OrderBy(m => m.Id));
    }

    private static async Task<IResult> Change(
        Guid tripId,
        Guid memberId,
        bool add,
        PartyRole role,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        var (trip, user, error) = await PlanningEndpointHelpers.AuthorizeAsync(
            tripId,
            false,
            context,
            database,
            currentUser
        );
        if (error is not null)
        {
            return error;
        }

        if (trip!.OwnerUserId != user!.Id)
        {
            return Results.StatusCode(403);
        }

        var parties = await database.GetPartiesAsync(user.Id, tripId, context.RequestAborted);
        if (parties.Count != 1)
        {
            return Results.Conflict(
                new
                {
                    code = "multiple_parties_unsupported",
                    title = "This trip needs a single travel party before changing its travellers here.",
                }
            );
        }

        var result = await database.ChangePartyMemberAsync(
            user.Id,
            tripId,
            parties[0].Id,
            memberId,
            add,
            context.RequestAborted,
            role
        );
        return result switch
        {
            PartyMemberChangeStatus.Success => Results.NoContent(),
            PartyMemberChangeStatus.PartyNotFound or PartyMemberChangeStatus.UserNotFound =>
                Results.NotFound(),
            PartyMemberChangeStatus.OwnerCannotLeave => Results.BadRequest(
                new { title = "The trip owner must remain a traveller." }
            ),
            _ => Results.Conflict(new { title = "This traveller could not be added to the trip." }),
        };
    }
}
