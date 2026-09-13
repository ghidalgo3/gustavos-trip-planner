using System.Collections.Concurrent;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Services;

/// <summary>
/// Placeholder store. Trips live in process memory and are lost on restart, which also
/// means they are not shared across App Service instances. Swap this for a real
/// persistence layer before the API is used for anything beyond smoke-testing deploys.
/// </summary>
public class InMemoryTripStore : ITripStore
{
    private readonly ConcurrentDictionary<Guid, Trip> _trips = new();

    public IReadOnlyCollection<Trip> GetAll() => _trips.Values.OrderBy(t => t.StartDate).ToList();

    public Trip? Get(Guid id) => _trips.TryGetValue(id, out var trip) ? trip : null;

    public Trip Add(CreateTripRequest request)
    {
        var trip = new Trip(
            Guid.NewGuid(),
            request.Destination,
            request.StartDate,
            request.EndDate,
            request.Notes
        );
        _trips[trip.Id] = trip;
        return trip;
    }

    public bool Delete(Guid id) => _trips.TryRemove(id, out _);
}
