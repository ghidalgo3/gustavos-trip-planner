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
                RemoveTravelReferences(tripId, activityId: id);
            }

            foreach (
                var id in _destinationVisits
                    .Values.Where(v => v.TripId == tripId && v.CityId == cityId)
                    .Select(v => v.StayId)
                    .ToArray()
            )
            {
                _destinationVisits.Remove(id);
                RemoveTravelReferences(tripId, visitId: id);
                _stayLocations.Remove((tripId, cityId, id));
            }

            _destinationPlaces.Remove((tripId, cityId));
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

            DestinationVisitDates.Validate(
                _destinationVisits.Values.Where(v => v.TripId == visit.TripId),
                visit.ArrivalDate,
                visit.DepartureDate
            );
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

            DestinationVisitDates.Validate(
                _destinationVisits.Values.Where(v => v.TripId == tripId),
                input.ArrivalDate,
                input.DepartureDate,
                stayId
            );
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
            RemoveTravelReferences(tripId, visitId: stayId);
            _stayLocations.Remove((tripId, cityId, stayId));
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
                RemoveTravelReferences(tripId, activityId: activityId);
                ReconcileActivityPlans(tripId);
            }

            return Task.FromResult(removed);
        }
    }
}
