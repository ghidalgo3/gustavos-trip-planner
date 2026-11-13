using TripPlanner.Api.DTO;

namespace TripPlanner.Api.Tests.Database;

public sealed partial class InMemoryPlannerDb
{
    public Task<ActivityKindPage> GetActivityKindPageAsync(
        Guid userId,
        ActivityKindQuery query,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            var kinds = _activities
                .Values.Where(activity =>
                    _trips.TryGetValue(activity.TripId, out var trip) && trip.OwnerUserId == userId
                )
                .SelectMany(activity => activity.Properties.Kinds)
                .Where(kind =>
                    kind.Contains(query.Search?.Trim() ?? "", StringComparison.OrdinalIgnoreCase)
                )
                .Distinct(StringComparer.Ordinal)
                .Order(StringComparer.Ordinal)
                .Skip(query.Skip)
                .Take(query.Top + 1)
                .ToArray();
            return Task.FromResult(
                new ActivityKindPage(kinds.Take(query.Top).ToArray(), kinds.Length > query.Top)
            );
        }
    }
}
