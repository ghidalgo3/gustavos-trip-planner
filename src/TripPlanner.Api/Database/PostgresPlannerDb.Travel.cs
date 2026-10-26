using System.Text.Json;
using NpgsqlTypes;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Snapshots;

namespace TripPlanner.Api.Database;

public sealed partial class PostgresPlannerDb
{
    public async Task<DateTimeOffset> GetTripSnapshotModifiedAtAsync(
        Guid userId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            $"SELECT v.modified_at FROM activity_planning_versions v JOIN trips t ON t.id=v.trip_id WHERE t.id=$2 AND {PlanningVisible}"
        );
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(tripId);
        return await command.ExecuteScalarAsync(cancellationToken) is DateTime instant
            ? new DateTimeOffset(instant)
            : DateTimeOffset.UnixEpoch;
    }

    public async Task<TripTravelPlan> GetTripTravelAsync(
        Guid userId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            SELECT d.document::text,d.version FROM trip_travel_plans d
            WHERE d.trip_id=$1 AND EXISTS (SELECT 1 FROM trips t WHERE t.id=d.trip_id AND
                (t.owner_user_id=$2 OR EXISTS(SELECT 1 FROM parties p WHERE p.trip_id=t.id AND $2=ANY(p.user_ids))));
            """
        );
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(userId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? new(
                JsonSerializer.Deserialize<TripTravelConnection[]>(
                    reader.GetString(0),
                    TripSnapshotProjection.JsonOptions
                ) ?? [],
                reader.GetInt64(1)
            )
            : new([]);
    }

    public async Task<TripTravelPlan?> SaveTripTravelAsync(
        Guid userId,
        Guid tripId,
        TripTravelConnection[] connections,
        long expectedVersion,
        long expectedContextRevision,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            WITH inputs AS (SELECT revision FROM activity_planning_versions WHERE trip_id=$1 FOR UPDATE), updated AS (
                UPDATE trip_travel_plans SET version=version+1,document=$3,updated_at=now()
                WHERE trip_id=$1 AND version=$4 AND can_plan_trip($1,$2) AND (SELECT revision FROM inputs)=$5 RETURNING version
            ), created AS (
                INSERT INTO trip_travel_plans(trip_id,version,document)
                SELECT $1,1,$3 WHERE $4=0 AND can_plan_trip($1,$2) AND (SELECT revision FROM inputs)=$5
                ON CONFLICT(trip_id) DO NOTHING RETURNING version
            ) SELECT version FROM updated UNION ALL SELECT version FROM created;
            """
        );
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(
            NpgsqlDbType.Jsonb,
            JsonSerializer.Serialize(connections, TripSnapshotProjection.JsonOptions)
        );
        command.Parameters.AddWithValue(expectedVersion);
        command.Parameters.AddWithValue(expectedContextRevision);
        var result = await command.ExecuteScalarAsync(cancellationToken);
        return result is long version ? new(connections, version) : null;
    }
}
