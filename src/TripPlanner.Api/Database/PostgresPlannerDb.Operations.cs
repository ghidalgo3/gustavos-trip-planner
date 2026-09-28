using System.Text.Json;
using Npgsql;
using NpgsqlTypes;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Database;

public sealed partial class PostgresPlannerDb
{
    public async Task<TrackedOperation> CreateFlightSearchOperationAsync(
        Guid userId,
        Guid tripId,
        Guid requestId,
        SearchPlanPreview preview,
        CancellationToken cancellationToken = default
    )
    {
        var searches = preview
            .Parties.SelectMany(p => p.Requests)
            .GroupBy(search => search.CacheKey, StringComparer.Ordinal)
            .Select(group => group.First())
            .OrderBy(search => search.CacheKey, StringComparer.Ordinal)
            .ToArray();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using var insertOperation = new NpgsqlCommand(
            """
            INSERT INTO operations(id, user_id, resource_id, type, status, items)
            SELECT $1, $2, $3, 'flightSearch', 'pending', $4
            FROM trips WHERE id=$3 AND owner_user_id=$2
            ON CONFLICT (id) DO NOTHING;
            """,
            connection,
            transaction
        );
        insertOperation.Parameters.AddWithValue(requestId);
        insertOperation.Parameters.AddWithValue(userId);
        insertOperation.Parameters.AddWithValue(tripId);
        insertOperation.Parameters.AddWithValue(searches.Length);
        var created = await insertOperation.ExecuteNonQueryAsync(cancellationToken) == 1;
        if (!created)
        {
            await using var existing = new NpgsqlCommand(
                """
                SELECT 1 FROM operations
                WHERE id=$1 AND user_id=$2 AND resource_id=$3 AND type='flightSearch';
                """,
                connection,
                transaction
            );
            existing.Parameters.AddWithValue(requestId);
            existing.Parameters.AddWithValue(userId);
            existing.Parameters.AddWithValue(tripId);
            if (await existing.ExecuteScalarAsync(cancellationToken) is null)
                throw new InvalidOperationException(
                    "This request ID was already used, or the trip no longer exists."
                );
            await transaction.CommitAsync(cancellationToken);
            return (await GetOperationAsync(userId, requestId, cancellationToken))!;
        }

        var completed = 0;
        foreach (var search in searches)
        {
            await using (
                var ensureFare = new NpgsqlCommand(
                    """
                    INSERT INTO fare_searches(cache_key, request) VALUES ($1, $2)
                    ON CONFLICT (cache_key) DO NOTHING;
                    """,
                    connection,
                    transaction
                )
            )
            {
                ensureFare.Parameters.AddWithValue(search.CacheKey);
                ensureFare.Parameters.AddWithValue(
                    NpgsqlDbType.Jsonb,
                    JsonSerializer.Serialize(search.Body)
                );
                await ensureFare.ExecuteNonQueryAsync(cancellationToken);
            }

            bool fresh;
            Guid? queuedOperationId;
            string? queuedOperationStatus;
            await using (
                var inspectFare = new NpgsqlCommand(
                    """
                    SELECT f.response IS NOT NULL AND f.expires_at > now(),
                        f.operation_id, o.status
                    FROM fare_searches f
                    LEFT JOIN operations o ON o.id=f.operation_id
                    WHERE f.cache_key=$1
                    FOR UPDATE OF f;
                    """,
                    connection,
                    transaction
                )
            )
            {
                inspectFare.Parameters.AddWithValue(search.CacheKey);
                await using var reader = await inspectFare.ExecuteReaderAsync(cancellationToken);
                await reader.ReadAsync(cancellationToken);
                fresh = reader.GetBoolean(0);
                queuedOperationId = reader.IsDBNull(1) ? null : reader.GetGuid(1);
                queuedOperationStatus = reader.IsDBNull(2) ? null : reader.GetString(2);
            }

            if (fresh)
            {
                completed++;
                continue;
            }
            if (
                queuedOperationId is not null
                && queuedOperationId != requestId
                && queuedOperationStatus is "pending" or "InProgress"
            )
                throw new InvalidOperationException(
                    "A matching flight search is already in progress."
                );

            await using var queueFare = new NpgsqlCommand(
                """
                UPDATE fare_searches
                SET request=$2, operation_id=$3, lease_id=NULL,
                    lease_expires_at=NULL, attempts=0
                WHERE cache_key=$1;
                """,
                connection,
                transaction
            );
            queueFare.Parameters.AddWithValue(search.CacheKey);
            queueFare.Parameters.AddWithValue(
                NpgsqlDbType.Jsonb,
                JsonSerializer.Serialize(search.Body)
            );
            queueFare.Parameters.AddWithValue(requestId);
            await queueFare.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (
            var updateOperation = new NpgsqlCommand(
                """
                UPDATE operations
                SET completed_items=$2,
                    status=CASE WHEN items=$2 THEN 'Completed' ELSE 'pending' END,
                    updated_at=now()
                WHERE id=$1;
                """,
                connection,
                transaction
            )
        )
        {
            updateOperation.Parameters.AddWithValue(requestId);
            updateOperation.Parameters.AddWithValue(completed);
            await updateOperation.ExecuteNonQueryAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return (await GetOperationAsync(userId, requestId, cancellationToken))!;
    }

    private const string OperationSelect = """
        SELECT id, resource_id, type, status, items, completed_items, failed_items,
            created_at, updated_at
        FROM operations
        WHERE user_id=$1
        """;

    public async Task<TrackedOperation?> GetOperationAsync(
        Guid userId,
        Guid operationId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(OperationSelect + " AND id=$2;");
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(operationId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadOperation(reader) : null;
    }

    public async Task<IReadOnlyList<TrackedOperation>> GetOperationsAsync(
        Guid userId,
        string? type,
        int top,
        int skip,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            OperationSelect
                + " AND ($2::text IS NULL OR type=$2)"
                + " ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4;"
        );
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)type ?? DBNull.Value);
        command.Parameters.AddWithValue(top);
        command.Parameters.AddWithValue(skip);
        var results = new List<TrackedOperation>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            results.Add(ReadOperation(reader));
        return results;
    }

