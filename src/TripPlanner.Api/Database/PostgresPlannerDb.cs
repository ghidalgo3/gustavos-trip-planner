using System.Text.Json;
using Npgsql;
using NpgsqlTypes;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Database;

public sealed partial class PostgresPlannerDb(NpgsqlDataSource dataSource) : IPlannerDb
{
    private static async Task<NpgsqlTransaction?> BeginWriteTransactionAsync(
        NpgsqlConnection connection,
        CancellationToken cancellationToken
    ) =>
        System.Transactions.Transaction.Current is null
            ? await connection.BeginTransactionAsync(cancellationToken)
            : null;

    public async Task<IReadOnlyList<Party>> GetPartiesAsync(
        Guid viewerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            SELECT p.id, p.trip_id, p.user_ids, p.member_roles::text FROM parties p
            JOIN trips t ON t.id = p.trip_id
            WHERE t.id = $2 AND (can_plan_trip(t.id, $1) OR EXISTS (
                SELECT 1 FROM parties membership
                WHERE membership.trip_id = t.id AND $1 = ANY(membership.user_ids)
            ))
            ORDER BY p.id;
            """
        );
        command.Parameters.AddWithValue(viewerUserId);
        command.Parameters.AddWithValue(tripId);
        var parties = new List<Party>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            parties.Add(
                new(reader.GetGuid(0), reader.GetGuid(1), reader.GetFieldValue<Guid[]>(2))
                {
                    MemberRoles =
                        JsonSerializer.Deserialize<Dictionary<Guid, string>>(reader.GetString(3))
                        ?? [],
                }
            );
        return parties;
    }

    public async Task<Trip?> SetFlightConstraintsAsync(
        Guid ownerUserId,
        Guid tripId,
        JsonElement constraints,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            UPDATE trips SET flight_constraints = $1, updated_at = now()
            WHERE can_plan_trip(id, $2) AND id = $3
            RETURNING id, owner_user_id, name, description, constraints::text, created_at, updated_at, flight_constraints::text;
            """
        );
        command.Parameters.AddWithValue(NpgsqlDbType.Jsonb, constraints.GetRawText());
        command.Parameters.AddWithValue(ownerUserId);
        command.Parameters.AddWithValue(tripId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadTrip(reader) : null;
    }

    public async Task<User> GetOrCreateUserAsync(
        AuthenticatedUserProfile profile,
        CancellationToken cancellationToken = default
    )
    {
        await using NpgsqlCommand command = dataSource.CreateCommand(
            """
            INSERT INTO users (
                id, provider, email, display_name
            )
            VALUES (
                $1, $2, $3, $4
            )
            ON CONFLICT (email) DO UPDATE
            SET
                provider = users.provider || ',' || EXCLUDED.provider,
                updated_at = now()
            WHERE array_position(string_to_array(users.provider, ','), EXCLUDED.provider) IS NULL;
            """
        );

        command.Parameters.AddWithValue(Guid.NewGuid());
        command.Parameters.AddWithValue(profile.Provider);
        command.Parameters.AddWithValue(profile.Email);
        command.Parameters.AddWithValue(profile.DisplayName);

        await command.ExecuteNonQueryAsync(cancellationToken);

        return await FindUserAsync(profile, cancellationToken)
            ?? throw new InvalidOperationException("The user could not be created or retrieved.");
    }

    public async Task<User?> GetUserAsync(
        Guid userId,
        CancellationToken cancellationToken = default
    )
    {
        await using NpgsqlCommand command = dataSource.CreateCommand(
            """
            SELECT
                id, provider, email, display_name,
                home_city_name,
                ST_X(home_city_location::geometry) AS home_city_longitude,
                ST_Y(home_city_location::geometry) AS home_city_latitude,
                created_at, updated_at, preferred_airlines, "FeatureFlags", preferred_airport
            FROM users
            WHERE id = $1;
            """
        );
        command.Parameters.AddWithValue(userId);

        await using NpgsqlDataReader reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadUser(reader) : null;
    }

