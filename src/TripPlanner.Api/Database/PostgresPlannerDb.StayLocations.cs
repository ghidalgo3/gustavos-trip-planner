using System.Text.Json;
using NpgsqlTypes;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Database;

public sealed partial class PostgresPlannerDb
{
    public async Task<
        IReadOnlyDictionary<string, GeoJsonFeature<StayLocationProperties>>
    > GetStayLocationsAsync(Guid userId, Guid tripId, CancellationToken cancellationToken = default)
    {
        await using var command = dataSource.CreateCommand(
            """
            SELECT s.city_id, s.feature::text FROM destination_stay_locations s JOIN trips t ON t.id=s.trip_id
            WHERE t.id=$1 AND (t.owner_user_id=$2 OR EXISTS (SELECT 1 FROM parties p WHERE p.trip_id=t.id AND $2=ANY(p.user_ids)));
            """
        );
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(userId);
        var result = new Dictionary<string, GeoJsonFeature<StayLocationProperties>>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(
                reader.GetString(0),
                JsonSerializer.Deserialize<GeoJsonFeature<StayLocationProperties>>(
                    reader.GetString(1),
                    JsonSerializerOptions.Web
                )!
            );
        }

        return result;
    }

    public async Task<bool> SaveStayLocationAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        GeoJsonFeature<StayLocationProperties>? feature,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            feature is null
                ? """
                WITH eligible AS (SELECT city_id FROM destination_places WHERE trip_id=$1 AND city_id=$2 AND can_plan_trip(trip_id,$3)),
                removed AS (DELETE FROM destination_stay_locations WHERE trip_id=$1 AND city_id=$2 AND EXISTS(SELECT 1 FROM eligible))
                SELECT EXISTS(SELECT 1 FROM eligible);
                """
                : """
                INSERT INTO destination_stay_locations (trip_id,city_id,feature)
                SELECT trip_id, city_id, $4 FROM destination_places WHERE trip_id=$1 AND city_id=$2 AND can_plan_trip(trip_id,$3)
                ON CONFLICT(trip_id,city_id) DO UPDATE SET feature=EXCLUDED.feature
                RETURNING true;
                """
        );
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(cityId);
        command.Parameters.AddWithValue(userId);
        if (feature is not null)
        {
            command.Parameters.AddWithValue(
                NpgsqlDbType.Jsonb,
                JsonSerializer.Serialize(feature, JsonSerializerOptions.Web)
            );
        }

        return await command.ExecuteScalarAsync(cancellationToken) is true;
    }
}
