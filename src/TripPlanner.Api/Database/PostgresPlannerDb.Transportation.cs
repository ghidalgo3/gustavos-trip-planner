using System.Text.Json;
using Npgsql;
using NpgsqlTypes;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Documents;
using TripPlanner.Api.Services.Flights;

namespace TripPlanner.Api.Database;

public sealed partial class PostgresPlannerDb
{
    public async Task<IReadOnlyList<Transportation>> GetTransportationAsync(
        Guid userId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            "SELECT transportation_document(x.id)::text FROM transportation x JOIN trips t ON t.id=x.trip_id WHERE t.id=$2 AND "
                + PlanningVisible
                + " ORDER BY x.id"
        );
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(tripId);
        var result = new List<Transportation>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(
                JsonSerializer.Deserialize<Transportation>(
                    reader.GetString(0),
                    TripResourceProjection.JsonOptions
                )!
            );
        }
        return result;
    }

    public async Task<Transportation?> SaveTransportationAsync(
        Guid userId,
        Guid tripId,
        Transportation transportation,
        long? expectedVersion,
        CancellationToken cancellationToken = default
    )
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await BeginWriteTransactionAsync(
            connection,
            cancellationToken
        );
        await using var command = connection.CreateCommand();
        command.CommandText = expectedVersion is null
            ? "INSERT INTO transportation(id,trip_id,document,route_features,route_stale) SELECT $1,$2,$3,$4,$5 WHERE can_plan_trip($2,$6) ON CONFLICT(id) DO NOTHING RETURNING version"
            : "UPDATE transportation SET document=$3,route_features=$4,route_stale=$5,version=version+1 WHERE id=$1 AND trip_id=$2 AND can_plan_trip($2,$6) AND version=$7 RETURNING version";
        var json = JsonSerializer
            .SerializeToNode(transportation, TripResourceProjection.JsonOptions)!
            .AsObject();
        foreach (var key in new[] { "features", "id", "version", "routeStale", "etag", "type" })
        {
            json.Remove(key);
        }
        command.Parameters.AddWithValue(transportation.Id);
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(NpgsqlDbType.Jsonb, json.ToJsonString());
        command.Parameters.AddWithValue(
            NpgsqlDbType.Jsonb,
            JsonSerializer.Serialize(
                transportation.Features.Where(f => f.Id is not ("from" or "to")),
                TripResourceProjection.JsonOptions
            )
        );
        command.Parameters.AddWithValue(transportation.RouteStale);
        command.Parameters.AddWithValue(userId);
        if (expectedVersion is not null)
        {
            command.Parameters.AddWithValue(expectedVersion.Value);
        }
        if (await command.ExecuteScalarAsync(cancellationToken) is null)
        {
            return null;
        }
        foreach (var feature in transportation.Features.Where(f => f.Id is "from" or "to"))
        {
            await using var endpoint = connection.CreateCommand();
            endpoint.CommandText = """
                INSERT INTO transportation_endpoints(transportation_id,trip_id,role,activity_id,airport_id,hotel_id,home_user_id,feature)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8)
                ON CONFLICT(transportation_id,role) DO UPDATE SET activity_id=EXCLUDED.activity_id,airport_id=EXCLUDED.airport_id,
                    hotel_id=EXCLUDED.hotel_id,home_user_id=EXCLUDED.home_user_id,feature=EXCLUDED.feature
                """;
            endpoint.Parameters.AddWithValue(transportation.Id);
            endpoint.Parameters.AddWithValue(tripId);
            endpoint.Parameters.AddWithValue(feature.Id);
            foreach (var kind in new[] { "activity", "airport", "hotel", "home" })
            {
                endpoint.Parameters.AddWithValue(
                    NpgsqlDbType.Uuid,
                    feature.Properties.Reference?.Kind == kind
                        ? feature.Properties.Reference.Id
                        : DBNull.Value
                );
            }
            endpoint.Parameters.AddWithValue(
                NpgsqlDbType.Jsonb,
                JsonSerializer.Serialize(feature, TripResourceProjection.JsonOptions)
            );
            await endpoint.ExecuteNonQueryAsync(cancellationToken);
        }
        await using var read = connection.CreateCommand();
        read.CommandText = "SELECT transportation_document($1)::text";
        read.Parameters.AddWithValue(transportation.Id);
        var saved = JsonSerializer.Deserialize<Transportation>(
            (string)(await read.ExecuteScalarAsync(cancellationToken))!,
            TripResourceProjection.JsonOptions
        )!;
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }
        return saved;
    }

    public async Task<bool> DeleteTransportationAsync(
        Guid userId,
        Guid tripId,
        Guid transportationId,
        long expectedVersion,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            "DELETE FROM transportation WHERE id=$1 AND trip_id=$2 AND version=$3 AND can_plan_trip(trip_id,$4) RETURNING true"
        );
        command.Parameters.AddWithValue(transportationId);
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(expectedVersion);
        command.Parameters.AddWithValue(userId);
        return await command.ExecuteScalarAsync(cancellationToken) is true;
    }

    public async Task<IReadOnlyList<Hotel>> GetHotelsAsync(
        Guid userId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            "SELECT hotel_document(h.id)::text FROM hotels h JOIN trips t ON t.id=h.trip_id WHERE t.id=$2 AND "
                + PlanningVisible
                + " ORDER BY h.id"
        );
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(tripId);
        var result = new List<Hotel>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(
                JsonSerializer.Deserialize<Hotel>(
                    reader.GetString(0),
                    TripResourceProjection.JsonOptions
                )!
            );
        }
        return result;
    }

    public async Task<Hotel?> SaveHotelAsync(
        Guid userId,
        Guid tripId,
        Hotel hotel,
        long? expectedVersion,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            expectedVersion is null
                ? "INSERT INTO hotels(id,trip_id,name,address,location,time_zone) SELECT $1,$2,$3,$4,ST_SetSRID(ST_MakePoint($5,$6),4326)::geography,$7 WHERE can_plan_trip($2,$8) ON CONFLICT(id) DO NOTHING RETURNING hotel_document(id)::text"
                : "UPDATE hotels SET name=$3,address=$4,location=ST_SetSRID(ST_MakePoint($5,$6),4326)::geography,time_zone=$7,version=version+1 WHERE id=$1 AND trip_id=$2 AND can_plan_trip($2,$8) AND version=$9 RETURNING hotel_document(id)::text"
        );
        command.Parameters.AddWithValue(hotel.Id);
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(hotel.Name);
        command.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)hotel.Address ?? DBNull.Value);
        command.Parameters.AddWithValue(hotel.Geometry.Position.Longitude);
        command.Parameters.AddWithValue(hotel.Geometry.Position.Latitude);
        command.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)hotel.TimeZone ?? DBNull.Value);
        command.Parameters.AddWithValue(userId);
        if (expectedVersion is not null)
        {
            command.Parameters.AddWithValue(expectedVersion.Value);
        }
        // RETURNING reads the just-written row directly; do not rely on a STABLE function's statement snapshot.
        command.CommandText = command.CommandText.Replace(
            "hotel_document(id)::text",
            "jsonb_build_object('id',id,'tripId',trip_id,'name',name,'address',address,'geometry',ST_AsGeoJSON(location::geometry)::jsonb,'timeZone',time_zone,'version',version)::text"
        );
        var result = await command.ExecuteScalarAsync(cancellationToken);
        return result is string value
            ? JsonSerializer.Deserialize<Hotel>(value, TripResourceProjection.JsonOptions)
            : null;
    }

    public async Task<bool> DeleteHotelAsync(
        Guid userId,
        Guid tripId,
        Guid hotelId,
        long expectedVersion,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            "DELETE FROM hotels WHERE id=$1 AND trip_id=$2 AND version=$3 AND can_plan_trip(trip_id,$4) RETURNING true"
        );
        command.Parameters.AddWithValue(hotelId);
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(expectedVersion);
        command.Parameters.AddWithValue(userId);
        return await command.ExecuteScalarAsync(cancellationToken) is true;
    }

    public async Task<IReadOnlyList<Airport>> RefreshAirportsAsync(
        Airport[] airports,
        CancellationToken cancellationToken = default
    )
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = """
                WITH gate AS MATERIALIZED (SELECT pg_advisory_xact_lock(1937003882)),
                retired AS (UPDATE airports SET active=false FROM gate WHERE NOT(code=ANY($2)) AND active)
                INSERT INTO airports(id,code,name,city,country,location,time_zone,major,keywords,active)
                SELECT (a->>'id')::uuid,a->>'code',a->>'name',a->>'city',a->>'country',
                    ST_SetSRID(ST_MakePoint((a->>'longitude')::double precision,(a->>'latitude')::double precision),4326)::geography,
                    a->>'timeZone',(a->>'major')::boolean,a->>'keywords',true FROM jsonb_array_elements($1) a CROSS JOIN gate
                ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,city=EXCLUDED.city,country=EXCLUDED.country,
                    location=EXCLUDED.location,time_zone=EXCLUDED.time_zone,major=EXCLUDED.major,keywords=EXCLUDED.keywords,active=true,refreshed_at=now();
                """;
            command.Parameters.AddWithValue(
                NpgsqlDbType.Jsonb,
                JsonSerializer.Serialize(airports, TripResourceProjection.JsonOptions)
            );
            command.Parameters.AddWithValue(airports.Select(a => a.Code).ToArray());
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        await using var read = connection.CreateCommand();
        read.CommandText =
            "SELECT jsonb_build_object('id',id,'code',code,'name',name,'city',city,'country',country,'longitude',ST_X(location::geometry),'latitude',ST_Y(location::geometry),'timeZone',time_zone,'major',major,'keywords',keywords,'active',active)::text FROM airports WHERE location IS NOT NULL AND time_zone IS NOT NULL ORDER BY code";
        var result = new List<Airport>();
        await using (var reader = await read.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                result.Add(
                    JsonSerializer.Deserialize<Airport>(
                        reader.GetString(0),
                        TripResourceProjection.JsonOptions
                    )!
                );
            }
        }
        await transaction.CommitAsync(cancellationToken);
        return result;
    }
}
