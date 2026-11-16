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
            SELECT s.stay_id, hotel_stay_feature(s.stay_id,s.hotel_id)::text FROM destination_stay_locations s JOIN trips t ON t.id=s.trip_id
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
                WITH eligible AS (SELECT * FROM destination_stays WHERE trip_id=$1 AND city_id=$2 AND stay_id=$4 AND can_plan_trip(trip_id,$3)),
                created AS (
                    INSERT INTO hotels(id,trip_id,name,address,location,time_zone)
                    SELECT $6,$1,$5->'properties'->>'name',$5->'properties'->>'address',
                        ST_SetSRID(ST_GeomFromGeoJSON(($5->'geometry')::text),4326)::geography,
                        (SELECT time_zone FROM destination_places WHERE trip_id=$1 AND city_id=$2)
                    FROM eligible WHERE $7=false RETURNING id
                ), chosen AS (
                    SELECT id FROM created UNION ALL SELECT id FROM hotels WHERE id=$6 AND trip_id=$1 AND $7=true
                )
                INSERT INTO destination_stay_locations (trip_id,city_id,stay_id,hotel_id,check_in_time,check_out_time)
                SELECT e.trip_id,e.city_id,e.stay_id,c.id,$8,$9 FROM eligible e CROSS JOIN chosen c
                ON CONFLICT(trip_id,city_id,stay_id) DO UPDATE SET hotel_id=EXCLUDED.hotel_id,
                    check_in_time=EXCLUDED.check_in_time,check_out_time=EXCLUDED.check_out_time
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
            command.Parameters.AddWithValue(feature.Properties.HotelId ?? Guid.NewGuid());
            command.Parameters.AddWithValue(feature.Properties.HotelId is not null);
            command.Parameters.AddWithValue(NpgsqlDbType.Time, feature.Properties.CheckInTime);
            command.Parameters.AddWithValue(NpgsqlDbType.Time, feature.Properties.CheckOutTime);
        }

        return await command.ExecuteScalarAsync(cancellationToken) is true;
    }
}
