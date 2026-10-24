using TripPlanner.Api.Models;

namespace TripPlanner.Api.Services.Maps;

internal static class MapGeometry
{
    internal static bool IsNearby(GeoJsonPoint point, GeoJsonPoint? center)
    {
        if (center is not { Position: not null })
        {
            return true;
        }
        double first = center.Position.Latitude * Math.PI / 180;
        double second = point.Position.Latitude * Math.PI / 180;
        double dLat = second - first;
        double dLon = (point.Position.Longitude - center.Position.Longitude) * Math.PI / 180;
        double haversine =
            Math.Pow(Math.Sin(dLat / 2), 2)
            + Math.Cos(first) * Math.Cos(second) * Math.Pow(Math.Sin(dLon / 2), 2);
        return 6371 * 2 * Math.Asin(Math.Min(1, Math.Sqrt(haversine))) <= 50;
    }
}
