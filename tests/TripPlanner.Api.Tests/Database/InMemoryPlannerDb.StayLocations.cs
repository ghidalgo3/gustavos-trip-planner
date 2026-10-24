using TripPlanner.Api.Database;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Tests.Database;

public sealed partial class InMemoryPlannerDb
{
    private readonly Dictionary<
        (Guid TripId, string CityId),
        GeoJsonFeature<StayLocationProperties>
    > _stayLocations = [];

    public Task<
        IReadOnlyDictionary<string, GeoJsonFeature<StayLocationProperties>>
    > GetStayLocationsAsync(Guid userId, Guid tripId, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            return Task.FromResult<
                IReadOnlyDictionary<string, GeoJsonFeature<StayLocationProperties>>
            >(
                _trips.TryGetValue(tripId, out var trip) && CanViewTrip(userId, trip)
                    ? _stayLocations
                        .Where(item =>
                            item.Key.TripId == tripId && _destinationPlaces.ContainsKey(item.Key)
                        )
                        .ToDictionary(item => item.Key.CityId, item => item.Value)
                    : new Dictionary<string, GeoJsonFeature<StayLocationProperties>>()
            );
        }
    }

    public Task<bool> SaveStayLocationAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        GeoJsonFeature<StayLocationProperties>? feature,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            if (
                !_trips.TryGetValue(tripId, out var trip)
                || !CanPlanTrip(userId, trip)
                || !_destinationPlaces.ContainsKey((tripId, cityId))
            )
            {
                return Task.FromResult(false);
            }

            if (feature is null)
            {
                _stayLocations.Remove((tripId, cityId));
            }
            else
            {
                _stayLocations[(tripId, cityId)] = feature;
            }

            return Task.FromResult(true);
        }
    }
}
