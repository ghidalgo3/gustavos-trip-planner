using System.Collections.Concurrent;
using System.Text.Json;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Database;

public sealed partial class InMemoryPlannerDb : IPlannerDb
{
    private readonly ConcurrentDictionary<string, User> _users = new(
        StringComparer.OrdinalIgnoreCase
    );
    private readonly ConcurrentDictionary<Guid, Trip> _trips = new();
    private readonly ConcurrentDictionary<Guid, Party> _parties = new();
    private readonly object _tripLock = new();

    private bool CanViewTrip(Guid viewerUserId, Trip trip) =>
        trip.OwnerUserId == viewerUserId
        || _parties.Values.Any(p => p.TripId == trip.Id && p.UserIds.Contains(viewerUserId));

    public Task<Trip?> GetVisibleTripAsync(
        Guid viewerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            _trips.TryGetValue(tripId, out var trip);
            return Task.FromResult(
                trip is not null && CanViewTrip(viewerUserId, trip) ? trip : null
            );
        }
    }

    public IReadOnlyCollection<User> Users => _users.Values.ToArray();
    public IReadOnlyCollection<Trip> Trips => _trips.Values.ToArray();
    public IReadOnlyCollection<Party> Parties => _parties.Values.ToArray();

    public Task<IReadOnlyList<Party>> GetPartiesAsync(
        Guid ownerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            IReadOnlyList<Party> parties =
                _trips.TryGetValue(tripId, out var trip) && CanViewTrip(ownerUserId, trip)
                    ? _parties.Values.Where(p => p.TripId == tripId).OrderBy(p => p.Id).ToArray()
                    : [];
            return Task.FromResult(parties);
        }
    }

    public Task<Trip?> SetFlightConstraintsAsync(
        Guid ownerUserId,
        Guid tripId,
        JsonElement constraints,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            if (!_trips.TryGetValue(tripId, out var trip) || trip.OwnerUserId != ownerUserId)
                return Task.FromResult<Trip?>(null);
            var updated = trip with
            {
                FlightConstraints = constraints.Clone(),
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            _trips[tripId] = updated;
            return Task.FromResult<Trip?>(updated);
        }
    }

    public Task<User> GetOrCreateUserAsync(
        AuthenticatedUserProfile profile,
        CancellationToken cancellationToken = default
    )
    {
        User user = _users.AddOrUpdate(
            profile.Email,
            _ => CreateUser(profile),
            (_, existing) => MergeProvider(existing, profile.Provider)
        );
        return Task.FromResult(user);
    }

    public Task<User?> GetUserAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(_users.Values.SingleOrDefault(user => user.Id == userId));
    }

    public Task<User?> GetUserByEmailAsync(
        string email,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        _users.TryGetValue(email, out var user);
        return Task.FromResult(user);
    }

    public Task<IReadOnlyList<Trip>> GetTripsAsync(
        Guid ownerUserId,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        IReadOnlyList<Trip> trips = _trips
            .Values.Where(trip => CanViewTrip(ownerUserId, trip))
            .OrderByDescending(trip => trip.UpdatedAt)
            .ThenBy(trip => trip.Id)
            .ToArray();
        return Task.FromResult(trips);
    }

    public Task<Trip?> GetTripAsync(
        Guid ownerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        _trips.TryGetValue(tripId, out Trip? trip);
        return Task.FromResult(trip?.OwnerUserId == ownerUserId ? trip : null);
    }

    public Task<Trip> CreateTripAsync(
        Guid ownerUserId,
        string name,
        string description,
        CancellationToken cancellationToken = default,
        JsonElement? constraints = null
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        DateTimeOffset now = DateTimeOffset.UtcNow;
        var trip = new Trip(
            Guid.NewGuid(),
            ownerUserId,
            name,
            description,
            constraints?.Clone() ?? JsonSerializer.SerializeToElement(new { }),
            now,
            now
        );
        var party = new Party(Guid.NewGuid(), trip.Id, new[] { ownerUserId });
        lock (_tripLock)
        {
            _trips[trip.Id] = trip;
            _parties[party.Id] = party;
        }

        return Task.FromResult(trip);
    }

    public Task<Trip?> UpdateTripAsync(
        Guid ownerUserId,
        Guid tripId,
        string name,
        string description,
        CancellationToken cancellationToken = default,
        JsonElement? constraints = null
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            if (
                !_trips.TryGetValue(tripId, out Trip? existing)
                || existing.OwnerUserId != ownerUserId
            )
            {
                return Task.FromResult<Trip?>(null);
            }

            Trip updated = existing with
            {
                Name = name,
                Description = description,
                Constraints = constraints?.Clone() ?? existing.Constraints,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            _trips[tripId] = updated;
            return Task.FromResult<Trip?>(updated);
        }
    }

    public Task<bool> DeleteTripAsync(
        Guid ownerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            if (!_trips.TryGetValue(tripId, out Trip? trip) || trip.OwnerUserId != ownerUserId)
            {
                return Task.FromResult(false);
            }

            _trips.TryRemove(tripId, out _);
            foreach (var key in _selectedFlights.Keys.Where(key => key.TripId == tripId).ToArray())
                _selectedFlights.Remove(key);
            foreach (var key in _flightChoices.Keys.Where(key => key.TripId == tripId).ToArray())
                _flightChoices.Remove(key);
            foreach (var key in _destinationPlaces.Keys.Where(key => key.Item1 == tripId).ToArray())
                _destinationPlaces.Remove(key);
            foreach (
                var key in _destinationVisits
                    .Where(pair => pair.Value.TripId == tripId)
                    .Select(pair => pair.Key)
                    .ToArray()
            )
                _destinationVisits.Remove(key);
            foreach (
                var key in _activities
                    .Where(pair => pair.Value.TripId == tripId)
                    .Select(pair => pair.Key)
                    .ToArray()
            )
                _activities.Remove(key);
            foreach (
                var key in _activityJobs
                    .Where(pair => pair.Value.TripId == tripId)
                    .Select(pair => pair.Key)
                    .ToArray()
            )
                _activityJobs.Remove(key);
            foreach (
                Guid partyId in _parties
                    .Values.Where(party => party.TripId == tripId)
                    .Select(party => party.Id)
            )
            {
                _parties.TryRemove(partyId, out _);
            }

            return Task.FromResult(true);
        }
    }

    public Task<User> SetUserProfileAsync(
        Guid userId,
        UserProfile profile,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        User existing = _users.Values.Single(user => user.Id == userId);
        User updated = existing with
        {
            HomeCityName = profile.HomeCity!.Name,
            PreferredAirport = profile.PreferredAirport,
            HomeCityLocation = new(profile.HomeCity.Longitude, profile.HomeCity.Latitude),
            PreferredAirlines = profile.PreferredAirlines!,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        _users[existing.Email] = updated;
        return Task.FromResult(updated);
    }

    public Task<User> SetUserFeatureFlagsAsync(
        Guid userId,
        string featureFlags,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        User existing = _users.Values.Single(user => user.Id == userId);
        User updated = existing with
        {
            FeatureFlags = featureFlags,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        _users[existing.Email] = updated;
        return Task.FromResult(updated);
    }

    private static User CreateUser(AuthenticatedUserProfile profile)
    {
        DateTimeOffset now = DateTimeOffset.UtcNow;
        return new User(
            Guid.NewGuid(),
            profile.Provider,
            profile.Email,
            profile.DisplayName,
            null,
            null,
            [],
            now,
            now
        );
    }

    private static User MergeProvider(User user, string provider)
    {
        string[] providers = user.Provider.Split(',');
        return providers.Contains(provider, StringComparer.Ordinal)
            ? user
            : user with
            {
                Provider = $"{user.Provider},{provider}",
                UpdatedAt = DateTimeOffset.UtcNow,
            };
    }
}
