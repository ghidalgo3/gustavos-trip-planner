using System.Security.Cryptography;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Tests.Database;

public sealed partial class InMemoryPlannerDb
{
    private readonly Dictionary<(Guid, string), DestinationPlace> _destinationPlaces = [];
    private readonly Dictionary<Guid, DestinationVisit> _destinationVisits = [];
    private readonly Dictionary<Guid, Activity> _activities = [];
    private readonly Dictionary<Guid, MemoryActivityJob> _activityJobs = [];

    private sealed class MemoryActivityJob(
        Guid userId,
        Guid tripId,
        string cityId,
        string context,
        string input,
        byte[]? image,
        string? mimeType
    )
    {
        public Guid UserId { get; } = userId;
        public Guid TripId { get; } = tripId;
        public string CityId { get; } = cityId;
        public string Context { get; } = context;
        public string Input { get; } = input;
        public byte[]? Image { get; set; } = image;
        public string? ImageHash { get; } =
            image is null ? null : Convert.ToHexString(SHA256.HashData(image));
        public string? MimeType { get; } = mimeType;
        public Guid? LeaseId { get; set; }
        public DateTimeOffset? LeaseExpiresAt { get; set; }
        public int Attempts { get; set; }
        public ActivitySuggestionResult? Result { get; set; }
        public string? Error { get; set; }
    }

