using Npgsql;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Database;

public sealed partial class PostgresPlannerDb
{
    public async Task<IReadOnlyList<UserSearchResult>> SearchUsersAsync(
        Guid excludingUserId,
        string query,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            SELECT id, display_name, email
            FROM users
            WHERE id <> $1 AND strpos(lower(display_name), lower($2)) > 0
            ORDER BY lower(display_name), email
            LIMIT 10;
            """
        );
        command.Parameters.AddWithValue(excludingUserId);
        command.Parameters.AddWithValue(query);
        var users = new List<UserSearchResult>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            users.Add(new(reader.GetGuid(0), reader.GetString(1), reader.GetString(2)));
        return users;
    }

    public async Task<PartyMemberChangeStatus> ChangePartyMemberAsync(
        Guid ownerUserId,
        Guid tripId,
        Guid partyId,
        Guid memberUserId,
        bool add,
        CancellationToken cancellationToken = default
    )
    {
        await using NpgsqlConnection connection = await dataSource.OpenConnectionAsync(
            cancellationToken
        );
        await using NpgsqlTransaction transaction = await connection.BeginTransactionAsync(
            cancellationToken
        );
        // Serialize membership edits for every party in the trip.
        await using (
            var trip = new NpgsqlCommand(
                "SELECT id FROM trips WHERE id = $1 AND owner_user_id = $2 FOR UPDATE;",
                connection,
                transaction
            )
        )
        {
            trip.Parameters.AddWithValue(tripId);
            trip.Parameters.AddWithValue(ownerUserId);
            if (await trip.ExecuteScalarAsync(cancellationToken) is null)
                return PartyMemberChangeStatus.PartyNotFound;
        }

        Guid[] members;
        await using (
            var party = new NpgsqlCommand(
                "SELECT user_ids FROM parties WHERE id = $1 AND trip_id = $2 FOR UPDATE;",
                connection,
                transaction
            )
        )
        {
            party.Parameters.AddWithValue(partyId);
            party.Parameters.AddWithValue(tripId);
            members = await party.ExecuteScalarAsync(cancellationToken) as Guid[] ?? [];
            if (members.Length == 0)
                return PartyMemberChangeStatus.PartyNotFound;
        }

        if (add)
        {
            if (members.Contains(memberUserId))
                return PartyMemberChangeStatus.Success;
            await using (
                var user = new NpgsqlCommand(
                    "SELECT EXISTS(SELECT 1 FROM users WHERE id = $1);",
                    connection,
                    transaction
                )
            )
            {
                user.Parameters.AddWithValue(memberUserId);
                if (await user.ExecuteScalarAsync(cancellationToken) is not true)
                    return PartyMemberChangeStatus.UserNotFound;
            }
            if (members.Length >= 9)
                return PartyMemberChangeStatus.PartyFull;
            await using (
                var assigned = new NpgsqlCommand(
                    "SELECT EXISTS(SELECT 1 FROM parties WHERE trip_id = $1 AND id <> $2 AND $3 = ANY(user_ids));",
                    connection,
                    transaction
                )
            )
            {
                assigned.Parameters.AddWithValue(tripId);
                assigned.Parameters.AddWithValue(partyId);
                assigned.Parameters.AddWithValue(memberUserId);
                if (await assigned.ExecuteScalarAsync(cancellationToken) is true)
                    return PartyMemberChangeStatus.AlreadyInAnotherParty;
            }
        }
        else
        {
            if (!members.Contains(memberUserId))
                return PartyMemberChangeStatus.Success;
            if (memberUserId == ownerUserId)
                return PartyMemberChangeStatus.OwnerCannotLeave;
        }

        Guid[] updated = add
            ? [.. members, memberUserId]
            : members.Where(id => id != memberUserId).ToArray();
        await using (
            var update = new NpgsqlCommand(
                "UPDATE parties SET user_ids = $1 WHERE id = $2;",
                connection,
                transaction
            )
        )
        {
            update.Parameters.AddWithValue(updated);
            update.Parameters.AddWithValue(partyId);
            await update.ExecuteNonQueryAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return PartyMemberChangeStatus.Success;
    }
}
