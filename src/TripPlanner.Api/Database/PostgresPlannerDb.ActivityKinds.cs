using TripPlanner.Api.DTO;

namespace TripPlanner.Api.Database;

public sealed partial class PostgresPlannerDb
{
    public async Task<ActivityKindPage> GetActivityKindPageAsync(
        Guid userId,
        ActivityKindQuery query,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            WITH owned_activities AS MATERIALIZED (
                SELECT a.properties FROM activities a
                JOIN trips t ON t.id = a.trip_id
                WHERE t.owner_user_id = $1
            ), kinds AS (
                SELECT DISTINCT value #>> '{}' AS kind
                FROM owned_activities
                CROSS JOIN LATERAL jsonb_array_elements(properties->'kinds') AS labels(value)
                WHERE jsonb_typeof(value) = 'string'
            )
            SELECT kind FROM kinds
            WHERE strpos(lower(kind), lower($2)) > 0
            ORDER BY kind COLLATE "C"
            LIMIT $3 OFFSET $4;
            """
        );
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(query.Search?.Trim() ?? "");
        command.Parameters.AddWithValue(query.Top + 1);
        command.Parameters.AddWithValue(query.Skip);
        var kinds = new List<string>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            kinds.Add(reader.GetString(0));
        }
        return new(kinds.Take(query.Top).ToArray(), kinds.Count > query.Top);
    }
}