    public async Task<User?> GetUserByEmailAsync(
        string email,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            SELECT
                id, provider, email, display_name,
                home_city_name,
                ST_X(home_city_location::geometry) AS home_city_longitude,
                ST_Y(home_city_location::geometry) AS home_city_latitude,
                created_at, updated_at, preferred_airlines, "FeatureFlags", preferred_airport
            FROM users
            WHERE email = $1;
            """
        );
        command.Parameters.AddWithValue(email);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadUser(reader) : null;
    }

    public async Task<User> SetUserProfileAsync(
        Guid userId,
        UserProfile profile,
        CancellationToken cancellationToken = default
    )
    {
        await using NpgsqlCommand command = dataSource.CreateCommand(
            """
            UPDATE users
            SET
                home_city_name = $1,
                home_city_location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
                preferred_airlines = $4,
                preferred_airport = $6,
                updated_at = now()
            WHERE id = $5;
            """
        );
        command.Parameters.AddWithValue(profile.HomeCity!.Name);
        command.Parameters.AddWithValue(profile.HomeCity.Longitude);
        command.Parameters.AddWithValue(profile.HomeCity.Latitude);
        command.Parameters.AddWithValue(profile.PreferredAirlines!);
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(
            NpgsqlDbType.Text,
            (object?)profile.PreferredAirport ?? DBNull.Value
        );
        if (await command.ExecuteNonQueryAsync(cancellationToken) != 1)
            throw new InvalidOperationException("The user could not be found.");

        return await GetUserAsync(userId, cancellationToken)
            ?? throw new InvalidOperationException("The user's profile could not be saved.");
    }

    public async Task<User> SetUserFeatureFlagsAsync(
        Guid userId,
        string featureFlags,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            "UPDATE users SET \"FeatureFlags\" = $1, updated_at = now() WHERE id = $2;"
        );
        command.Parameters.AddWithValue(featureFlags);
        command.Parameters.AddWithValue(userId);
        if (await command.ExecuteNonQueryAsync(cancellationToken) != 1)
            throw new InvalidOperationException("The user could not be found.");
        return await GetUserAsync(userId, cancellationToken)
            ?? throw new InvalidOperationException("The user could not be found.");
    }

    public async Task<IReadOnlyList<Trip>> GetTripsAsync(
        Guid viewerUserId,
        CancellationToken cancellationToken = default
    )
    {
        await using NpgsqlCommand command = dataSource.CreateCommand(
            """
            SELECT
                id, owner_user_id, name, description, constraints::text,
                created_at, updated_at, flight_constraints::text
            FROM trips
            WHERE can_plan_trip(id, $1) OR EXISTS (
                SELECT 1 FROM parties membership
                WHERE membership.trip_id = trips.id AND $1 = ANY(membership.user_ids)
            )
            ORDER BY updated_at DESC, id;
            """
        );
        command.Parameters.AddWithValue(viewerUserId);

        var trips = new List<Trip>();
        await using NpgsqlDataReader reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            trips.Add(ReadTrip(reader));
        }

        return trips;
    }

    public async Task<Trip?> GetVisibleTripAsync(
        Guid viewerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            SELECT id, owner_user_id, name, description, constraints::text, created_at, updated_at, flight_constraints::text
            FROM trips
            WHERE id = $2 AND (can_plan_trip(id, $1) OR EXISTS (
                SELECT 1 FROM parties membership
                WHERE membership.trip_id = trips.id AND $1 = ANY(membership.user_ids)
            ));
            """
        );
        command.Parameters.AddWithValue(viewerUserId);
        command.Parameters.AddWithValue(tripId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadTrip(reader) : null;
    }

    public async Task<Trip?> GetTripAsync(
        Guid ownerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        await using NpgsqlCommand command = dataSource.CreateCommand(
            """
            SELECT
                id, owner_user_id, name, description, constraints::text,
                created_at, updated_at, flight_constraints::text
            FROM trips
            WHERE can_plan_trip(id, $1) AND id = $2;
            """
        );
        command.Parameters.AddWithValue(ownerUserId);
        command.Parameters.AddWithValue(tripId);

        await using NpgsqlDataReader reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadTrip(reader) : null;
    }

