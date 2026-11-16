using TripPlanner.Api.Database;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Tests.Database;

public sealed partial class InMemoryPlannerDb
{
    private readonly Dictionary<
        (Guid TripId, string CityId, Guid StayId),
        GeoJsonFeature<StayLocationProperties>
    > _stayLocations = [];

    public Task<
        IReadOnlyDictionary<Guid, GeoJsonFeature<StayLocationProperties>>
    > GetStayLocationsAsync(Guid userId, Guid tripId, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_tripLock)
        {
            return Task.FromResult<
                IReadOnlyDictionary<Guid, GeoJsonFeature<StayLocationProperties>>
            >(
                _trips.TryGetValue(tripId, out var trip) && CanViewTrip(userId, trip)
                    ? _stayLocations
                        .Where(item =>
                            item.Key.TripId == tripId
                            && _destinationVisits.ContainsKey(item.Key.StayId)
                        )
                        .ToDictionary(item => item.Key.StayId, item => ResolveStayHotel(item.Value))
                    : new Dictionary<Guid, GeoJsonFeature<StayLocationProperties>>()
            );
        }
    }

    public Task<bool> SaveStayLocationAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        Guid stayId,
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
                || !_destinationVisits.TryGetValue(stayId, out var visit)
                || visit.TripId != tripId
                || visit.CityId != cityId
            )
            {
                return Task.FromResult(false);
            }

            if (feature is null)
            {
                _stayLocations.Remove((tripId, cityId, stayId));
            }
            else
            {
                var hotel = feature.Properties.HotelId is { } hotelId
                    ? _hotels.GetValueOrDefault(hotelId)
                    : new Hotel(
                        Guid.NewGuid(),
                        tripId,
                        feature.Properties.Name,
                        feature.Properties.Address,
                        feature.Geometry!,
                        null,
                        1
                    );
                if (hotel is null || hotel.TripId != tripId)
                {
                    return Task.FromResult(false);
                }
                _hotels[hotel.Id] = hotel;
                _stayLocations[(tripId, cityId, stayId)] = feature with
                {
                    Properties = feature.Properties with
                    {
                        Name = hotel.Name,
                        Address = hotel.Address,
                        HotelId = hotel.Id,
                    },
                };
            }

            return Task.FromResult(true);
        }
    }
}
