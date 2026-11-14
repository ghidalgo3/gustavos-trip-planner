using TripPlanner.Api.Models;

namespace TripPlanner.Api.Tests.Database;

public sealed partial class InMemoryPlannerDb
{
    private readonly Dictionary<
        Guid,
        (long Revision, DateTimeOffset ModifiedAt)
    > modificationTimes = new();

    public Task<DateTimeOffset> GetTripModifiedAtAsync(
        Guid userId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            var revision = PlanningRevision(tripId);
            if (!modificationTimes.TryGetValue(tripId, out var value) || value.Revision != revision)
            {
                value = (revision, DateTimeOffset.UtcNow);
                modificationTimes[tripId] = value;
            }
            return Task.FromResult(value.ModifiedAt);
        }
    }
}