    public Task<DestinationPlace?> ReplaceDestinationPlaceAsync(
        Guid ownerUserId,
        DestinationPlace place,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            if (
                !_trips.TryGetValue(place.TripId, out var trip)
                || !CanPlanTrip(ownerUserId, trip)
                || !_destinationPlaces.ContainsKey((place.TripId, place.CityId))
            )
            {
                return Task.FromResult<DestinationPlace?>(null);
            }

            var saved = place with
            {
                ContextVersion = Guid.NewGuid().ToString("N"),
                Constraints = place.Constraints.Clone(),
            };
            _destinationPlaces[(place.TripId, place.CityId)] = saved;
            return Task.FromResult<DestinationPlace?>(saved);
        }
    }

    public Task<bool> DeleteDestinationAsync(
        Guid ownerUserId,
        Guid tripId,
        string cityId,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            if (
                !_trips.TryGetValue(tripId, out var trip)
                || !CanPlanTrip(ownerUserId, trip)
                || !_destinationPlaces.ContainsKey((tripId, cityId))
            )
            {
                return Task.FromResult(false);
            }

            foreach (
                var id in _activities
                    .Values.Where(a => a.TripId == tripId && a.CityId == cityId)
                    .Select(a => a.Id)
                    .ToArray()
            )
            {
                _activities.Remove(id);
            }

            foreach (
                var id in _destinationVisits
                    .Values.Where(v => v.TripId == tripId && v.CityId == cityId)
                    .Select(v => v.StayId)
                    .ToArray()
            )
            {
                _destinationVisits.Remove(id);
            }

            foreach (
                var id in _activityJobs
                    .Where(pair => pair.Value.TripId == tripId && pair.Value.CityId == cityId)
                    .Select(pair => pair.Key)
                    .ToArray()
            )
            {
                _activityJobs.Remove(id);
                _operations.Remove(id);
            }
            _destinationPlaces.Remove((tripId, cityId));
            _stayLocations.Remove((tripId, cityId));
            _activityPlans.Remove((tripId, cityId));
            _planningEvidence.Remove((tripId, cityId));
            _activityPreferences.Remove((tripId, "destination", cityId));
            foreach (
                var id in _planningJobs
                    .Values.Where(j => j.TripId == tripId && j.CityId == cityId)
                    .Select(j => j.Id)
                    .ToArray()
            )
            {
                _planningJobs.Remove(id);
                _operations.Remove(id);
            }
            return Task.FromResult(true);
        }
    }

    private bool IsActiveDestination(Guid tripId, string cityId, string contextVersion)
    {
        return _destinationPlaces.TryGetValue((tripId, cityId), out var place)
            && place.ContextVersion == contextVersion
            && _destinationVisits.Values.Any(v => v.TripId == tripId && v.CityId == cityId);
    }

    public Task<IReadOnlyList<DestinationVisit>> GetDestinationVisitsAsync(
        Guid viewerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            return Task.FromResult<IReadOnlyList<DestinationVisit>>(
                _trips.TryGetValue(tripId, out var trip) && CanViewTrip(viewerUserId, trip)
                    ? _destinationVisits
                        .Values.Where(v => v.TripId == tripId)
                        .OrderBy(v => v.Order)
                        .ToArray()
                    : []
            );
        }
    }

    public Task<DestinationVisit?> AddDestinationVisitAsync(
        Guid ownerUserId,
        DestinationVisit visit,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            if (
                !_trips.TryGetValue(visit.TripId, out var trip)
                || !CanPlanTrip(ownerUserId, trip)
                || !_destinationPlaces.TryGetValue((visit.TripId, visit.CityId), out var place)
            )
            {
                return Task.FromResult<DestinationVisit?>(null);
            }

            var saved = visit with
            {
                Order =
                    _destinationVisits
                        .Values.Where(v => v.TripId == visit.TripId)
                        .Select(v => v.Order)
                        .DefaultIfEmpty(-1)
                        .Max() + 1,
            };
            _destinationVisits.Add(saved.StayId, saved);
            _destinationPlaces[(visit.TripId, visit.CityId)] = place with
            {
                ContextVersion = Guid.NewGuid().ToString("N"),
            };
            return Task.FromResult<DestinationVisit?>(saved);
        }
    }

    public Task<DestinationVisit?> ReplaceDestinationVisitAsync(
        Guid ownerUserId,
        Guid tripId,
        string cityId,
        Guid stayId,
        DestinationStayInput input,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            if (
                !_trips.TryGetValue(tripId, out var trip)
                || !CanPlanTrip(ownerUserId, trip)
                || !_destinationVisits.TryGetValue(stayId, out var visit)
                || visit.TripId != tripId
                || visit.CityId != cityId
            )
            {
                return Task.FromResult<DestinationVisit?>(null);
            }

            var saved = visit with
            {
                ArrivalDate = input.ArrivalDate,
                DepartureDate = input.DepartureDate,
            };
            _destinationVisits[stayId] = saved;
            var place = _destinationPlaces[(tripId, cityId)];
            _destinationPlaces[(tripId, cityId)] = place with
            {
                ContextVersion = Guid.NewGuid().ToString("N"),
            };
            return Task.FromResult<DestinationVisit?>(saved);
        }
    }

    public Task<bool> DeleteDestinationVisitAsync(
        Guid ownerUserId,
        Guid tripId,
        string cityId,
        Guid stayId,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            if (
                !_trips.TryGetValue(tripId, out var trip)
                || !CanPlanTrip(ownerUserId, trip)
                || !_destinationVisits.TryGetValue(stayId, out var visit)
                || visit.TripId != tripId
                || visit.CityId != cityId
            )
            {
                return Task.FromResult(false);
            }

            _destinationVisits.Remove(stayId);
            ReconcileActivityPlans(tripId);
            if (_destinationPlaces.TryGetValue((tripId, cityId), out var place))
            {
                _destinationPlaces[(tripId, cityId)] = place with
                {
                    ContextVersion = Guid.NewGuid().ToString("N"),
                };
            }

            return Task.FromResult(true);
        }
    }

    public Task<DestinationPlace?> GetDestinationPlaceAsync(
        Guid viewerUserId,
        Guid tripId,
        string cityId,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            return Task.FromResult(
                _trips.TryGetValue(tripId, out var trip)
                && CanViewTrip(viewerUserId, trip)
                && _destinationPlaces.TryGetValue((tripId, cityId), out var place)
                    ? place
                    : null
            );
        }
    }

    public Task<DestinationPlace> SaveDestinationPlaceAsync(
        Guid ownerUserId,
        DestinationPlace place,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            if (!_trips.TryGetValue(place.TripId, out var trip) || !CanPlanTrip(ownerUserId, trip))
            {
                throw new InvalidOperationException("The trip no longer exists.");
            }

            _destinationPlaces.TryAdd((place.TripId, place.CityId), place);
            return Task.FromResult(_destinationPlaces[(place.TripId, place.CityId)]);
        }
    }

    public Task<IReadOnlyList<DestinationPlace>> GetDestinationPlacesAsync(
        Guid viewerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            return Task.FromResult<IReadOnlyList<DestinationPlace>>(
                _trips.TryGetValue(tripId, out var trip) && CanViewTrip(viewerUserId, trip)
                    ? _destinationPlaces.Values.Where(p => p.TripId == tripId).ToArray()
                    : []
            );
        }
    }

    public Task<IReadOnlyList<Activity>> GetActivitiesAsync(
        Guid viewerUserId,
        Guid tripId,
        string cityId,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            return Task.FromResult<IReadOnlyList<Activity>>(
                _trips.TryGetValue(tripId, out var trip) && CanViewTrip(viewerUserId, trip)
                    ? _activities
                        .Values.Where(a => a.TripId == tripId && a.CityId == cityId)
                        .OrderBy(a => a.CreatedAt)
                        .ThenBy(a => a.Id)
                        .ToArray()
                    : []
            );
        }
    }

    public Task<Activity?> GetActivityAsync(
        Guid viewerUserId,
        Guid tripId,
        string cityId,
        Guid activityId,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            return Task.FromResult(
                _trips.TryGetValue(tripId, out var trip)
                && CanViewTrip(viewerUserId, trip)
                && _activities.TryGetValue(activityId, out var activity)
                && activity.TripId == tripId
                && activity.CityId == cityId
                    ? activity
                    : null
            );
        }
    }

    public Task<Activity?> SaveActivityAsync(
        Guid ownerUserId,
        Activity activity,
        string contextVersion,
        DateTimeOffset? expectedUpdatedAt,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            if (
                !_trips.TryGetValue(activity.TripId, out var trip)
                || !CanPlanTrip(ownerUserId, trip)
                || !IsActiveDestination(activity.TripId, activity.CityId, contextVersion)
                || !_destinationPlaces.ContainsKey((activity.TripId, activity.CityId))
            )
            {
                return Task.FromResult<Activity?>(null);
            }

            bool exists = _activities.TryGetValue(activity.Id, out var previous);
            if (
                exists != expectedUpdatedAt.HasValue
                || (exists && previous!.UpdatedAt != expectedUpdatedAt)
            )
            {
                return Task.FromResult<Activity?>(null);
            }

            Activity saved = activity with
            {
                CreatedAt = previous?.CreatedAt ?? activity.CreatedAt,
            };
            _activities[activity.Id] = saved;
            ReconcileActivityPlans(activity.TripId);
            return Task.FromResult<Activity?>(saved);
        }
    }

    public Task<bool> DeleteActivityAsync(
        Guid ownerUserId,
        Guid tripId,
        string cityId,
        Guid activityId,
        string contextVersion,
        DateTimeOffset expectedUpdatedAt,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            bool removed = (
                _trips.TryGetValue(tripId, out var trip)
                && CanPlanTrip(ownerUserId, trip)
                && IsActiveDestination(tripId, cityId, contextVersion)
                && _activities.TryGetValue(activityId, out var activity)
                && activity.TripId == tripId
                && activity.CityId == cityId
                && activity.UpdatedAt == expectedUpdatedAt
                && _activities.Remove(activityId)
            );
            if (removed)
            {
                ReconcileActivityPlans(tripId);
            }

            return Task.FromResult(removed);
        }
    }

    public Task<TrackedOperation> CreateActivityJobAsync(
        Guid ownerUserId,
        Guid tripId,
        Guid requestId,
        string cityId,
        string contextVersion,
        string input,
        byte[]? image,
        string? mimeType,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            if (_operations.TryGetValue(requestId, out var existing))
            {
                if (
                    !_activityJobs.TryGetValue(requestId, out var job)
                    || job.UserId != ownerUserId
                    || job.TripId != tripId
                    || job.CityId != cityId
                    || job.Context != contextVersion
                    || job.Input != input
                    || job.ImageHash
                        != (image is null ? null : Convert.ToHexString(SHA256.HashData(image)))
                )
                {
                    throw new InvalidOperationException(
                        "This request ID was already used with different input."
                    );
                }

                return Task.FromResult(Operation(requestId, existing));
            }
            if (
                !_trips.TryGetValue(tripId, out var trip)
                || !CanPlanTrip(ownerUserId, trip)
                || !IsActiveDestination(tripId, cityId, contextVersion)
            )
            {
                throw new InvalidOperationException("The destination changed.");
            }

            var now = OperationClock.GetUtcNow();
            var operation = new MemoryOperation(ownerUserId, tripId, 1, 0, now)
            {
                Type = "activitySuggest",
            };
            _operations.Add(requestId, operation);
            _activityJobs.Add(
                requestId,
                new(ownerUserId, tripId, cityId, contextVersion, input, image, mimeType)
            );
            return Task.FromResult(Operation(requestId, operation));
        }
    }

    public Task<ActivityJob?> ClaimActivityJobAsync(
        TimeSpan leaseDuration,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            var now = OperationClock.GetUtcNow();
            var entry = _activityJobs.FirstOrDefault(pair =>
                pair.Value.Result is null
                && pair.Value.Error is null
                && (pair.Value.LeaseExpiresAt is null || pair.Value.LeaseExpiresAt < now)
            );
            if (entry.Value is null)
            {
                return Task.FromResult<ActivityJob?>(null);
            }

            var job = entry.Value;
            job.LeaseId = Guid.NewGuid();
            job.LeaseExpiresAt = now + leaseDuration;
            job.Attempts++;
            _operations[entry.Key].Status = "InProgress";
            return Task.FromResult<ActivityJob?>(
                new(
                    entry.Key,
                    job.UserId,
                    job.TripId,
                    job.CityId,
                    job.Context,
                    job.Input,
                    job.Image,
                    job.MimeType,
                    job.LeaseId.Value,
                    job.Attempts
                )
            );
        }
    }

    public Task<bool> CompleteActivityJobAsync(
        ActivityJob job,
        IReadOnlyList<Activity>? activities,
        string[] warnings,
        string? error,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            if (
                !_activityJobs.TryGetValue(job.OperationId, out var stored)
                || stored.LeaseId != job.LeaseId
                || stored.Result is not null
                || stored.Error is not null
            )
            {
                return Task.FromResult(false);
            }

            if (
                error is null
                && !IsActiveDestination(job.TripId, job.CityId, job.DestinationContext)
            )
            {
                error = "Destination changed. Try again.";
            }

            var op = _operations[job.OperationId];
            op.Status = error is null ? "Completed" : "Failed";
            op.CompletedItems = error is null ? 1 : 0;
            op.FailedItems = error is null ? 0 : 1;
            op.UpdatedAt = OperationClock.GetUtcNow();
            if (error is null)
            {
                foreach (var activity in activities ?? [])
                {
                    _activities.TryAdd(activity.Id, activity);
                }

                stored.Result = new(
                    job.OperationId,
                    new(
                        "FeatureCollection",
                        (activities ?? []).Select(a => a.ToFeature()).ToArray()
                    ),
                    warnings
                );
            }
            stored.Error = error;
            stored.Image = null;
            return Task.FromResult(true);
        }
    }

    public Task<ActivitySuggestionResult?> GetActivityJobResultAsync(
        Guid viewerUserId,
        Guid tripId,
        string cityId,
        Guid operationId,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            return Task.FromResult(
                _trips.TryGetValue(tripId, out var trip)
                && CanViewTrip(viewerUserId, trip)
                && _activityJobs.TryGetValue(operationId, out var job)
                && job.TripId == tripId
                && job.CityId == cityId
                    ? job.Result
                    : null
            );
        }
    }
}
