using TripPlanner.Api.Models;
using TripPlanner.Api.Services;

namespace TripPlanner.Api.Database;

public sealed partial class InMemoryPlannerDb
{
    private sealed class MemoryTripFormJob(
        Guid userId,
        Guid tripId,
        string input,
        PlanningDocument draft
    )
    {
        public Guid UserId { get; } = userId;
        public Guid TripId { get; } = tripId;
        public string Input { get; } = input;
        public PlanningDocument Draft { get; } = draft;
        public TripFormProposal? Proposal { get; set; }
        public string? Error { get; set; }
        public Guid? LeaseId { get; set; }
        public DateTimeOffset? LeaseExpiresAt { get; set; }
        public int Attempts { get; set; }
    }

    private readonly Dictionary<Guid, MemoryTripFormJob> _formJobs = [];

    public Task<TrackedOperation> CreateTripFormOperationAsync(
        Guid userId,
        Guid tripId,
        Guid operationId,
        string input,
        PlanningDocument draft,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            if (_operations.TryGetValue(operationId, out var existing))
            {
                if (
                    existing.UserId != userId
                    || existing.ResourceId != tripId
                    || existing.Type != OperationState.TripFormFill
                )
                    throw new InvalidOperationException("This request ID was already used.");
                return Task.FromResult(Operation(operationId, existing));
            }
            if (!_trips.TryGetValue(tripId, out var trip) || !CanPlanTrip(userId, trip))
                throw new InvalidOperationException("The trip no longer exists.");
            var now = OperationClock.GetUtcNow();
            var operation = new MemoryOperation(userId, tripId, 1, 0, now)
            {
                Type = OperationState.TripFormFill,
            };
            _operations.Add(operationId, operation);
            _formJobs.Add(operationId, new(userId, tripId, input, draft));
            return Task.FromResult(Operation(operationId, operation));
        }
    }

    public Task<TripFormWork?> ClaimTripFormWorkAsync(
        TimeSpan leaseDuration,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            var now = OperationClock.GetUtcNow();
            var selected = _formJobs
                .Where(pair =>
                    pair.Value.Proposal is null
                    && pair.Value.Error is null
                    && (pair.Value.LeaseExpiresAt is null || pair.Value.LeaseExpiresAt < now)
                    && _operations.TryGetValue(pair.Key, out var op)
                    && op.Status is "pending" or "InProgress"
                )
                .OrderBy(pair => _operations[pair.Key].CreatedAt)
                .FirstOrDefault();
            if (selected.Value is null)
                return Task.FromResult<TripFormWork?>(null);
            var job = selected.Value;
            job.LeaseId = Guid.NewGuid();
            job.LeaseExpiresAt = now + leaseDuration;
            job.Attempts++;
            _operations[selected.Key].Status = "InProgress";
            _operations[selected.Key].UpdatedAt = now;
            return Task.FromResult<TripFormWork?>(
                new(
                    selected.Key,
                    job.UserId,
                    job.TripId,
                    job.LeaseId.Value,
                    job.Attempts,
                    job.Input,
                    job.Draft
                )
            );
        }
    }

    public Task<bool> CompleteTripFormWorkAsync(
        TripFormWork work,
        TripFormProposal? proposal,
        string? error,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            if (
                !_formJobs.TryGetValue(work.OperationId, out var job)
                || job.LeaseId != work.LeaseId
            )
                return Task.FromResult(false);
            job.Proposal = proposal;
            job.Error = error;
            job.LeaseId = null;
            job.LeaseExpiresAt = null;
            var operation = _operations[work.OperationId];
            operation.Status = proposal is null ? "Failed" : "Completed";
            operation.CompletedItems = proposal is null ? 0 : 1;
            operation.FailedItems = proposal is null ? 1 : 0;
            operation.UpdatedAt = OperationClock.GetUtcNow();
            return Task.FromResult(true);
        }
    }

    public Task<TripFormProposal?> GetTripFormProposalAsync(
        Guid userId,
        Guid tripId,
        Guid operationId,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
            return Task.FromResult<TripFormProposal?>(
                _trips.TryGetValue(tripId, out var trip)
                && CanPlanTrip(userId, trip)
                && _formJobs.TryGetValue(operationId, out var job)
                && job.UserId == userId
                && job.TripId == tripId
                && _operations[operationId].Status == "Completed"
                    ? job.Proposal
                    : null
            );
    }
}
