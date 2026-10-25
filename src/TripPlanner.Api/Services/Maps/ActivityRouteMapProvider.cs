using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Services.Maps;

public interface IActivityRouteMapProvider
{
    Task<ActivityRoutePath?> GetAsync(
        GeographyPoint from,
        GeographyPoint to,
        DateTimeOffset departure,
        string mode,
        CancellationToken cancellationToken
    );
}

public sealed class ActivityRouteMapProvider(HttpClient client, IMapTokenProvider tokens)
    : IActivityRouteMapProvider
{
    public async Task<ActivityRoutePath?> GetAsync(
        GeographyPoint from,
        GeographyPoint to,
        DateTimeOffset departure,
        string mode,
        CancellationToken cancellationToken
    )
    {
        if (mode is not ("walking" or "driving" or "taxi"))
        {
            return null;
        }
        var token = await tokens.GetTokenAsync(cancellationToken);
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            "https://atlas.microsoft.com/route/directions?api-version=2025-01-01"
        );
        request.Headers.TryAddWithoutValidation("Authorization", $"jwt-sas {token.Token}");
        request.Content = JsonContent.Create(
            new
            {
                type = "FeatureCollection",
                features = new[] { from, to }.Select(
                    (point, index) =>
                        new
                        {
                            type = "Feature",
                            geometry = new
                            {
                                type = "Point",
                                coordinates = new[] { point.Longitude, point.Latitude },
                            },
                            properties = new { pointIndex = index, pointType = "waypoint" },
                        }
                ),
                travelMode = mode == "walking" ? "walking" : "driving",
                departAt = departure.ToString("O"),
                optimizeRoute = mode == "walking" ? "fastestWithoutTraffic" : "fastestWithTraffic",
                routeOutputOptions = new[] { "routePath" },
                maxRouteCount = 1,
            },
            mediaType: new MediaTypeHeaderValue("application/geo+json")
        );
        using var response = await client.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        using var document = await JsonDocument.ParseAsync(
            await response.Content.ReadAsStreamAsync(cancellationToken),
            cancellationToken: cancellationToken
        );
        if (
            document.RootElement.ValueKind != JsonValueKind.Object
            || !document.RootElement.TryGetProperty("features", out var features)
            || features.ValueKind != JsonValueKind.Array
        )
        {
            return null;
        }
        foreach (var feature in features.EnumerateArray())
        {
            if (
                feature.ValueKind != JsonValueKind.Object
                || !feature.TryGetProperty("properties", out var properties)
                || properties.ValueKind != JsonValueKind.Object
                || !properties.TryGetProperty("type", out var kind)
                || kind.ValueKind != JsonValueKind.String
                || kind.GetString() != "RoutePath"
                || !feature.TryGetProperty("geometry", out var geometry)
                || geometry.ValueKind != JsonValueKind.Object
                || !geometry.TryGetProperty("type", out var type)
                || type.ValueKind != JsonValueKind.String
                || type.GetString() != "MultiLineString"
                || !geometry.TryGetProperty("coordinates", out var coordinates)
                || coordinates.ValueKind != JsonValueKind.Array
            )
            {
                continue;
            }
            var lines = coordinates.Deserialize<double[][][]>();
            if (
                lines is not { Length: > 0 }
                || lines.Any(line =>
                    line is not { Length: >= 2 }
                    || line.Any(point =>
                        point is not { Length: 2 }
                        || !double.IsFinite(point[0])
                        || !double.IsFinite(point[1])
                        || Math.Abs(point[0]) > 180
                        || Math.Abs(point[1]) > 90
                    )
                )
            )
            {
                continue;
            }
            // A successful response can snap onto a distant, sparse road network.
            // Reject that path rather than drawing travel to different locations.
            static GeographyPoint Point(double[] point) =>
                GeographyPoint.Create(point[1], point[0]);
            if (
                ActivityPlanningContext.Distance(from, Point(lines[0][0])) > 0.5
                || ActivityPlanningContext.Distance(to, Point(lines[^1][^1])) > 0.5
            )
            {
                continue;
            }
            return new("MultiLineString", lines);
        }
        return null;
    }
}
