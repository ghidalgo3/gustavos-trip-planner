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

    private readonly Dictionary<Guid, TripTravelPlan> travelPlans = new();

    private void RemoveTravelReferences(Guid tripId, Guid? activityId = null, Guid? visitId = null)
    {
        if (!travelPlans.TryGetValue(tripId, out var plan))
        {
            return;
        }

        bool Matches(TripTravelEndpoint e) =>
            activityId is not null && e.ActivityId == activityId
            || visitId is not null && e.VisitId == visitId;
        var remaining = plan
            .Connections.Where(c =>
                !Matches(c.From)
                && !Matches(c.To)
                && !c.Segments.Any(s => Matches(s.From) || Matches(s.To))
            )
            .ToArray();
        if (remaining.Length != plan.Connections.Length)
        {
            travelPlans[tripId] = new(remaining, plan.Version + 1);
        }
    }

    public Task<TripTravelPlan> GetTripTravelAsync(
        Guid userId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            return Task.FromResult(
                _trips.TryGetValue(tripId, out var trip) && CanViewTrip(userId, trip)
                    ? travelPlans.GetValueOrDefault(tripId) ?? new([])
                    : new([])
            );
        }
    }

    public Task<TripTravelPlan?> SaveTripTravelAsync(
        Guid userId,
        Guid tripId,
        TripTravelConnection[] connections,
        long expectedVersion,
        long expectedContextRevision,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            if (
                !_trips.TryGetValue(tripId, out var trip)
                || !CanPlanTrip(userId, trip)
                || (travelPlans.GetValueOrDefault(tripId)?.Version ?? 0) != expectedVersion
                || PlanningRevision(tripId) != expectedContextRevision
            )
            {
                return Task.FromResult<TripTravelPlan?>(null);
            }
            var saved = new TripTravelPlan(connections, expectedVersion + 1);
            travelPlans[tripId] = saved;
            return Task.FromResult<TripTravelPlan?>(saved);
        }
    }
}
