using System.Text.Json;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Tests.Database;

public sealed partial class InMemoryPlannerDb
{
    private readonly Dictionary<Guid, MemoryOperation> _operations = [];
    private readonly Dictionary<string, MemorySearch> _searches = [];
    public TimeProvider OperationClock { get; set; } = TimeProvider.System;

    private sealed class MemoryOperation(
        Guid userId,
        Guid resourceId,
        int items,
        int completedItems,
        DateTimeOffset createdAt
    )
    {
        public string Type { get; set; } = OperationState.FlightSearch;
        public Guid UserId { get; } = userId;
        public Guid ResourceId { get; } = resourceId;
        public int Items { get; } = items;
        public int CompletedItems { get; set; } = completedItems;
        public int FailedItems { get; set; }
        public string Status { get; set; } = completedItems == items ? "Completed" : "pending";
        public DateTimeOffset CreatedAt { get; } = createdAt;
        public DateTimeOffset UpdatedAt { get; set; } = createdAt;
    }

    private sealed class MemorySearch(IgnavFareRequest request)
    {
        public IgnavFareRequest Request { get; set; } = request;
        public Guid? OperationId { get; set; }
        public Guid? LeaseId { get; set; }
        public DateTimeOffset? LeaseExpiresAt { get; set; }
        public int Attempts { get; set; }
        public JsonElement? Response { get; set; }
        public DateTimeOffset? FetchedAt { get; set; }
    }

