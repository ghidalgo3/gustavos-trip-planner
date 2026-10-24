using System.Collections.Concurrent;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Tests.Database;

public sealed class InMemoryActivityLogStore(IPlannerDb database) : IActivityLogStore
{
    private readonly ConcurrentQueue<TripMutation> entries = new();

    public Task AppendAsync(TripMutation entry, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        entries.Enqueue(entry);
        return Task.CompletedTask;
    }

    public async Task<IReadOnlyList<TripMutation>> ListAsync(
        Guid userId,
        int take,
        int skip,
        CancellationToken cancellationToken
    )
    {
        var visible = (await database.GetTripsAsync(userId, cancellationToken))
            .Select(trip => trip.Id)
            .ToHashSet();
        return entries
            .Where(entry =>
                entry.ActorUserId == userId
                || entry.OwnerUserId == userId
                || visible.Contains(entry.TripId)
            )
            .OrderByDescending(entry => entry.OccurredAt)
            .ThenByDescending(entry => entry.Id)
            .Skip(skip)
            .Take(take)
            .ToArray();
    }
}
