using System.Text.Json;
using Npgsql;
using NpgsqlTypes;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.TripForms;

namespace TripPlanner.Api.Database;

public sealed partial class PostgresPlannerDb
{
    public async Task<TrackedOperation> CreateTripFormOperationAsync(
        Guid userId,
        Guid tripId,
        Guid operationId,
        string input,
        PlanningDocument draft,
        CancellationToken cancellationToken = default
    )
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using var operation = new NpgsqlCommand(
            """
            INSERT INTO operations(id, user_id, resource_id, type, status, items)
            SELECT $1, $2, $3, 'tripFormFill', 'pending', 1
            FROM trips WHERE id=$3 AND can_plan_trip(id, $2)
            ON CONFLICT (id) DO NOTHING;
            """,
            connection,
            transaction
        );
        operation.Parameters.AddWithValue(operationId);
        operation.Parameters.AddWithValue(userId);
        operation.Parameters.AddWithValue(tripId);
        if (await operation.ExecuteNonQueryAsync(cancellationToken) != 1)
        {
            await using var existing = new NpgsqlCommand(
                "SELECT 1 FROM operations WHERE id=$1 AND user_id=$2 AND resource_id=$3 AND type='tripFormFill';",
                connection,
                transaction
            );
            existing.Parameters.AddWithValue(operationId);
            existing.Parameters.AddWithValue(userId);
            existing.Parameters.AddWithValue(tripId);
            if (await existing.ExecuteScalarAsync(cancellationToken) is null)
            {
                throw new InvalidOperationException(
                    "This request ID was already used, or the trip no longer exists."
                );
            }
        }
        else
        {
            await using var job = new NpgsqlCommand(
                "INSERT INTO trip_form_jobs(operation_id, input, draft) VALUES ($1, $2, $3);",
                connection,
                transaction
            );
            job.Parameters.AddWithValue(operationId);
            job.Parameters.AddWithValue(input);
            job.Parameters.AddWithValue(
                NpgsqlDbType.Jsonb,
                JsonSerializer.Serialize(draft, JsonSerializerOptions.Web)
            );
            await job.ExecuteNonQueryAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return (await GetOperationAsync(userId, operationId, cancellationToken))!;
    }

    public async Task<TripFormWork?> ClaimTripFormWorkAsync(
        TimeSpan leaseDuration,
        CancellationToken cancellationToken = default
    )
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        Guid leaseId = Guid.NewGuid();
        await using var claim = new NpgsqlCommand(
            """
            UPDATE trip_form_jobs j
            SET lease_id=$1, lease_expires_at=now()+$2::interval, attempts=j.attempts+1
            FROM (
                SELECT j.operation_id FROM trip_form_jobs j
                JOIN operations o ON o.id=j.operation_id
                WHERE j.proposal IS NULL AND j.error IS NULL
                  AND o.status IN ('pending', 'InProgress')
                  AND (j.lease_expires_at IS NULL OR j.lease_expires_at < now())
                ORDER BY j.created_at, j.operation_id
                FOR UPDATE OF j SKIP LOCKED LIMIT 1
            ) next
            JOIN operations o ON o.id=next.operation_id
            WHERE j.operation_id=next.operation_id
            RETURNING j.operation_id, o.user_id, o.resource_id,
                j.attempts, j.input, j.draft::text;
            """,
            connection,
            transaction
        );
        claim.Parameters.AddWithValue(leaseId);
        claim.Parameters.AddWithValue(leaseDuration);
        TripFormWork? work = null;
        await using (var reader = await claim.ExecuteReaderAsync(cancellationToken))
        {
            if (await reader.ReadAsync(cancellationToken))
            {
                work = new(
                    reader.GetGuid(0),
                    reader.GetGuid(1),
                    reader.GetGuid(2),
                    leaseId,
                    reader.GetInt32(3),
                    reader.GetString(4),
                    JsonSerializer.Deserialize<PlanningDocument>(
                        reader.GetString(5),
                        JsonSerializerOptions.Web
                    )!
                );
            }
        }
        if (work is not null)
        {
            await using var mark = new NpgsqlCommand(
                "UPDATE operations SET status='InProgress', updated_at=now() WHERE id=$1;",
                connection,
                transaction
            );
            mark.Parameters.AddWithValue(work.OperationId);
            await mark.ExecuteNonQueryAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return work;
    }

    public async Task<bool> CompleteTripFormWorkAsync(
        TripFormWork work,
        TripFormProposal? proposal,
        string? error,
        CancellationToken cancellationToken = default
    )
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using var finish = new NpgsqlCommand(
            """
            UPDATE trip_form_jobs SET proposal=$3, error=$4, lease_id=NULL, lease_expires_at=NULL
            WHERE operation_id=$1 AND lease_id=$2;
            """,
            connection,
            transaction
        );
        finish.Parameters.AddWithValue(work.OperationId);
        finish.Parameters.AddWithValue(work.LeaseId);
        finish.Parameters.AddWithValue(
            NpgsqlDbType.Jsonb,
            proposal is null
                ? DBNull.Value
                : JsonSerializer.Serialize(proposal, JsonSerializerOptions.Web)
        );
        finish.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)error ?? DBNull.Value);
        if (await finish.ExecuteNonQueryAsync(cancellationToken) != 1)
        {
            return false;
        }

        await using var operation = new NpgsqlCommand(
            """
            UPDATE operations SET status=$2, completed_items=$3, failed_items=$4, updated_at=now()
            WHERE id=$1;
            """,
            connection,
            transaction
        );
        operation.Parameters.AddWithValue(work.OperationId);
        operation.Parameters.AddWithValue(proposal is null ? "Failed" : "Completed");
        operation.Parameters.AddWithValue(proposal is null ? 0 : 1);
        operation.Parameters.AddWithValue(proposal is null ? 1 : 0);
        await operation.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    public async Task<TripFormProposal?> GetTripFormProposalAsync(
        Guid userId,
        Guid tripId,
        Guid operationId,
        CancellationToken cancellationToken = default
    )
    {
        await using var command = dataSource.CreateCommand(
            """
            SELECT j.proposal::text FROM trip_form_jobs j
            JOIN operations o ON o.id=j.operation_id
            JOIN trips t ON t.id=o.resource_id
            WHERE j.operation_id=$1 AND o.user_id=$2 AND o.resource_id=$3
              AND can_plan_trip(t.id, $2) AND o.status='Completed';
            """
        );
        command.Parameters.AddWithValue(operationId);
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(tripId);
        string? json = (string?)await command.ExecuteScalarAsync(cancellationToken);
        return json is null
            ? null
            : JsonSerializer.Deserialize<TripFormProposal>(json, JsonSerializerOptions.Web);
    }
}
