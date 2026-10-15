using TripPlanner.Api.Models;

namespace TripPlanner.Api.Database;

public sealed partial class InMemoryPlannerDb
{
    public Task<IReadOnlyList<UserSearchResult>> SearchUsersAsync(
        Guid excludingUserId,
        string query,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        IReadOnlyList<UserSearchResult> users = _users
            .Values.Where(user =>
                user.Id != excludingUserId
                && user.DisplayName.Contains(query, StringComparison.OrdinalIgnoreCase)
            )
            .OrderBy(user => user.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(user => user.Email)
            .Take(10)
            .Select(user => new UserSearchResult(user.Id, user.DisplayName, user.Email))
            .ToArray();
        return Task.FromResult(users);
    }

    public Task<PartyMemberChangeStatus> ChangePartyMemberAsync(
        Guid ownerUserId,
        Guid tripId,
        Guid partyId,
        Guid memberUserId,
        bool add,
        CancellationToken cancellationToken = default,
        string role = "Traveller"
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            if (
                !_trips.TryGetValue(tripId, out Trip? trip)
                || trip.OwnerUserId != ownerUserId
                || !_parties.TryGetValue(partyId, out Party? party)
                || party.TripId != tripId
            )
                return Task.FromResult(PartyMemberChangeStatus.PartyNotFound);
            if (add && !party.UserIds.Contains(memberUserId))
            {
                if (_users.Values.All(user => user.Id != memberUserId))
                    return Task.FromResult(PartyMemberChangeStatus.UserNotFound);
                if (party.UserIds.Count >= 9)
                    return Task.FromResult(PartyMemberChangeStatus.PartyFull);
                if (
                    _parties.Values.Any(other =>
                        other.TripId == tripId
                        && other.Id != partyId
                        && other.UserIds.Contains(memberUserId)
                    )
                )
                    return Task.FromResult(PartyMemberChangeStatus.AlreadyInAnotherParty);
            }
            else if (!add)
            {
                if (!party.UserIds.Contains(memberUserId))
                    return Task.FromResult(PartyMemberChangeStatus.Success);
                if (memberUserId == ownerUserId)
                    return Task.FromResult(PartyMemberChangeStatus.OwnerCannotLeave);
            }
            IReadOnlyList<Guid> members = add
                ? party.UserIds.Append(memberUserId).Distinct().ToArray()
                : party.UserIds.Where(id => id != memberUserId).ToArray();
            var roles = new Dictionary<Guid, string>(party.MemberRoles);
            if (add)
                roles[memberUserId] = role;
            else
                roles.Remove(memberUserId);
            _parties[partyId] = party with { UserIds = members, MemberRoles = roles };
            return Task.FromResult(PartyMemberChangeStatus.Success);
        }
    }
}
