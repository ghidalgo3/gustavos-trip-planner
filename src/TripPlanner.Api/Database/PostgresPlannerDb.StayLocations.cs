using System.Text.Json;
using NpgsqlTypes;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Database;

public sealed partial class PostgresPlannerDb
{
    public async Task<
        IReadOnlyDictionary<Guid, GeoJsonFeature<StayLocationProperties>>
    > GetStayLocationsAsync(Guid userId, Guid tripId, CancellationToken cancellationToken = default)
    {
        await using var command = dataSource.CreateCommand(
            """
            SELECT s.stay_id, s.feature::text FROM destination_stay_locations s JOIN trips t ON t.id=s.trip_id
            WHERE t.id=$1 AND (t.owner_user_id=$2 OR EXISTS (SELECT 1 FROM parties p WHERE p.trip_id=t.id AND $2=ANY(p.user_ids)));
            """
        );
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(userId);
        var result = new Dictionary<Guid, GeoJsonFeature<StayLocationProperties>>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(
                reader.GetGuid(0),
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
        Guid stayId,
        GeoJsonFeature<StayLocationProperties>? feature,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            feature is null
                ? """
                WITH eligible AS (SELECT stay_id FROM destination_stays WHERE trip_id=$1 AND city_id=$2 AND stay_id=$4 AND can_plan_trip(trip_id,$3)),
                removed AS (DELETE FROM destination_stay_locations WHERE trip_id=$1 AND city_id=$2 AND stay_id=$4 AND EXISTS(SELECT 1 FROM eligible))
                SELECT EXISTS(SELECT 1 FROM eligible);
                """
                : """
                INSERT INTO destination_stay_locations (trip_id,city_id,stay_id,feature)
                SELECT trip_id, city_id, stay_id, $5 FROM destination_stays WHERE trip_id=$1 AND city_id=$2 AND stay_id=$4 AND can_plan_trip(trip_id,$3)
                ON CONFLICT(trip_id,city_id,stay_id) DO UPDATE SET feature=EXCLUDED.feature
                RETURNING true;
                """
        );
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(cityId);
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(stayId);
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
