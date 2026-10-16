using System.Text.Json;
using Npgsql;
using NpgsqlTypes;
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
        CancellationToken cancellationToken = default,
        string role = "Traveller"
    )
    {
        await using NpgsqlConnection connection = await dataSource.OpenConnectionAsync(
            cancellationToken
        );
        await using var transaction = await BeginWriteTransactionAsync(
            connection,
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
        Dictionary<Guid, string> roles;
        await using (
            var party = new NpgsqlCommand(
                "SELECT user_ids, member_roles::text FROM parties WHERE id = $1 AND trip_id = $2 FOR UPDATE;",
                connection,
                transaction
            )
        )
        {
            party.Parameters.AddWithValue(partyId);
            party.Parameters.AddWithValue(tripId);
            await using var reader = await party.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
                return PartyMemberChangeStatus.PartyNotFound;
            members = reader.GetFieldValue<Guid[]>(0);
            roles = JsonSerializer.Deserialize<Dictionary<Guid, string>>(reader.GetString(1)) ?? [];
            if (members.Length == 0)
                return PartyMemberChangeStatus.PartyNotFound;
        }

        if (add && !members.Contains(memberUserId))
        {
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
        else if (!add)
        {
            if (!members.Contains(memberUserId))
                return PartyMemberChangeStatus.Success;
            if (memberUserId == ownerUserId)
                return PartyMemberChangeStatus.OwnerCannotLeave;
        }

        Guid[] updated = add
            ? members.Append(memberUserId).Distinct().ToArray()
            : members.Where(id => id != memberUserId).ToArray();
        if (add)
            roles[memberUserId] = role;
        else
            roles.Remove(memberUserId);
        await using (
            var update = new NpgsqlCommand(
                "UPDATE parties SET user_ids = $1, member_roles = $3 WHERE id = $2;",
                connection,
                transaction
            )
        )
        {
            update.Parameters.AddWithValue(updated);
            update.Parameters.AddWithValue(partyId);
            update.Parameters.AddWithValue(NpgsqlDbType.Jsonb, JsonSerializer.Serialize(roles));
            await update.ExecuteNonQueryAsync(cancellationToken);
        }
        if (transaction is not null)
            await transaction.CommitAsync(cancellationToken);
        return PartyMemberChangeStatus.Success;
    }
}