    public Task<TrackedOperation> CreateFlightSearchOperationAsync(
        Guid userId,
        Guid tripId,
        Guid requestId,
        SearchPlanPreview preview,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            if (_operations.TryGetValue(requestId, out var existing))
            {
                if (existing.UserId != userId || existing.ResourceId != tripId)
                {
                    throw new InvalidOperationException("This request ID was already used.");
                }

                return Task.FromResult(Operation(requestId, existing));
            }
            if (!_trips.TryGetValue(tripId, out var trip) || !CanPlanTrip(userId, trip))
            {
                throw new InvalidOperationException("The trip no longer exists.");
            }

            var searches = preview
                .Parties.SelectMany(p => p.Requests)
                .GroupBy(search => search.CacheKey, StringComparer.Ordinal)
                .Select(group => group.First())
                .ToArray();
            var now = OperationClock.GetUtcNow();
            var completed = 0;
            foreach (var search in searches)
            {
                if (!_searches.TryGetValue(search.CacheKey, out var cached))
                {
                    cached = new(search.Body);
                    _searches.Add(search.CacheKey, cached);
                }
                if (cached.Response is not null && cached.FetchedAt?.AddHours(1) > now)
                {
                    completed++;
                    continue;
                }
                if (
                    cached.OperationId is { } operationId
                    && operationId != requestId
                    && _operations.TryGetValue(operationId, out var active)
                    && active.Status is "pending" or "InProgress"
                )
                {
                    throw new InvalidOperationException(
                        "A matching flight search is already in progress."
                    );
                }

                cached.Request = search.Body;
                cached.OperationId = requestId;
                cached.LeaseId = null;
                cached.LeaseExpiresAt = null;
                cached.Attempts = 0;
            }
            var operation = new MemoryOperation(userId, tripId, searches.Length, completed, now);
            _operations.Add(requestId, operation);
            return Task.FromResult(Operation(requestId, operation));
        }
    }

    public Task<TrackedOperation?> GetOperationAsync(
        Guid userId,
        Guid operationId,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            return Task.FromResult(
                _operations.TryGetValue(operationId, out var operation)
                && operation.UserId == userId
                    ? Operation(operationId, operation)
                    : null
            );
        }
    }

    public Task<IReadOnlyList<TrackedOperation>> GetOperationsAsync(
        Guid userId,
        string? type,
        int top,
        int skip,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            return Task.FromResult<IReadOnlyList<TrackedOperation>>(
                _operations
                    .Where(pair => pair.Value.UserId == userId)
                    .Select(pair => Operation(pair.Key, pair.Value))
                    .Where(operation => type is null || operation.Type == type)
                    .OrderByDescending(operation => operation.CreatedAt)
                    .ThenByDescending(operation => operation.Id)
                    .Skip(skip)
                    .Take(top)
                    .ToArray()
            );
        }
    }

    public Task<IReadOnlyList<FareSearchResult>?> GetFareSearchResultsAsync(
        Guid userId,
        Guid tripId,
        SearchPlanPreview preview,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            if (!_trips.TryGetValue(tripId, out var trip) || !CanPlanTrip(userId, trip))
            {
                return Task.FromResult<IReadOnlyList<FareSearchResult>?>(null);
            }

            var now = OperationClock.GetUtcNow();
            var results = new List<FareSearchResult>();
            foreach (var party in preview.Parties)
            {
                foreach (var request in party.Requests)
                {
                    if (
                        !_searches.TryGetValue(request.CacheKey, out var search)
                        || search.Response is null
                        || search.FetchedAt is null
                        || search.FetchedAt.Value.AddHours(1) <= now
                    )
                    {
                        continue;
                    }

                    results.Add(
                        new(
                            party.PartyId,
                            request.CacheKey,
                            request.Body,
                            search.Response.Value.Clone(),
                            search.FetchedAt.Value,
                            search.FetchedAt.Value.AddHours(1)
                        )
                    );
                }
            }

            return Task.FromResult<IReadOnlyList<FareSearchResult>?>(
                results.Count == 0 ? null : results
            );
        }
    }

    public Task<FareWork?> ClaimFareWorkAsync(
        TimeSpan leaseDuration,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            var now = OperationClock.GetUtcNow();
            foreach (
                var (key, search) in _searches
                    .OrderBy(pair =>
                    {
                        if (
                            pair.Value.OperationId is not { } operationId
                            || !_operations.TryGetValue(operationId, out var operation)
                        )
                        {
                            return pair.Value.Request.SearchPriority;
                        }

                        var nextOrigins = _flightChoices
                            .Where(choice => choice.Key.TripId == operation.ResourceId)
                            .SelectMany(choice => choice.Value.NextOrigins)
                            .ToArray();
                        if (nextOrigins.Length == 0)
                        {
                            return pair.Value.Request.SearchPriority;
                        }

                        return
                            pair.Value.Request.SearchKind == "oneWay"
                            && nextOrigins.Contains(pair.Value.Request.Origin)
                            ? 0
                            : 2;
                    })
                    .ThenBy(pair => pair.Key)
            )
            {
                if (
                    search.OperationId is not { } operationId
                    || !_operations.TryGetValue(operationId, out var operation)
                    || operation.Status is not ("pending" or "InProgress")
                    || search.LeaseExpiresAt > now
                )
                {
                    continue;
                }

                search.LeaseId = Guid.NewGuid();
                search.LeaseExpiresAt = now + leaseDuration;
                search.Attempts++;
                operation.Status = "InProgress";
                operation.UpdatedAt = now;
                return Task.FromResult<FareWork?>(
                    new(key, search.Request, operationId, search.LeaseId.Value, search.Attempts)
                );
            }
            return Task.FromResult<FareWork?>(null);
        }
    }

    public Task<bool> RetryFareWorkAsync(
        FareWork work,
        TimeSpan delay,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            var now = OperationClock.GetUtcNow();
            if (
                !_searches.TryGetValue(work.CacheKey, out var search)
                || search.OperationId != work.OperationId
                || search.LeaseId != work.LeaseId
                || search.LeaseExpiresAt <= now
            )
            {
                return Task.FromResult(false);
            }

            search.LeaseId = null;
            search.LeaseExpiresAt = now + delay;
            return Task.FromResult(true);
        }
    }

    public Task<bool> CompleteFareWorkAsync(
        FareWork work,
        JsonElement? response,
        DateTimeOffset? fetchedAt,
        string? error,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            var now = OperationClock.GetUtcNow();
            if (
                !_searches.TryGetValue(work.CacheKey, out var search)
                || search.OperationId != work.OperationId
                || search.LeaseId != work.LeaseId
                || search.LeaseExpiresAt <= now
                || !_operations.TryGetValue(work.OperationId, out var operation)
            )
            {
                return Task.FromResult(false);
            }

            var success = response is not null && fetchedAt is not null && error is null;
            if (success)
            {
                search.Response = response!.Value.Clone();
                search.FetchedAt = fetchedAt;
                operation.CompletedItems++;
            }
            else
            {
                operation.FailedItems++;
            }

            search.OperationId = null;
            search.LeaseId = null;
            search.LeaseExpiresAt = null;
            search.Attempts = 0;
            operation.Status =
                operation.CompletedItems + operation.FailedItems == operation.Items
                    ? operation.FailedItems > 0
                        ? "Failed"
                        : "Completed"
                    : "InProgress";
            operation.UpdatedAt = now;
            return Task.FromResult(true);
        }
    }

    private static TrackedOperation Operation(Guid id, MemoryOperation operation) =>
        new(
            id,
            operation.ResourceId,
            operation.Type,
            operation.Status,
            new(operation.Items, operation.CompletedItems, operation.FailedItems),
            operation.CreatedAt,
            operation.UpdatedAt,
            OperationState.Url(id)
        );
}
