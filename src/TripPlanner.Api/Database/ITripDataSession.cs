using System.Transactions;
using Npgsql;

namespace TripPlanner.Api.Database;

// Groups existing store methods without exposing connections to domain/projection code.
public interface ITripDataSession
{
    Task<T> ReadAsync<T>(Func<Task<T>> read, CancellationToken cancellationToken);
    Task<T> WriteAsync<T>(Guid tripId, Func<Task<T>> write, CancellationToken cancellationToken);
}

public sealed class PostgresTripDataSession(NpgsqlDataSource source) : ITripDataSession
{
    public async Task<T> ReadAsync<T>(Func<Task<T>> read, CancellationToken cancellationToken)
    {
        using var scope = new TransactionScope(
            TransactionScopeOption.Required,
            new TransactionOptions { IsolationLevel = IsolationLevel.RepeatableRead },
            TransactionScopeAsyncFlowOption.Enabled
        );
        var result = await read();
        cancellationToken.ThrowIfCancellationRequested();
        scope.Complete();
        return result;
    }

    public async Task<T> WriteAsync<T>(
        Guid tripId,
        Func<Task<T>> write,
        CancellationToken cancellationToken
    )
    {
        using var scope = new TransactionScope(
            TransactionScopeOption.Required,
            new TransactionOptions { IsolationLevel = IsolationLevel.ReadCommitted },
            TransactionScopeAsyncFlowOption.Enabled
        );
        await LockAsync(source, tripId, cancellationToken);
        var result = await write();
        scope.Complete();
        return result;
    }

    internal static async Task LockAsync(
        NpgsqlDataSource source,
        Guid tripId,
        CancellationToken token
    )
    {
        await using var command = source.CreateCommand(
            "SELECT id FROM trips WHERE id=$1 FOR UPDATE"
        );
        command.Parameters.AddWithValue(tripId);
        await command.ExecuteScalarAsync(token);
    }
}
