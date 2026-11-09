using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Spatial;
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
        {
            items.Add(ReadPlace(reader));
        }

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
        {
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
        }

        return visits;
    }

    private static async Task<bool> ValidateVisitDatesAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction? transaction,
        Guid userId,
        Guid tripId,
        string cityId,
        Guid? stayId,
        DateOnly? arrival,
        DateOnly? departure,
        CancellationToken cancellationToken
    )
    {
        // Separate statements ensure a concurrent writer's committed dates are visible
        // after acquiring the trip lock, including writes to a different destination.
        await using var guard = new NpgsqlCommand(
            """
            SELECT id FROM trips WHERE id=$1 AND can_plan_trip(id,$2)
              AND ($3::uuid IS NULL OR EXISTS (
                SELECT 1 FROM destination_stays WHERE trip_id=$1 AND stay_id=$3 AND city_id=$4))
            FOR UPDATE;
            """,
            connection,
            transaction
        );
        guard.Parameters.AddWithValue(tripId);
        guard.Parameters.AddWithValue(userId);
        guard.Parameters.AddWithValue(NpgsqlDbType.Uuid, (object?)stayId ?? DBNull.Value);
        guard.Parameters.AddWithValue(cityId);
        if (await guard.ExecuteScalarAsync(cancellationToken) is null)
        {
            return false;
        }
        await using var check = new NpgsqlCommand(
            "SELECT arrival_date,departure_date FROM destination_stays WHERE trip_id=$1 AND ($2::uuid IS NULL OR stay_id<>$2);",
            connection,
            transaction
        );
        check.Parameters.AddWithValue(tripId);
        check.Parameters.AddWithValue(NpgsqlDbType.Uuid, (object?)stayId ?? DBNull.Value);
        await using var reader = await check.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            if (
                DestinationVisitDates.Overlap(
                    arrival,
                    departure,
                    reader.IsDBNull(0) ? null : reader.GetFieldValue<DateOnly>(0),
                    reader.IsDBNull(1) ? null : reader.GetFieldValue<DateOnly>(1)
                )
            )
            {
                throw new DestinationDatesOverlapException();
            }
        }
        return true;
    }

    public async Task<DestinationVisit?> AddDestinationVisitAsync(
        Guid ownerUserId,
        DestinationVisit visit,
        CancellationToken cancellationToken = default
    )
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await BeginWriteTransactionAsync(
            connection,
            cancellationToken
        );
        if (
            !await ValidateVisitDatesAsync(
                connection,
                transaction,
                ownerUserId,
                visit.TripId,
                visit.CityId,
                null,
                visit.ArrivalDate,
                visit.DepartureDate,
                cancellationToken
            )
        )
        {
            return null;
        }
        await using var command = new NpgsqlCommand(
            """
            WITH owner AS (UPDATE trips SET updated_at=updated_at WHERE id=$1 AND can_plan_trip(id, $2) RETURNING id),
            added AS (INSERT INTO destination_stays(stay_id,trip_id,city_id,visit_order,arrival_date,departure_date)
              SELECT $3,owner.id,$4,COALESCE((SELECT max(visit_order)+1 FROM destination_stays WHERE trip_id=owner.id),0),$5,$6 FROM owner
              WHERE EXISTS(SELECT 1 FROM destination_places d WHERE d.trip_id=owner.id AND d.city_id=$4)
              RETURNING trip_id,city_id,stay_id,visit_order,arrival_date,departure_date)
            UPDATE destination_places d SET context_version=$7 FROM added a
            WHERE d.trip_id=a.trip_id AND d.city_id=a.city_id
            RETURNING a.trip_id,a.city_id,a.stay_id,a.visit_order,a.arrival_date,a.departure_date;
            """,
            connection,
            transaction
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
        DestinationVisit? saved = await reader.ReadAsync(cancellationToken)
            ? new(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetGuid(2),
                reader.GetInt32(3),
                reader.IsDBNull(4) ? null : reader.GetFieldValue<DateOnly>(4),
                reader.IsDBNull(5) ? null : reader.GetFieldValue<DateOnly>(5)
            )
            : null;
        await reader.CloseAsync();
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }
        return saved;
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
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await BeginWriteTransactionAsync(
            connection,
            cancellationToken
        );
        if (
            !await ValidateVisitDatesAsync(
                connection,
                transaction,
                ownerUserId,
                tripId,
                cityId,
                stayId,
                input.ArrivalDate,
                input.DepartureDate,
                cancellationToken
            )
        )
        {
            return null;
        }
        await using var command = new NpgsqlCommand(
            """
            WITH owner AS (UPDATE trips SET updated_at=updated_at WHERE id=$1 AND can_plan_trip(id, $2) RETURNING id),
            saved AS (UPDATE destination_stays v SET arrival_date=$5,departure_date=$6 FROM owner o
              WHERE v.trip_id=o.id AND v.city_id=$3 AND v.stay_id=$4
              RETURNING v.trip_id,v.city_id,v.stay_id,v.visit_order,v.arrival_date,v.departure_date)
            UPDATE destination_places d SET context_version=$7 FROM saved s
            WHERE d.trip_id=s.trip_id AND d.city_id=s.city_id
            RETURNING s.trip_id,s.city_id,s.stay_id,s.visit_order,s.arrival_date,s.departure_date;
            """,
            connection,
            transaction
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
        DestinationVisit? saved = await reader.ReadAsync(cancellationToken)
            ? new(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetGuid(2),
                reader.GetInt32(3),
                reader.IsDBNull(4) ? null : reader.GetFieldValue<DateOnly>(4),
                reader.IsDBNull(5) ? null : reader.GetFieldValue<DateOnly>(5)
            )
            : null;
        await reader.CloseAsync();
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }
        return saved;
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
        {
            items.Add(ReadActivity(reader));
        }

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
            : new GeoJsonPoint(
                "Point",
                GeographyPoint.Create(latitude: reader.GetDouble(4), longitude: reader.GetDouble(3))
            );
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
            (object?)activity.Geometry?.Position.Longitude ?? DBNull.Value
        );
        command.Parameters.AddWithValue(
            NpgsqlDbType.Double,
            (object?)activity.Geometry?.Position.Latitude ?? DBNull.Value
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
}
