using NpgsqlTypes;
using TripPlanner.Api.DTO;

namespace TripPlanner.Api.Database;

public sealed partial class PostgresPlannerDb
{
    public async Task<TripListPage> GetTripPageAsync(
        Guid viewerUserId,
        TripListQuery query,
        DateOnly today,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            WITH visible AS (
                SELECT t.*, can_plan_trip(t.id, $1) AS can_plan,
                    COALESCE(first_visit.arrival_date, first_visit.departure_date) AS start_date,
                    COALESCE(last_visit.departure_date, last_visit.arrival_date) AS end_date
                FROM trips t
                LEFT JOIN LATERAL (
                    SELECT arrival_date, departure_date FROM destination_stays
                    WHERE trip_id = t.id ORDER BY visit_order, stay_id LIMIT 1
                ) first_visit ON true
                LEFT JOIN LATERAL (
                    SELECT arrival_date, departure_date FROM destination_stays
                    WHERE trip_id = t.id ORDER BY visit_order DESC, stay_id DESC LIMIT 1
                ) last_visit ON true
                WHERE (can_plan_trip(t.id, $1) OR EXISTS (
                    SELECT 1 FROM parties p WHERE p.trip_id = t.id AND $1 = ANY(p.user_ids)
                )) AND strpos(lower(t.name), lower($2)) > 0
            )
            SELECT id, owner_user_id, name, description, constraints::text,
                created_at, updated_at, flight_constraints::text, can_plan, start_date, end_date,
                ARRAY(
                    SELECT DISTINCT upper(btrim(d.country_code))
                    FROM destination_places d
                    WHERE d.trip_id = visible.id AND btrim(d.country_code) <> ''
                        AND EXISTS (
                            SELECT 1 FROM destination_stays s
                            WHERE s.trip_id = d.trip_id AND s.city_id = d.city_id
                        )
                    ORDER BY 1
                ) AS country_codes
            FROM visible
            WHERE $3::boolean IS NULL OR $3 = COALESCE(end_date < $4, false)
            ORDER BY
                CASE WHEN end_date < $4 THEN 2
                     WHEN COALESCE(start_date, end_date) IS NULL THEN 1 ELSE 0 END,
                CASE WHEN end_date < $4 THEN $4 - end_date
                     ELSE GREATEST(COALESCE(start_date, end_date) - $4, 0) END NULLS LAST,
                lower(name) COLLATE "C", id
            LIMIT $5 OFFSET $6;
            """
        );
        command.Parameters.AddWithValue(viewerUserId);
        command.Parameters.AddWithValue(query.Search?.Trim() ?? "");
        command.Parameters.AddWithValue(NpgsqlDbType.Boolean, (object?)query.Past ?? DBNull.Value);
        command.Parameters.AddWithValue(today);
        command.Parameters.AddWithValue(TripListQuery.PageSize + 1);
        command.Parameters.AddWithValue(query.Skip);
        var trips = new List<TripResponse>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            trips.Add(
                TripResponse.From(ReadTrip(reader), reader.GetBoolean(8)) with
                {
                    StartDate = reader.IsDBNull(9) ? null : reader.GetFieldValue<DateOnly>(9),
                    EndDate = reader.IsDBNull(10) ? null : reader.GetFieldValue<DateOnly>(10),
                    CountryCodes = reader.GetFieldValue<string[]>(11),
                }
            );
        }
        return new(
            trips.Take(TripListQuery.PageSize).ToArray(),
            trips.Count > TripListQuery.PageSize
        );
    }
}
