using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.ActivityPlanning;

namespace TripPlanner.Api.Services.Maps;

public sealed partial class AzureMapsClient
{
    public async Task<ActivityRoutePath?> RouteAsync(
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
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            "route/directions?api-version=2025-01-01"
        );
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
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));
        using var response = await SendAsync(request, timeout.Token);
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

    public async Task<MapRouteEstimate?> EstimateRouteAsync(
        GeographyPoint from,
        GeographyPoint to,
        DateTimeOffset departure,
        string mode,
        PlanningProviderBudget budget,
        CancellationToken ct
    )
    {
        if (!ActivityPlanRules.TransportModes.Contains(mode))
        {
            throw new PlanningProviderException("Choose walking, taxi, or driving.");
        }
        var now = clock.GetUtcNow();
        using var response = await PlanningProviderRequests.SendAsync(
            () =>
            {
                var request = new HttpRequestMessage(
                    HttpMethod.Post,
                    "route/matrix?api-version=2025-01-01"
                );
                request.Content = JsonContent.Create(
                    new
                    {
                        type = "FeatureCollection",
                        features = new[]
                        {
                            new
                            {
                                type = "Feature",
                                geometry = new
                                {
                                    type = "MultiPoint",
                                    coordinates = new[] { new[] { from.Longitude, from.Latitude } },
                                },
                                properties = new { pointType = "origins" },
                            },
                            new
                            {
                                type = "Feature",
                                geometry = new
                                {
                                    type = "MultiPoint",
                                    coordinates = new[] { new[] { to.Longitude, to.Latitude } },
                                },
                                properties = new { pointType = "destinations" },
                            },
                        },
                        travelMode = mode == "walking" ? "walking" : "driving",
                        departAt = departure.ToString("O"),
                        traffic = "historical",
                    },
                    mediaType: new MediaTypeHeaderValue("application/geo+json")
                );
                return request;
            },
            budget,
            ct,
            (request, cancellationToken) =>
                SendAsync(request, cancellationToken, HttpCompletionOption.ResponseHeadersRead),
            planning.Value,
            clock
        );
        if (response.NoStore)
        {
            throw new PlanningProviderException(
                "Road/walking evidence cannot be cached under the provider response policy."
            );
        }

        var cell = response.RootElement.GetProperty("properties").GetProperty("matrix")[0];
        if (cell.GetProperty("statusCode").GetInt32() != 200)
        {
            return null;
        }

        double seconds = cell.TryGetProperty("durationTrafficInSeconds", out var traffic)
            ? traffic.GetDouble()
            : cell.GetProperty("durationInSeconds").GetDouble();
        if (!double.IsFinite(seconds) || seconds is < 0 or > 86400)
        {
            return null;
        }

        return new MapRouteEstimate(TimeSpan.FromSeconds(seconds), now, response.CacheUntil);
    }
}