    public async Task<IReadOnlyList<FareSearchResult>?> GetFareSearchResultsAsync(
        Guid userId,
        Guid tripId,
        SearchPlanPreview preview,
        CancellationToken cancellationToken = default
    )
    {
        var keys = preview
            .Parties.SelectMany(p => p.Requests)
            .Select(search => search.CacheKey)
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        if (keys.Length == 0)
            return [];

        await using var command = dataSource.CreateCommand(
            """
            SELECT f.cache_key, f.response::text, f.fetched_at, f.expires_at
            FROM fare_searches f
            WHERE f.cache_key=ANY($1)
                AND f.response IS NOT NULL AND f.expires_at > now()
                AND EXISTS (
                    SELECT 1 FROM trips t WHERE t.id=$2 AND t.owner_user_id=$3
                );
            """
        );
        command.Parameters.AddWithValue(keys);
        command.Parameters.AddWithValue(tripId);
        command.Parameters.AddWithValue(userId);
        var cached = new Dictionary<
            string,
            (JsonElement Response, DateTimeOffset FetchedAt, DateTimeOffset ExpiresAt)
        >(StringComparer.Ordinal);
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
                cached.Add(
                    reader.GetString(0),
                    (
                        ReadJson(reader, 1)!.Value,
                        reader.GetFieldValue<DateTimeOffset>(2),
                        reader.GetFieldValue<DateTimeOffset>(3)
                    )
                );
        }
        if (cached.Count != keys.Length)
            return null;

