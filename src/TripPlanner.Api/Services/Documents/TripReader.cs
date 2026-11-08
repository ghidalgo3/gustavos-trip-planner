using TripPlanner.Api.Database;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Services.Documents;

public sealed class TripReader(IPlannerDb database)
{
    // Also called inside the write transaction when checking edit preconditions.
    public async Task<TripReadData?> ReadAsync(Guid userId, Guid tripId, CancellationToken token)
    {
        var data = await database.ReadTripDataAsync(userId, tripId, token);
        return data is null
            ? null
            : data with
            {
                Destinations = data
                    .Destinations.Select(place =>
                        string.IsNullOrWhiteSpace(place.TimeZone)
                            ? place with
                            {
                                TimeZone = LocalTimeZone(place.Latitude, place.Longitude),
                            }
                            : place
                    )
                    .ToArray(),
            };
    }

    private static string LocalTimeZone(double latitude, double longitude)
    {
        var zone = GeoTimeZone.TimeZoneLookup.GetTimeZone(latitude, longitude).Result;
        return
            !zone.StartsWith("Etc/", StringComparison.Ordinal)
            && TimeZoneInfo.TryFindSystemTimeZoneById(zone, out _)
            ? zone
            : "";
    }
}
