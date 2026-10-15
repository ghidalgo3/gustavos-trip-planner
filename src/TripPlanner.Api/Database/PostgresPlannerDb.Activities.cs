using System.Security.Cryptography;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Database;

public sealed partial class PostgresPlannerDb
{
    private const string ActivityColumns =
        "a.id, a.trip_id, a.city_id, ST_X(a.location::geometry), ST_Y(a.location::geometry), a.properties::text, a.created_at, a.updated_at, a.source_operation_id";

    public async Task<DestinationPlace?> GetDestinationPlaceAsync(
        Guid viewerUserId,
        Guid tripId,
        string cityId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            SELECT d.trip_id, d.city_id, d.name, d.country_code, d.time_zone,
                ST_X(d.center::geometry), ST_Y(d.center::geometry), d.context_version, d.constraints::text
            FROM destination_places d JOIN trips t ON t.id=d.trip_id
            WHERE d.trip_id=$1 AND d.city_id=$2 AND (can_plan_trip(t.id, $3) OR EXISTS (
                SELECT 1 FROM parties p WHERE p.trip_id=t.id AND $3=ANY(p.user_ids)));
            """
        );
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(cityId);
        command.Parameters.AddWithValue(viewerUserId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadPlace(reader) : null;
    }

    public async Task<DestinationPlace> SaveDestinationPlaceAsync(
        Guid ownerUserId,
        DestinationPlace place,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            INSERT INTO destination_places(trip_id,city_id,name,country_code,time_zone,center,constraints)
            SELECT $1,$2,$3,$4,$5,ST_SetSRID(ST_MakePoint($6,$7),4326)::geography,$9
            FROM trips t WHERE t.id=$1 AND can_plan_trip(t.id, $8)
            ON CONFLICT(trip_id,city_id) DO UPDATE SET city_id=EXCLUDED.city_id
            RETURNING trip_id,city_id,name,country_code,time_zone,ST_X(center::geometry),ST_Y(center::geometry),context_version,constraints::text;
            """
        );
        command.Parameters.AddWithValue(place.TripId);
        command.Parameters.AddWithValue(place.CityId);
        command.Parameters.AddWithValue(place.Name);
        command.Parameters.AddWithValue(place.CountryCode);
        command.Parameters.AddWithValue(place.TimeZone);
        command.Parameters.AddWithValue(place.Longitude);
        command.Parameters.AddWithValue(place.Latitude);
        command.Parameters.AddWithValue(ownerUserId);
        command.Parameters.AddWithValue(NpgsqlDbType.Jsonb, place.Constraints.GetRawText());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? ReadPlace(reader)
            : throw new InvalidOperationException("The trip no longer exists.");
    }

    public async Task<IReadOnlyList<DestinationPlace>> GetDestinationPlacesAsync(
        Guid viewerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            SELECT d.trip_id,d.city_id,d.name,d.country_code,d.time_zone,ST_X(d.center::geometry),ST_Y(d.center::geometry),d.context_version,d.constraints::text
            FROM destination_places d JOIN trips t ON t.id=d.trip_id
            WHERE d.trip_id=$1 AND (can_plan_trip(t.id, $2) OR EXISTS (
                SELECT 1 FROM parties p WHERE p.trip_id=t.id AND $2=ANY(p.user_ids))) ORDER BY d.city_id;
            """
        );
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(viewerUserId);
        var items = new List<DestinationPlace>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            items.Add(ReadPlace(reader));
        return items;
    }

    public async Task<DestinationPlace?> ReplaceDestinationPlaceAsync(
        Guid ownerUserId,
        DestinationPlace place,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            WITH owner AS (UPDATE trips SET updated_at=updated_at WHERE id=$1 AND can_plan_trip(id, $8) RETURNING id)
            UPDATE destination_places d SET name=$3,country_code=$4,time_zone=$5,
                center=ST_SetSRID(ST_MakePoint($6,$7),4326)::geography,constraints=$9,context_version=$10
            FROM owner o WHERE d.trip_id=o.id AND d.city_id=$2
            RETURNING d.trip_id,d.city_id,d.name,d.country_code,d.time_zone,ST_X(d.center::geometry),ST_Y(d.center::geometry),d.context_version,d.constraints::text;
            """
        );
        command.Parameters.AddWithValue(place.TripId);
        command.Parameters.AddWithValue(place.CityId);
        command.Parameters.AddWithValue(place.Name);
        command.Parameters.AddWithValue(place.CountryCode);
        command.Parameters.AddWithValue(place.TimeZone);
        command.Parameters.AddWithValue(place.Longitude);
        command.Parameters.AddWithValue(place.Latitude);
        command.Parameters.AddWithValue(ownerUserId);
        command.Parameters.AddWithValue(NpgsqlDbType.Jsonb, place.Constraints.GetRawText());
        command.Parameters.AddWithValue(Guid.NewGuid().ToString("N"));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadPlace(reader) : null;
    }

    public async Task<bool> DeleteDestinationAsync(
        Guid ownerUserId,
        Guid tripId,
        string cityId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            WITH owner AS (UPDATE trips SET updated_at=updated_at WHERE id=$1 AND can_plan_trip(id, $2) RETURNING id),
            jobs AS (DELETE FROM activity_jobs j USING owner o WHERE j.trip_id=o.id AND j.city_id=$3 RETURNING j.operation_id),
            operations_removed AS (DELETE FROM operations WHERE id IN (SELECT operation_id FROM jobs)),
            activities AS (DELETE FROM activities a USING owner o WHERE a.trip_id=o.id AND a.city_id=$3),
            stays AS (DELETE FROM destination_stays s USING owner o WHERE s.trip_id=o.id AND s.city_id=$3)
            DELETE FROM destination_places d USING owner o WHERE d.trip_id=o.id AND d.city_id=$3;
            """
        );
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(ownerUserId);
        command.Parameters.AddWithValue(cityId);
        return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
    }

    private static DestinationPlace ReadPlace(NpgsqlDataReader reader) =>
        new(
            reader.GetGuid(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.GetString(4),
            reader.GetDouble(5),
            reader.GetDouble(6),
            reader.GetString(7)
        )
        {
            Constraints = JsonSerializer.Deserialize<JsonElement>(reader.GetString(8)),
        };

    public async Task<IReadOnlyList<DestinationVisit>> GetDestinationVisitsAsync(
        Guid viewerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            SELECT v.trip_id,v.city_id,v.stay_id,v.visit_order,v.arrival_date,v.departure_date
            FROM destination_stays v JOIN trips t ON t.id=v.trip_id
            WHERE v.trip_id=$1 AND (can_plan_trip(t.id, $2) OR EXISTS
              (SELECT 1 FROM parties p WHERE p.trip_id=t.id AND $2=ANY(p.user_ids)))
            ORDER BY v.visit_order,v.stay_id;
            """
        );
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(viewerUserId);
        var visits = new List<DestinationVisit>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            visits.Add(
                new(
                    reader.GetGuid(0),
                    reader.GetString(1),
                    reader.GetGuid(2),
                    reader.GetInt32(3),
                    reader.IsDBNull(4) ? null : reader.GetFieldValue<DateOnly>(4),
                    reader.IsDBNull(5) ? null : reader.GetFieldValue<DateOnly>(5)
                )
            );
        return visits;
    }

    public async Task<DestinationVisit?> AddDestinationVisitAsync(
        Guid ownerUserId,
        DestinationVisit visit,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            WITH owner AS (UPDATE trips SET updated_at=updated_at WHERE id=$1 AND can_plan_trip(id, $2) RETURNING id),
            added AS (INSERT INTO destination_stays(stay_id,trip_id,city_id,visit_order,arrival_date,departure_date)
              SELECT $3,owner.id,$4,COALESCE((SELECT max(visit_order)+1 FROM destination_stays WHERE trip_id=owner.id),0),$5,$6 FROM owner
              WHERE EXISTS(SELECT 1 FROM destination_places d WHERE d.trip_id=owner.id AND d.city_id=$4)
              RETURNING trip_id,city_id,stay_id,visit_order,arrival_date,departure_date)
            UPDATE destination_places d SET context_version=$7 FROM added a
            WHERE d.trip_id=a.trip_id AND d.city_id=a.city_id
            RETURNING a.trip_id,a.city_id,a.stay_id,a.visit_order,a.arrival_date,a.departure_date;
            """
        );
        command.Parameters.AddWithValue(visit.TripId);
        command.Parameters.AddWithValue(ownerUserId);
        command.Parameters.AddWithValue(visit.StayId);
        command.Parameters.AddWithValue(visit.CityId);
        command.Parameters.AddWithValue(
            NpgsqlDbType.Date,
            (object?)visit.ArrivalDate ?? DBNull.Value
        );
        command.Parameters.AddWithValue(
            NpgsqlDbType.Date,
            (object?)visit.DepartureDate ?? DBNull.Value
        );
        command.Parameters.AddWithValue(Guid.NewGuid().ToString("N"));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? new(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetGuid(2),
                reader.GetInt32(3),
                reader.IsDBNull(4) ? null : reader.GetFieldValue<DateOnly>(4),
                reader.IsDBNull(5) ? null : reader.GetFieldValue<DateOnly>(5)
            )
            : null;
    }

    public async Task<DestinationVisit?> ReplaceDestinationVisitAsync(
        Guid ownerUserId,
        Guid tripId,
        string cityId,
        Guid stayId,
        DestinationStayInput input,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            WITH owner AS (UPDATE trips SET updated_at=updated_at WHERE id=$1 AND can_plan_trip(id, $2) RETURNING id),
            saved AS (UPDATE destination_stays v SET arrival_date=$5,departure_date=$6 FROM owner o
              WHERE v.trip_id=o.id AND v.city_id=$3 AND v.stay_id=$4
              RETURNING v.trip_id,v.city_id,v.stay_id,v.visit_order,v.arrival_date,v.departure_date)
            UPDATE destination_places d SET context_version=$7 FROM saved s
            WHERE d.trip_id=s.trip_id AND d.city_id=s.city_id
            RETURNING s.trip_id,s.city_id,s.stay_id,s.visit_order,s.arrival_date,s.departure_date;
            """
        );
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(ownerUserId);
        command.Parameters.AddWithValue(cityId);
        command.Parameters.AddWithValue(stayId);
        command.Parameters.AddWithValue(
            NpgsqlDbType.Date,
            (object?)input.ArrivalDate ?? DBNull.Value
        );
        command.Parameters.AddWithValue(
            NpgsqlDbType.Date,
            (object?)input.DepartureDate ?? DBNull.Value
        );
        command.Parameters.AddWithValue(Guid.NewGuid().ToString("N"));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? new(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetGuid(2),
                reader.GetInt32(3),
                reader.IsDBNull(4) ? null : reader.GetFieldValue<DateOnly>(4),
                reader.IsDBNull(5) ? null : reader.GetFieldValue<DateOnly>(5)
            )
            : null;
    }

    public async Task<bool> DeleteDestinationVisitAsync(
        Guid ownerUserId,
        Guid tripId,
        string cityId,
        Guid stayId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            WITH owner AS (UPDATE trips SET updated_at=updated_at WHERE id=$1 AND can_plan_trip(id, $2) RETURNING id),
            removed AS (DELETE FROM destination_stays v USING owner o WHERE v.trip_id=o.id AND v.city_id=$3 AND v.stay_id=$4 RETURNING v.trip_id,v.city_id)
            UPDATE destination_places d SET context_version=$5 FROM removed r
            WHERE d.trip_id=r.trip_id AND d.city_id=r.city_id RETURNING d.city_id;
            """
        );
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(ownerUserId);
        command.Parameters.AddWithValue(cityId);
        command.Parameters.AddWithValue(stayId);
        command.Parameters.AddWithValue(Guid.NewGuid().ToString("N"));
        return await command.ExecuteScalarAsync(cancellationToken) is not null;
    }

    public async Task<IReadOnlyList<Activity>> GetActivitiesAsync(
        Guid viewerUserId,
        Guid tripId,
        string cityId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            $"""
            SELECT {ActivityColumns} FROM activities a JOIN trips t ON t.id=a.trip_id
            WHERE a.trip_id=$1 AND a.city_id=$2 AND (can_plan_trip(t.id, $3) OR EXISTS (
                SELECT 1 FROM parties p WHERE p.trip_id=t.id AND $3=ANY(p.user_ids)))
            ORDER BY a.created_at,a.id;
            """
        );
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(cityId);
        command.Parameters.AddWithValue(viewerUserId);
        var items = new List<Activity>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            items.Add(ReadActivity(reader));
        return items;
    }

    public async Task<Activity?> GetActivityAsync(
        Guid viewerUserId,
        Guid tripId,
        string cityId,
        Guid activityId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            $"""
            SELECT {ActivityColumns} FROM activities a JOIN trips t ON t.id=a.trip_id
            WHERE a.id=$1 AND a.trip_id=$2 AND a.city_id=$3 AND (can_plan_trip(t.id, $4) OR EXISTS (
                SELECT 1 FROM parties p WHERE p.trip_id=t.id AND $4=ANY(p.user_ids)));
            """
        );
        command.Parameters.AddWithValue(activityId);
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(cityId);
        command.Parameters.AddWithValue(viewerUserId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadActivity(reader) : null;
    }

    private static Activity ReadActivity(NpgsqlDataReader reader)
    {
        var point = reader.IsDBNull(3)
            ? null
            : new GeoJsonPoint("Point", [reader.GetDouble(3), reader.GetDouble(4)]);
        return new(
            reader.GetGuid(0),
            reader.GetGuid(1),
            reader.GetString(2),
            point,
            JsonSerializer.Deserialize<ActivityProperties>(
                reader.GetString(5),
                JsonSerializerOptions.Web
            )!,
            reader.GetFieldValue<DateTimeOffset>(6),
            reader.GetFieldValue<DateTimeOffset>(7),
            reader.IsDBNull(8) ? null : reader.GetGuid(8)
        );
    }

    private static string DestinationGuard(int cityParameter) =>
        $$"""
            WITH eligible AS (
                UPDATE trips t SET updated_at=updated_at
                WHERE t.id=$1 AND can_plan_trip(t.id, $2)
                  AND EXISTS (SELECT 1 FROM destination_places d JOIN destination_stays v ON v.trip_id=d.trip_id AND v.city_id=d.city_id WHERE d.trip_id=t.id AND d.city_id=${{cityParameter}} AND d.context_version=$3)
                RETURNING t.id
            )
            """;

    public async Task<Activity?> SaveActivityAsync(
        Guid ownerUserId,
        Activity activity,
        string contextVersion,
        DateTimeOffset? expectedUpdatedAt,
        CancellationToken cancellationToken = default
    )
    {
        bool update = expectedUpdatedAt.HasValue;
        string sql =
            DestinationGuard(5)
            + (
                update
                    ? $"""
                        UPDATE activities a SET
                            location=CASE WHEN $7::double precision IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($7,$8),4326)::geography END,
                            properties=$9::jsonb, updated_at=$10
                        FROM eligible e
                        WHERE a.id=$4 AND a.trip_id=e.id AND a.city_id=$5 AND a.updated_at=$11
                        RETURNING {ActivityColumns};
                        """
                    : $"""
                        INSERT INTO activities(id,trip_id,city_id,location,properties,created_at,updated_at,source_operation_id)
                        SELECT $4,e.id,$5,CASE WHEN $7::double precision IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($7,$8),4326)::geography END,$9::jsonb,$10,$10,$12
                        FROM eligible e WHERE EXISTS (SELECT 1 FROM destination_places d WHERE d.trip_id=e.id AND d.city_id=$5)
                        ON CONFLICT(id) DO NOTHING
                        RETURNING id,trip_id,city_id,ST_X(location::geometry),ST_Y(location::geometry),properties::text,created_at,updated_at,source_operation_id;
                        """
            );
        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue(activity.TripId);
        command.Parameters.AddWithValue(ownerUserId);
        command.Parameters.AddWithValue(contextVersion);
        command.Parameters.AddWithValue(activity.Id);
        command.Parameters.AddWithValue(activity.CityId);
        command.Parameters.AddWithValue(NpgsqlDbType.Text, activity.CityId);
        command.Parameters.AddWithValue(
            NpgsqlDbType.Double,
            (object?)activity.Geometry?.Coordinates[0] ?? DBNull.Value
        );
        command.Parameters.AddWithValue(
            NpgsqlDbType.Double,
            (object?)activity.Geometry?.Coordinates[1] ?? DBNull.Value
        );
        command.Parameters.AddWithValue(
            NpgsqlDbType.Jsonb,
            JsonSerializer.Serialize(activity.Properties, JsonSerializerOptions.Web)
        );
        command.Parameters.AddWithValue(activity.UpdatedAt);
        command.Parameters.AddWithValue(
            NpgsqlDbType.TimestampTz,
            (object?)expectedUpdatedAt ?? DBNull.Value
        );
        command.Parameters.AddWithValue(
            NpgsqlDbType.Uuid,
            (object?)activity.SourceOperationId ?? DBNull.Value
        );
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadActivity(reader) : null;
    }

    public async Task<bool> DeleteActivityAsync(
        Guid ownerUserId,
        Guid tripId,
        string cityId,
        Guid activityId,
        string contextVersion,
        DateTimeOffset expectedUpdatedAt,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            DestinationGuard(5)
                + """
                DELETE FROM activities a USING eligible e
                WHERE a.id=$4 AND a.trip_id=e.id AND a.city_id=$5 AND a.updated_at=$6;
                """
        );
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(ownerUserId);
        command.Parameters.AddWithValue(contextVersion);
        command.Parameters.AddWithValue(activityId);
        command.Parameters.AddWithValue(cityId);
        command.Parameters.AddWithValue(expectedUpdatedAt);
        return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
    }

    public async Task<TrackedOperation> CreateActivityJobAsync(
        Guid ownerUserId,
        Guid tripId,
        Guid requestId,
        string cityId,
        string contextVersion,
        string input,
        byte[]? image,
        string? mimeType,
        CancellationToken cancellationToken = default
    )
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using var operation = new NpgsqlCommand(
            """
            INSERT INTO operations(id,user_id,resource_id,type,status,items)
            SELECT $1,$2,$3,'activitySuggest','pending',1 FROM trips t
            WHERE t.id=$3 AND can_plan_trip(t.id, $2)
              AND EXISTS (SELECT 1 FROM destination_places d JOIN destination_stays v ON v.trip_id=d.trip_id AND v.city_id=d.city_id WHERE d.trip_id=t.id AND d.city_id=$5 AND d.context_version=$4)
            ON CONFLICT(id) DO NOTHING;
            """,
            connection,
            transaction
        );
        operation.Parameters.AddWithValue(requestId);
        operation.Parameters.AddWithValue(ownerUserId);
        operation.Parameters.AddWithValue(tripId);
        operation.Parameters.AddWithValue(contextVersion);
        operation.Parameters.AddWithValue(cityId);
        bool inserted = await operation.ExecuteNonQueryAsync(cancellationToken) == 1;
        if (inserted)
        {
            await using var command = new NpgsqlCommand(
                """
                INSERT INTO activity_jobs(operation_id,trip_id,city_id,context_version,input,image,image_sha256,image_mime_type)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8);
                """,
                connection,
                transaction
            );
            command.Parameters.AddWithValue(requestId);
            command.Parameters.AddWithValue(tripId);
            command.Parameters.AddWithValue(cityId);
            command.Parameters.AddWithValue(contextVersion);
            command.Parameters.AddWithValue(input);
            command.Parameters.AddWithValue(NpgsqlDbType.Bytea, (object?)image ?? DBNull.Value);
            command.Parameters.AddWithValue(
                NpgsqlDbType.Text,
                image is null ? DBNull.Value : Convert.ToHexString(SHA256.HashData(image))
            );
            command.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)mimeType ?? DBNull.Value);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        else
        {
            await using var check = new NpgsqlCommand(
                """
                SELECT 1 FROM activity_jobs j JOIN operations o ON o.id=j.operation_id
                WHERE j.operation_id=$1 AND o.user_id=$2 AND j.trip_id=$3 AND j.city_id=$4
                  AND j.context_version=$5 AND j.input=$6 AND j.image_sha256 IS NOT DISTINCT FROM $7::text;
                """,
                connection,
                transaction
            );
            check.Parameters.AddWithValue(requestId);
            check.Parameters.AddWithValue(ownerUserId);
            check.Parameters.AddWithValue(tripId);
            check.Parameters.AddWithValue(cityId);
            check.Parameters.AddWithValue(contextVersion);
            check.Parameters.AddWithValue(input);
            check.Parameters.AddWithValue(
                NpgsqlDbType.Text,
                image is null ? DBNull.Value : Convert.ToHexString(SHA256.HashData(image))
            );
            if (await check.ExecuteScalarAsync(cancellationToken) is null)
                throw new InvalidOperationException(
                    "This request ID was already used, or the destination changed."
                );
        }
        await transaction.CommitAsync(cancellationToken);
        return (await GetOperationAsync(ownerUserId, requestId, cancellationToken))!;
    }

    public async Task<ActivityJob?> ClaimActivityJobAsync(
        TimeSpan leaseDuration,
        CancellationToken cancellationToken = default
    )
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        Guid leaseId = Guid.NewGuid();
        await using var command = new NpgsqlCommand(
            """
            UPDATE activity_jobs j SET lease_id=$1,lease_expires_at=now()+$2::interval,attempts=j.attempts+1
            FROM (SELECT j.operation_id FROM activity_jobs j JOIN operations o ON o.id=j.operation_id
                  WHERE j.result IS NULL AND j.error IS NULL AND o.status IN ('pending','InProgress')
                    AND (j.lease_expires_at IS NULL OR j.lease_expires_at<now())
                  ORDER BY j.created_at,j.operation_id FOR UPDATE OF j SKIP LOCKED LIMIT 1) next,
                 operations o
            WHERE j.operation_id=next.operation_id AND o.id=j.operation_id
            RETURNING j.operation_id,o.user_id,j.trip_id,j.city_id,j.context_version,j.input,j.image,j.image_mime_type,j.attempts;
            """,
            connection,
            transaction
        );
        command.Parameters.AddWithValue(leaseId);
        command.Parameters.AddWithValue(leaseDuration);
        ActivityJob? job = null;
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
            if (await reader.ReadAsync(cancellationToken))
                job = new(
                    reader.GetGuid(0),
                    reader.GetGuid(1),
                    reader.GetGuid(2),
                    reader.GetString(3),
                    reader.GetString(4),
                    reader.GetString(5),
                    reader.IsDBNull(6) ? null : reader.GetFieldValue<byte[]>(6),
                    reader.IsDBNull(7) ? null : reader.GetString(7),
                    leaseId,
                    reader.GetInt32(8)
                );
        if (job is not null)
        {
            await using var status = new NpgsqlCommand(
                "UPDATE operations SET status='InProgress',updated_at=now() WHERE id=$1;",
                connection,
                transaction
            );
            status.Parameters.AddWithValue(job.OperationId);
            await status.ExecuteNonQueryAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return job;
    }

    public async Task<bool> CompleteActivityJobAsync(
        ActivityJob job,
        IReadOnlyList<Activity>? activities,
        string[] warnings,
        string? error,
        CancellationToken cancellationToken = default
    )
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using var lockJob = new NpgsqlCommand(
            "SELECT 1 FROM activity_jobs WHERE operation_id=$1 AND lease_id=$2 AND result IS NULL AND error IS NULL FOR UPDATE;",
            connection,
            transaction
        );
        lockJob.Parameters.AddWithValue(job.OperationId);
        lockJob.Parameters.AddWithValue(job.LeaseId);
        if (await lockJob.ExecuteScalarAsync(cancellationToken) is null)
            return false;
        if (error is null)
        {
            await using var guard = new NpgsqlCommand(
                DestinationGuard(4) + "SELECT id FROM eligible;",
                connection,
                transaction
            );
            guard.Parameters.AddWithValue(job.TripId);
            guard.Parameters.AddWithValue(job.UserId);
            guard.Parameters.AddWithValue(job.DestinationContext);
            guard.Parameters.AddWithValue(job.CityId);
            if (await guard.ExecuteScalarAsync(cancellationToken) is null)
                error = "Destination changed. Try again.";
        }
        if (error is null)
        {
            foreach (Activity activity in activities ?? [])
            {
                await using var insert = new NpgsqlCommand(
                    """
                    INSERT INTO activities(id,trip_id,city_id,location,properties,source_operation_id,created_at,updated_at)
                    VALUES($1,$2,$3,CASE WHEN $4::double precision IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($4,$5),4326)::geography END,$6::jsonb,$7,$8,$8)
                    ON CONFLICT(id) DO NOTHING;
                    """,
                    connection,
                    transaction
                );
                insert.Parameters.AddWithValue(activity.Id);
                insert.Parameters.AddWithValue(activity.TripId);
                insert.Parameters.AddWithValue(activity.CityId);
                insert.Parameters.AddWithValue(
                    NpgsqlDbType.Double,
                    (object?)activity.Geometry?.Coordinates[0] ?? DBNull.Value
                );
                insert.Parameters.AddWithValue(
                    NpgsqlDbType.Double,
                    (object?)activity.Geometry?.Coordinates[1] ?? DBNull.Value
                );
                insert.Parameters.AddWithValue(
                    NpgsqlDbType.Jsonb,
                    JsonSerializer.Serialize(activity.Properties, JsonSerializerOptions.Web)
                );
                insert.Parameters.AddWithValue(job.OperationId);
                insert.Parameters.AddWithValue(activity.CreatedAt);
                await insert.ExecuteNonQueryAsync(cancellationToken);
            }
        }
        var result = error is null
            ? new ActivitySuggestionResult(
                job.OperationId,
                new("FeatureCollection", (activities ?? []).Select(a => a.ToFeature()).ToArray()),
                warnings
            )
            : null;
        await using var complete = new NpgsqlCommand(
            """
            WITH completed AS (
                UPDATE activity_jobs SET result=$3::jsonb,error=$4,image=NULL,lease_id=NULL,lease_expires_at=NULL
                WHERE operation_id=$1 AND lease_id=$2 RETURNING operation_id
            )
            UPDATE operations o SET status=CASE WHEN $4::text IS NULL THEN 'Completed' ELSE 'Failed' END,
                completed_items=CASE WHEN $4::text IS NULL THEN 1 ELSE 0 END,
                failed_items=CASE WHEN $4::text IS NULL THEN 0 ELSE 1 END,updated_at=now()
            FROM completed c WHERE o.id=c.operation_id;
            """,
            connection,
            transaction
        );
        complete.Parameters.AddWithValue(job.OperationId);
        complete.Parameters.AddWithValue(job.LeaseId);
        complete.Parameters.AddWithValue(
            NpgsqlDbType.Jsonb,
            result is null
                ? DBNull.Value
                : JsonSerializer.Serialize(result, JsonSerializerOptions.Web)
        );
        complete.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)error ?? DBNull.Value);
        await complete.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    public async Task<ActivitySuggestionResult?> GetActivityJobResultAsync(
        Guid viewerUserId,
        Guid tripId,
        string cityId,
        Guid operationId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            SELECT j.result::text FROM activity_jobs j JOIN trips t ON t.id=j.trip_id
            WHERE j.operation_id=$1 AND j.trip_id=$2 AND j.city_id=$3 AND
              (can_plan_trip(t.id, $4) OR EXISTS (SELECT 1 FROM parties p WHERE p.trip_id=t.id AND $4=ANY(p.user_ids)));
            """
        );
        command.Parameters.AddWithValue(operationId);
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(cityId);
        command.Parameters.AddWithValue(viewerUserId);
        string? json = (string?)await command.ExecuteScalarAsync(cancellationToken);
        return json is null
            ? null
            : JsonSerializer.Deserialize<ActivitySuggestionResult>(json, JsonSerializerOptions.Web);
    }
}