        return preview
            .Parties.SelectMany(p =>
                p.Requests.Select(search =>
                {
                    var fare = cached[search.CacheKey];
                    return new FareSearchResult(
                        p.PartyId,
                        search.CacheKey,
                        search.Body,
                        fare.Response,
                        fare.FetchedAt,
                        fare.ExpiresAt
                    );
                })
            )
            .ToArray();
    }

    public async Task<FareWork?> ClaimFareWorkAsync(
        TimeSpan leaseDuration,
        CancellationToken cancellationToken = default
    )
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var leaseId = Guid.NewGuid();
        await using var command = new NpgsqlCommand(
            """
            WITH candidate AS (
                SELECT f.cache_key
                FROM fare_searches f
                JOIN operations o ON o.id=f.operation_id
                WHERE o.status IN ('pending', 'InProgress')
                    AND (f.lease_expires_at IS NULL OR f.lease_expires_at <= now())
                ORDER BY f.created_at, f.cache_key
                FOR UPDATE OF f SKIP LOCKED LIMIT 1
            )
            UPDATE fare_searches f
            SET lease_id=$1, lease_expires_at=now()+$2, attempts=attempts+1
            FROM candidate c
            WHERE f.cache_key=c.cache_key
            RETURNING f.cache_key, f.request::text, f.operation_id, f.attempts;
            """,
            connection,
            transaction
        );
        command.Parameters.AddWithValue(leaseId);
        command.Parameters.AddWithValue(leaseDuration);
        FareWork? work;
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            work = await reader.ReadAsync(cancellationToken)
                ? new(
                    reader.GetString(0),
                    JsonSerializer.Deserialize<IgnavFareRequest>(reader.GetString(1))!,
                    reader.GetGuid(2),
                    leaseId,
                    reader.GetInt32(3)
                )
                : null;
        }
        if (work is not null)
        {
            await using var markOperation = new NpgsqlCommand(
                """
                UPDATE operations SET status='InProgress', updated_at=now()
                WHERE id=$1 AND status='pending';
                """,
                connection,
                transaction
            );
            markOperation.Parameters.AddWithValue(work.OperationId);
            await markOperation.ExecuteNonQueryAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return work;
    }

    public async Task<bool> CompleteFareWorkAsync(
        FareWork work,
        JsonElement? response,
        DateTimeOffset? fetchedAt,
        string? error,
        CancellationToken cancellationToken = default
    )
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var success = response is not null && fetchedAt is not null && error is null;
        await using var updateFare = new NpgsqlCommand(
            """
            UPDATE fare_searches
            SET operation_id=NULL, lease_id=NULL, lease_expires_at=NULL, attempts=0,
                response=CASE WHEN $4 THEN $5 ELSE response END,
                fetched_at=CASE WHEN $4 THEN $6 ELSE fetched_at END,
                expires_at=CASE WHEN $4 THEN $6 + interval '1 hour' ELSE expires_at END
            WHERE cache_key=$1 AND operation_id=$2 AND lease_id=$3
                AND lease_expires_at > now();
            """,
            connection,
            transaction
        );
        updateFare.Parameters.AddWithValue(work.CacheKey);
        updateFare.Parameters.AddWithValue(work.OperationId);
        updateFare.Parameters.AddWithValue(work.LeaseId);
        updateFare.Parameters.AddWithValue(success);
        updateFare.Parameters.AddWithValue(
            NpgsqlDbType.Jsonb,
            success ? response!.Value.GetRawText() : DBNull.Value
        );
        updateFare.Parameters.AddWithValue(
            NpgsqlDbType.TimestampTz,
            success ? fetchedAt!.Value : DBNull.Value
        );
        if (await updateFare.ExecuteNonQueryAsync(cancellationToken) != 1)
            return false;

        await using var updateOperation = new NpgsqlCommand(
            """
            UPDATE operations
            SET completed_items=completed_items + CASE WHEN $2 THEN 1 ELSE 0 END,
                failed_items=failed_items + CASE WHEN $2 THEN 0 ELSE 1 END,
                status=CASE
                    WHEN completed_items + failed_items + 1 >= items
                        THEN CASE
                            WHEN failed_items + CASE WHEN $2 THEN 0 ELSE 1 END > 0
                                THEN 'Failed'
                            ELSE 'Completed'
                        END
                    ELSE 'InProgress'
                END,
                updated_at=now()
            WHERE id=$1;
            """,
            connection,
            transaction
        );
        updateOperation.Parameters.AddWithValue(work.OperationId);
        updateOperation.Parameters.AddWithValue(success);
        await updateOperation.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    private static TrackedOperation ReadOperation(NpgsqlDataReader reader) =>
        new(
            reader.GetGuid(0),
            reader.IsDBNull(1) ? null : reader.GetGuid(1),
            reader.GetString(2),
            reader.GetString(3),
            new(reader.GetInt32(4), reader.GetInt32(5), reader.GetInt32(6)),
            reader.GetFieldValue<DateTimeOffset>(7),
            reader.GetFieldValue<DateTimeOffset>(8),
            OperationState.Url(reader.GetGuid(0))
        );

    private static JsonElement? ReadJson(NpgsqlDataReader reader, int ordinal)
    {
        if (reader.IsDBNull(ordinal))
            return null;
        using var json = JsonDocument.Parse(reader.GetString(ordinal));
        return json.RootElement.Clone();
    }
}
