using System.Text.Json;
using NpgsqlTypes;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Documents;

namespace TripPlanner.Api.Database;

public sealed partial class PostgresPlannerDb
{
    public async Task<DateTimeOffset> GetTripModifiedAtAsync(
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
}
