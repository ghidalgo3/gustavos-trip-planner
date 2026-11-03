using System.Text.Json;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Snapshots;

namespace TripPlanner.Api.Database;

public sealed partial class PostgresPlannerDb
{
    public async Task<TripSnapshotData?> ReadTripSnapshotAsync(
        Guid userId,
        Guid tripId,
        CancellationToken cancellationToken
    )
    {
        // A single statement captures one PostgreSQL snapshot, including when called
        // inside the transaction that checks a resource's write precondition.
        await using var command = dataSource.CreateCommand(
            """
            WITH visible_trip AS (
                SELECT t.*, can_plan_trip(t.id, $1) AS can_plan
                FROM trips t
                WHERE t.id = $2 AND (
                    can_plan_trip(t.id, $1) OR EXISTS (
                        SELECT 1 FROM parties p WHERE p.trip_id = t.id AND $1 = ANY(p.user_ids)
                    )
                )
            ), trip_parties AS (
                SELECT p.* FROM parties p JOIN visible_trip t ON t.id = p.trip_id
            ), people AS (
                SELECT unnest(p.user_ids) AS id FROM trip_parties p
                UNION SELECT owner_user_id FROM visible_trip
            ), destinations AS (
                SELECT d.* FROM destination_places d JOIN visible_trip t ON t.id = d.trip_id
            )
            SELECT jsonb_build_object(
                'trip', jsonb_build_object(
                    'id', t.id, 'ownerUserId', t.owner_user_id, 'name', t.name,
                    'description', t.description, 'constraints', t.constraints,
                    'createdAt', t.created_at, 'updatedAt', t.updated_at),
                'canPlan', t.can_plan,
                'parties', COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                        'id', p.id, 'tripId', p.trip_id, 'userIds', p.user_ids,
                        'memberRoles', p.member_roles) ORDER BY p.id)
                    FROM trip_parties p), '[]'),
                'people', COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                        'id', u.id, 'provider', u.provider, 'email', u.email,
                        'displayName', u.display_name, 'homeCityName', u.home_city_name,
                        'homeCityLocation', CASE WHEN u.home_city_location IS NOT NULL THEN
                            jsonb_build_object('longitude', ST_X(u.home_city_location::geometry),
                                'latitude', ST_Y(u.home_city_location::geometry)) END,
                        'createdAt', u.created_at, 'updatedAt', u.updated_at,
                        'preferredAirlines', u.preferred_airlines,
                        'featureFlags', u."FeatureFlags", 'preferredAirport', u.preferred_airport)
                        ORDER BY u.id)
                    FROM users u JOIN people p ON p.id = u.id), '[]'),
                'destinations', COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                        'tripId', d.trip_id, 'cityId', d.city_id, 'name', d.name,
                        'countryCode', d.country_code, 'timeZone', d.time_zone,
                        'longitude', ST_X(d.center::geometry), 'latitude', ST_Y(d.center::geometry),
                        'contextVersion', d.context_version, 'constraints', d.constraints)
                        ORDER BY d.city_id COLLATE "C")
                    FROM destinations d), '[]'),
                'visits', COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                        'tripId', v.trip_id, 'cityId', v.city_id, 'stayId', v.stay_id,
                        'order', v.visit_order, 'arrivalDate', v.arrival_date,
                        'departureDate', v.departure_date) ORDER BY v.visit_order, v.stay_id)
                    FROM destination_stays v WHERE v.trip_id = t.id), '[]'),
                'stays', COALESCE((
                    SELECT jsonb_object_agg(s.stay_id, s.feature)
                    FROM destination_stay_locations s WHERE s.trip_id = t.id), '{}'),
                'activities', COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                        'id', a.id, 'tripId', a.trip_id, 'cityId', a.city_id,
                        'geometry', CASE WHEN a.location IS NOT NULL THEN jsonb_build_object(
                            'type', 'Point', 'coordinates', jsonb_build_array(
                                ST_X(a.location::geometry), ST_Y(a.location::geometry))) END,
                        'properties', a.properties, 'createdAt', a.created_at,
                        'updatedAt', a.updated_at, 'sourceOperationId', a.source_operation_id)
                        ORDER BY a.id)
                    FROM activities a JOIN destinations d ON d.city_id = a.city_id
                    WHERE a.trip_id = t.id), '[]'),
                'tripPreferences', jsonb_build_object(
                    'preferences', COALESCE(tp.preferences, '{}'), 'version', COALESCE(tp.version, 0)),
                'destinationPreferences', COALESCE((
                    SELECT jsonb_object_agg(d.city_id, jsonb_build_object(
                        'preferences', COALESCE(p.preferences, '{}'), 'version', COALESCE(p.version, 0)))
                    FROM destinations d LEFT JOIN activity_preferences p
                        ON p.subject_id = d.trip_id AND p.scope = 'destination' AND p.city_id = d.city_id), '{}'),
                'privatePreferences', COALESCE((
                    SELECT jsonb_object_agg(u.id, COALESCE(p.preferences, '{}'))
                    FROM users u JOIN people ids ON ids.id = u.id LEFT JOIN activity_preferences p
                        ON p.subject_id = u.id AND p.scope = 'profile' AND p.city_id = ''), '{}'),
                'plans', COALESCE((
                    SELECT jsonb_object_agg(d.city_id, CASE WHEN p.trip_id IS NOT NULL THEN
                        jsonb_build_object('plan', p.plan, 'assessment', p.assessment, 'version', p.version,
                            'inputRevision', p.input_revision, 'savedAt', p.saved_at) END)
                    FROM destinations d LEFT JOIN activity_plans p
                        ON p.trip_id = d.trip_id AND p.city_id = d.city_id), '{}'),
                'evidence', COALESCE((
                    SELECT jsonb_object_agg(d.city_id, COALESCE(e.evidence, '{}'))
                    FROM destinations d LEFT JOIN activity_planning_evidence e
                        ON e.trip_id = d.trip_id AND e.city_id = d.city_id), '{}'),
                'flights', COALESCE((SELECT jsonb_agg(value ORDER BY key)
                    FROM jsonb_each(t.selected_flights)), '[]'),
                'choices', COALESCE((SELECT jsonb_agg(value ORDER BY key)
                    FROM jsonb_each(t.flight_choices)), '[]'),
                'contextRevision', COALESCE(v.revision, -1),
                'travel', jsonb_build_object(
                    'connections', COALESCE(travel.document, '[]'), 'version', COALESCE(travel.version, 0)),
                'modifiedAt', COALESCE(v.modified_at, 'epoch'::timestamptz)
            )::text, t.flight_constraints::text
            FROM visible_trip t
            LEFT JOIN activity_preferences tp ON tp.subject_id = t.id AND tp.scope = 'trip' AND tp.city_id = ''
            LEFT JOIN activity_planning_versions v ON v.trip_id = t.id
            LEFT JOIN trip_travel_plans travel ON travel.trip_id = t.id;
            """
        );
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(tripId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        var snapshot = JsonSerializer.Deserialize<TripSnapshotData>(
            reader.GetString(0),
            TripSnapshotProjection.JsonOptions
        )!;
        return snapshot with
        {
            Trip = snapshot.Trip with
            {
                FlightConstraints = JsonSerializer.Deserialize<JsonElement>(reader.GetString(1)),
            },
        };
    }
}
