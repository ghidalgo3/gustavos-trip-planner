using Npgsql;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Database;

public sealed class PostgresActivityLogStore(NpgsqlDataSource dataSource) : IActivityLogStore
{
    public async Task AppendAsync(TripMutation entry, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand(
            """
            INSERT INTO trip_activity_log(id, occurred_at, actor_user_id, actor_name, source,
                action, trip_id, owner_user_id, trip_name, resource_id, description)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11);
            """
        );
        foreach (
            object value in new object[]
            {
                entry.Id,
                entry.OccurredAt,
                entry.ActorUserId,
                entry.ActorName,
                entry.Source,
                entry.Action,
                entry.TripId,
                entry.OwnerUserId,
                entry.TripName,
            }
        )
            command.Parameters.AddWithValue(value);
        command.Parameters.AddWithValue(
            NpgsqlTypes.NpgsqlDbType.Text,
            (object?)entry.ResourceId ?? DBNull.Value
        );
        command.Parameters.AddWithValue(entry.Description);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<TripMutation>> ListAsync(
        Guid userId,
        int take,
        int skip,
        CancellationToken cancellationToken
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            SELECT id, occurred_at, actor_user_id, actor_name, source, action, trip_id,
                owner_user_id, trip_name, resource_id, description
            FROM trip_activity_log l
            WHERE actor_user_id = $1 OR owner_user_id = $1 OR EXISTS (
                SELECT 1 FROM parties p WHERE p.trip_id = l.trip_id AND $1 = ANY(p.user_ids))
            ORDER BY occurred_at DESC, id DESC LIMIT $2 OFFSET $3;
            """
        );
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(take);
        command.Parameters.AddWithValue(skip);
        var entries = new List<TripMutation>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            entries.Add(
                new(
                    reader.GetGuid(0),
                    reader.GetFieldValue<DateTimeOffset>(1),
                    reader.GetGuid(2),
                    reader.GetString(3),
                    reader.GetString(4),
                    reader.GetString(5),
                    reader.GetGuid(6),
                    reader.GetGuid(7),
                    reader.GetString(8),
                    reader.IsDBNull(9) ? null : reader.GetString(9),
                    reader.GetString(10)
                )
            );
        return entries;
    }
}
