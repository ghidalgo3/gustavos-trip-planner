using System.Text.Json;
using Npgsql;
using NpgsqlTypes;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Database;

public sealed class PostgresTripImportStore(NpgsqlDataSource source) : ITripImportStore
{
    public async Task<TripImportResult> ImportAsync(
        Guid ownerId,
        Guid transferId,
        TripDocument request,
        CancellationToken cancellationToken
    )
    {
        Guid tripId = request.Id;
        await using var connection = await source.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        // Serialize both the idempotency key and source identity before checking or inserting.
        foreach (
            string key in new[] { $"trip-import:{ownerId}:{transferId}", $"trip-source:{tripId}" }
        )
        {
            await using var lockCommand = new NpgsqlCommand(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                connection,
                transaction
            );
            lockCommand.Parameters.AddWithValue(key);
            await lockCommand.ExecuteNonQueryAsync(cancellationToken);
        }
        string payload = JsonSerializer.Serialize(request);
        await using var receipt = new NpgsqlCommand(
            """
            SELECT source_trip_id, payload = $3::jsonb
            FROM trip_imports WHERE owner_user_id = $1 AND transfer_id = $2
            """,
            connection,
            transaction
        );
        receipt.Parameters.AddWithValue(ownerId);
        receipt.Parameters.AddWithValue(transferId);
        receipt.Parameters.AddWithValue(NpgsqlDbType.Jsonb, payload);
        Guid? existingId = null;
        bool matches = false;
        await using (var reader = await receipt.ExecuteReaderAsync(cancellationToken))
        {
            if (await reader.ReadAsync(cancellationToken))
            {
                existingId = reader.GetGuid(0);
                matches = reader.GetBoolean(1);
            }
        }
        if (existingId is Guid id)
        {
            if (!matches)
            {
                return new(409);
            }
            var existing = await ReadTripAsync(
                connection,
                transaction,
                ownerId,
                id,
                cancellationToken
            );
            await transaction.CommitAsync(cancellationToken);
            return existing is null ? new(410) : new(200, existing);
        }

        await using var collision = new NpgsqlCommand(
            """
            SELECT EXISTS(SELECT 1 FROM trips WHERE id = $1)
                OR EXISTS(SELECT 1 FROM trip_imports WHERE source_trip_id = $1)
            """,
            connection,
            transaction
        );
        collision.Parameters.AddWithValue(tripId);
        if ((bool)(await collision.ExecuteScalarAsync(cancellationToken))!)
        {
            return new(409);
        }

        await using var insert = new NpgsqlCommand(
            """
            INSERT INTO trips(id, owner_user_id, name, description, constraints)
            VALUES ($1, $2, $3, $4, $5);
            """,
            connection,
            transaction
        );
        insert.Parameters.AddWithValue(tripId);
        insert.Parameters.AddWithValue(ownerId);
        insert.Parameters.AddWithValue(request.Name.Trim());
        insert.Parameters.AddWithValue(request.Description ?? "");
        insert.Parameters.AddWithValue(
            NpgsqlDbType.Jsonb,
            request.Preferences["constraints"]!.ToJsonString()
        );
        await insert.ExecuteNonQueryAsync(cancellationToken);

        await using var party = new NpgsqlCommand(
            "INSERT INTO parties(id, trip_id, user_ids) VALUES ($1, $2, $3)",
            connection,
            transaction
        );
        party.Parameters.AddWithValue(Guid.NewGuid());
        party.Parameters.AddWithValue(tripId);
        party.Parameters.AddWithValue(new[] { ownerId });
        await party.ExecuteNonQueryAsync(cancellationToken);

        await using var saveReceipt = new NpgsqlCommand(
            """
            INSERT INTO trip_imports(owner_user_id, transfer_id, source_trip_id, payload)
            VALUES ($1, $2, $3, $4)
            """,
            connection,
            transaction
        );
        saveReceipt.Parameters.AddWithValue(ownerId);
        saveReceipt.Parameters.AddWithValue(transferId);
        saveReceipt.Parameters.AddWithValue(tripId);
        saveReceipt.Parameters.AddWithValue(NpgsqlDbType.Jsonb, payload);
        await saveReceipt.ExecuteNonQueryAsync(cancellationToken);
        var trip = await ReadTripAsync(connection, transaction, ownerId, tripId, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new(201, trip);
    }

    public async Task<TripImportResult> GetAsync(
        Guid ownerId,
        Guid transferId,
        CancellationToken cancellationToken
    )
    {
        await using var connection = await source.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            "SELECT source_trip_id FROM trip_imports WHERE owner_user_id = $1 AND transfer_id = $2",
            connection
        );
        command.Parameters.AddWithValue(ownerId);
        command.Parameters.AddWithValue(transferId);
        if (await command.ExecuteScalarAsync(cancellationToken) is not Guid tripId)
        {
            return new(404);
        }
        var trip = await ReadTripAsync(connection, null, ownerId, tripId, cancellationToken);
        return trip is null ? new(410) : new(200, trip);
    }

    private static async Task<Trip?> ReadTripAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction? transaction,
        Guid ownerId,
        Guid tripId,
        CancellationToken cancellationToken
    )
    {
        await using var command = new NpgsqlCommand(
            """
            SELECT id, owner_user_id, name, description, constraints::text, created_at, updated_at
            FROM trips WHERE id = $1 AND owner_user_id = $2
            """,
            connection,
            transaction
        );
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(ownerId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }
        return new(
            reader.GetGuid(0),
            reader.GetGuid(1),
            reader.GetString(2),
            reader.GetString(3),
            JsonSerializer.Deserialize<JsonElement>(reader.GetString(4)),
            reader.GetFieldValue<DateTimeOffset>(5),
            reader.GetFieldValue<DateTimeOffset>(6)
        );
    }
}
