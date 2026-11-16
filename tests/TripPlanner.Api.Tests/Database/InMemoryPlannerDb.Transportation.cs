using System.Text.Json;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Documents;
using TripPlanner.Api.Services.Flights;

namespace TripPlanner.Api.Tests.Database;

public sealed partial class InMemoryPlannerDb
{
    private readonly Dictionary<Guid, (Guid TripId, Transportation Value)> _transportation = [];
    private readonly Dictionary<Guid, Hotel> _hotels = [];
    private Airport[] _airports = new AirportCatalog().All;

    private void RemoveVisitTransportation(Guid stayId)
    {
        foreach (
            var id in _transportation
                .Where(t =>
                    t.Value.Value.OriginStayId == stayId
                    || t.Value.Value.DestinationStayId == stayId
                )
                .Select(t => t.Key)
                .ToArray()
        )
        {
            _transportation.Remove(id);
        }
    }

    public Task<IReadOnlyList<Airport>> RefreshAirportsAsync(
        Airport[] airports,
        CancellationToken cancellationToken = default
    )
    {
        _airports = airports;
        return Task.FromResult<IReadOnlyList<Airport>>(airports);
    }

    private GeoJsonFeature<StayLocationProperties> ResolveStayHotel(
        GeoJsonFeature<StayLocationProperties> feature
    ) =>
        feature.Properties.HotelId is { } id && _hotels.TryGetValue(id, out var h)
            ? feature with
            {
                Geometry = h.Geometry,
                Properties = feature.Properties with
                {
                    Name = h.Name,
                    Address = h.Address,
                    HotelId = h.Id,
                },
            }
            : feature;

    private TransportationFeature ResolveEndpoint(TransportationFeature feature)
    {
        if (feature.Properties.Reference is not { } reference)
        {
            return feature;
        }
        string? name = null,
            address = null;
        GeoJsonPoint? point = null;
        if (reference.Kind == "activity" && _activities.TryGetValue(reference.Id, out var activity))
        {
            name = activity.Properties.PlaceName ?? activity.Properties.Name;
            address = activity.Properties.Address;
            point = activity.Geometry;
        }
        else if (reference.Kind == "hotel" && _hotels.TryGetValue(reference.Id, out var hotel))
        {
            name = hotel.Name;
            address = hotel.Address;
            point = hotel.Geometry;
        }
        else if (
            reference.Kind == "airport"
            && _airports.FirstOrDefault(a => a.Id == reference.Id) is { } airport
        )
        {
            name = airport.Name;
            address = airport.City;
            point = new(
                "Point",
                Microsoft.Spatial.GeographyPoint.Create(airport.Latitude, airport.Longitude)
            );
        }
        else if (
            reference.Kind == "home"
            && _users.Values.FirstOrDefault(u => u.Id == reference.Id) is { } user
        )
        {
            name = user.HomeCityName ?? "Home";
            if (user.HomeCityLocation is { } home)
            {
                point = new(
                    "Point",
                    Microsoft.Spatial.GeographyPoint.Create(home.Latitude, home.Longitude)
                );
            }
        }
        else
        {
            return feature;
        }
        return feature with
        {
            Geometry = point is null
                ? null
                : new(
                    "Point",
                    JsonSerializer.SerializeToElement(
                        new[] { point.Position.Longitude, point.Position.Latitude }
                    )
                ),
            Properties = new(name, address, reference),
        };
    }

    private Transportation ResolveTransportation(Transportation value)
    {
        var features = value.Features.Select(ResolveEndpoint).ToArray();
        if (JsonSerializer.Serialize(features) != JsonSerializer.Serialize(value.Features))
        {
            bool moved = features
                .Zip(value.Features)
                .Any(pair =>
                    JsonSerializer.Serialize(pair.First.Geometry)
                    != JsonSerializer.Serialize(pair.Second.Geometry)
                );
            value = value with
            {
                Features = features,
                Version = value.Version + 1,
                RouteStale =
                    value.RouteStale || moved && features.Any(f => f.Id is not ("from" or "to")),
            };
        }
        return value;
    }

    private void SnapshotTransportationActivity(Guid tripId, Guid activityId)
    {
        foreach (var entry in _transportation.Where(t => t.Value.TripId == tripId).ToArray())
        {
            var value = ResolveTransportation(entry.Value.Value);
            if (
                !value.Features.Any(f =>
                    f.Properties.Reference is { Kind: "activity" } r && r.Id == activityId
                )
            )
            {
                continue;
            }
            var features = value
                .Features.Select(f =>
                    f.Properties.Reference is { Kind: "activity" } r && r.Id == activityId
                        ? f with
                        {
                            Properties = f.Properties with { Reference = null },
                        }
                        : f
                )
                .ToArray();
            if (
                features.Any(f =>
                    f.Id is "from" or "to" && f.Properties.Reference is null && f.Geometry is null
                )
            )
            {
                throw new InvalidOperationException(
                    "Resolve transportation before deleting a location with unknown coordinates."
                );
            }
            _transportation[entry.Key] = (
                tripId,
                value with
                {
                    Features = features,
                    Version = value.Version + 1,
                }
            );
        }
    }

