using TripPlanner.Api.Database;
using TripPlanner.Api.Tests.Database;

namespace TripPlanner.Api.Tests.Support;

public sealed class TestTripDataSession(InMemoryPlannerDb database) : ITripDataSession
{
    private readonly SemaphoreSlim gate = new(1, 1);

    public Task<T> ReadAsync<T>(Func<Task<T>> read, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        return Task.FromResult(database.Capture(() => read().GetAwaiter().GetResult()));
    }

    public async Task<T> WriteAsync<T>(Guid tripId, Func<Task<T>> write, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            return await write();
        }
        finally
        {
            gate.Release();
        }
    }
}