    public async Task<Trip> CreateTripAsync(
        Guid ownerUserId,
        string name,
        string description,
        CancellationToken cancellationToken = default,
        JsonElement? constraints = null
    )
    {
        Guid tripId = Guid.NewGuid();
        await using NpgsqlConnection connection = await dataSource.OpenConnectionAsync(
            cancellationToken
        );
        await using var transaction = await BeginWriteTransactionAsync(
            connection,
            cancellationToken
        );

        Trip trip;
        await using (
            var command = new NpgsqlCommand(
                """
                INSERT INTO trips (id, owner_user_id, name, description, constraints)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING
                    id, owner_user_id, name, description, constraints::text,
                    created_at, updated_at, flight_constraints::text;
                """,
                connection,
                transaction
            )
        )
        {
            command.Parameters.AddWithValue(tripId);
            command.Parameters.AddWithValue(ownerUserId);
            command.Parameters.AddWithValue(name);
            command.Parameters.AddWithValue(description);
            command.Parameters.AddWithValue(NpgsqlDbType.Jsonb, constraints?.GetRawText() ?? "{}");
            await using NpgsqlDataReader reader = await command.ExecuteReaderAsync(
                cancellationToken
            );
            if (!await reader.ReadAsync(cancellationToken))
            {
                throw new InvalidOperationException("The trip could not be created.");
            }

            trip = ReadTrip(reader);
        }

        await using (
            var command = new NpgsqlCommand(
                """
                INSERT INTO parties (id, trip_id, user_ids)
                VALUES ($1, $2, $3);
                """,
                connection,
                transaction
            )
        )
        {
            command.Parameters.AddWithValue(Guid.NewGuid());
            command.Parameters.AddWithValue(tripId);
            command.Parameters.AddWithValue(new[] { ownerUserId });
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        if (transaction is not null)
            await transaction.CommitAsync(cancellationToken);
        return trip;
    }

    public async Task<Trip?> UpdateTripAsync(
        Guid ownerUserId,
        Guid tripId,
        string name,
        string description,
        CancellationToken cancellationToken = default,
        JsonElement? constraints = null
    )
    {
        await using NpgsqlCommand command = dataSource.CreateCommand(
            """
            UPDATE trips
            SET name = $1, description = $2, constraints = COALESCE($5, constraints), updated_at = now()
            WHERE can_plan_trip(id, $3) AND id = $4
            RETURNING
                id, owner_user_id, name, description, constraints::text,
                created_at, updated_at, flight_constraints::text;
            """
        );
        command.Parameters.AddWithValue(name);
        command.Parameters.AddWithValue(description);
        command.Parameters.AddWithValue(ownerUserId);
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(
            NpgsqlDbType.Jsonb,
            (object?)constraints?.GetRawText() ?? DBNull.Value
        );

        await using NpgsqlDataReader reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadTrip(reader) : null;
    }

    public async Task<bool> DeleteTripAsync(
        Guid ownerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        await using NpgsqlCommand command = dataSource.CreateCommand(
            "DELETE FROM trips WHERE owner_user_id = $1 AND id = $2;"
        );
        command.Parameters.AddWithValue(ownerUserId);
        command.Parameters.AddWithValue(tripId);
        return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
    }

    private async Task<User?> FindUserAsync(
        AuthenticatedUserProfile profile,
        CancellationToken cancellationToken
    )
    {
        await using NpgsqlCommand command = dataSource.CreateCommand(
            """
            SELECT
                id, provider, email, display_name,
                home_city_name,
                ST_X(home_city_location::geometry) AS home_city_longitude,
                ST_Y(home_city_location::geometry) AS home_city_latitude,
                created_at, updated_at, preferred_airlines, "FeatureFlags", preferred_airport
            FROM users
            WHERE email = $1;
            """
        );
        command.Parameters.AddWithValue(profile.Email);

        await using NpgsqlDataReader reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return ReadUser(reader);
    }

    private static string? GetNullableString(NpgsqlDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);

    private static User ReadUser(NpgsqlDataReader reader)
    {
        GeographicPoint? homeCityLocation =
            reader.IsDBNull(5) || reader.IsDBNull(6)
                ? null
                : new GeographicPoint(reader.GetDouble(5), reader.GetDouble(6));

        return new User(
            reader.GetGuid(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetString(3),
            GetNullableString(reader, 4),
            homeCityLocation,
            reader.GetFieldValue<string[]>(9),
            reader.GetFieldValue<DateTimeOffset>(7),
            reader.GetFieldValue<DateTimeOffset>(8),
            reader.GetString(10),
            GetNullableString(reader, 11)
        );
    }

    private static Trip ReadTrip(NpgsqlDataReader reader)
    {
        using var document = JsonDocument.Parse(reader.GetString(4));
        using var flights = JsonDocument.Parse(reader.GetString(7));
        return new(
            reader.GetGuid(0),
            reader.GetGuid(1),
            reader.GetString(2),
            reader.GetString(3),
            document.RootElement.Clone(),
            reader.GetFieldValue<DateTimeOffset>(5),
            reader.GetFieldValue<DateTimeOffset>(6)
        )
        {
            FlightConstraints = flights.RootElement.Clone(),
        };
    }
}