    public Task<IReadOnlyList<Transportation>> GetTransportationAsync(
        Guid userId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            if (!_trips.TryGetValue(tripId, out var trip) || !CanViewTrip(userId, trip))
            {
                return Task.FromResult<IReadOnlyList<Transportation>>([]);
            }
            var values = _transportation
                .Values.Where(t => t.TripId == tripId)
                .Select(t => ResolveTransportation(t.Value))
                .OrderBy(t => t.Id)
                .ToArray();
            foreach (var value in values)
            {
                _transportation[value.Id] = (tripId, value);
            }
            return Task.FromResult<IReadOnlyList<Transportation>>(values);
        }
    }

    public Task<Transportation?> SaveTransportationAsync(
        Guid userId,
        Guid tripId,
        Transportation transportation,
        long? expectedVersion,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            if (!_trips.TryGetValue(tripId, out var trip) || !CanPlanTrip(userId, trip))
            {
                return Task.FromResult<Transportation?>(null);
            }
            var existing = _transportation.GetValueOrDefault(transportation.Id);
            if (
                expectedVersion is null
                    ? existing.Value is not null
                    : existing.Value is null
                        || existing.TripId != tripId
                        || ResolveTransportation(existing.Value).Version != expectedVersion
            )
            {
                return Task.FromResult<Transportation?>(null);
            }
            var saved = transportation with
            {
                Features = transportation.Features.Select(ResolveEndpoint).ToArray(),
                Version = (expectedVersion ?? 0) + 1,
            };
            _transportation[saved.Id] = (tripId, saved);
            return Task.FromResult<Transportation?>(saved);
        }
    }

    public Task<bool> DeleteTransportationAsync(
        Guid userId,
        Guid tripId,
        Guid transportationId,
        long expectedVersion,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            bool allowed =
                _trips.TryGetValue(tripId, out var trip)
                && CanPlanTrip(userId, trip)
                && _transportation.TryGetValue(transportationId, out var existing)
                && existing.TripId == tripId
                && ResolveTransportation(existing.Value).Version == expectedVersion;
            return Task.FromResult(allowed && _transportation.Remove(transportationId));
        }
    }

    public Task<IReadOnlyList<Hotel>> GetHotelsAsync(
        Guid userId,
        Guid tripId,
        CancellationToken cancellationToken = default
    ) =>
        Task.FromResult<IReadOnlyList<Hotel>>(
            _trips.TryGetValue(tripId, out var trip) && CanViewTrip(userId, trip)
                ? _hotels.Values.Where(h => h.TripId == tripId).OrderBy(h => h.Id).ToArray()
                : []
        );

    public Task<Hotel?> SaveHotelAsync(
        Guid userId,
        Guid tripId,
        Hotel hotel,
        long? expectedVersion,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            var old = _hotels.GetValueOrDefault(hotel.Id);
            if (
                !_trips.TryGetValue(tripId, out var trip)
                || !CanPlanTrip(userId, trip)
                || (
                    expectedVersion is null
                        ? old is not null
                        : old?.TripId != tripId || old?.Version != expectedVersion
                )
            )
            {
                return Task.FromResult<Hotel?>(null);
            }
            var saved = hotel with { TripId = tripId, Version = (expectedVersion ?? 0) + 1 };
            _hotels[saved.Id] = saved;
            return Task.FromResult<Hotel?>(saved);
        }
    }

    public Task<bool> DeleteHotelAsync(
        Guid userId,
        Guid tripId,
        Guid hotelId,
        long expectedVersion,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            if (
                !_trips.TryGetValue(tripId, out var trip)
                || !CanPlanTrip(userId, trip)
                || !_hotels.TryGetValue(hotelId, out var hotel)
                || hotel.TripId != tripId
                || hotel.Version != expectedVersion
            )
            {
                return Task.FromResult(false);
            }
            foreach (var entry in _transportation.Where(t => t.Value.TripId == tripId).ToArray())
            {
                var value = ResolveTransportation(entry.Value.Value);
                if (
                    value.Features.Any(f =>
                        f.Properties.Reference is { Kind: "hotel" } r && r.Id == hotelId
                    )
                )
                {
                    _transportation[entry.Key] = (
                        tripId,
                        value with
                        {
                            Version = value.Version + 1,
                            Features = value
                                .Features.Select(f =>
                                    f.Properties.Reference is { Kind: "hotel" } r && r.Id == hotelId
                                        ? f with
                                        {
                                            Properties = f.Properties with { Reference = null },
                                        }
                                        : f
                                )
                                .ToArray(),
                        }
                    );
                }
            }
            foreach (
                var key in _stayLocations
                    .Where(s => s.Value.Properties.HotelId == hotelId)
                    .Select(s => s.Key)
                    .ToArray()
            )
            {
                _stayLocations.Remove(key);
            }
            return Task.FromResult(_hotels.Remove(hotelId));
        }
    }
}
