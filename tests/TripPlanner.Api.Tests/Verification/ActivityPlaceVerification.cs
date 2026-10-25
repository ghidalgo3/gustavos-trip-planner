using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Activities;

namespace TripPlanner.Api.Tests.Verification;

public static class ActivityPlaceVerification
{
    public static async Task<bool> RunAsync(IActivityPlaceResearch research)
    {
        bool successful = true;
        foreach (
            var (query, city, cityId, zone, latitude, longitude, expectedNames) in new[]
            {
                (
                    "teamlabs planets",
                    "Tokyo",
                    "tokyo-jp",
                    "Asia/Tokyo",
                    35.68,
                    139.69,
                    new[] { "Planets", "プラネッツ" }
                ),
                (
                    "Beer Museum",
                    "Sapporo",
                    "sapporo-jp",
                    "Asia/Tokyo",
                    43.0618,
                    141.3545,
                    new[] { "Beer Museum", "ビール博物館" }
                ),
            }
        )
        {
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(45));
            var destination = new GeoJsonFeature<DestinationProperties>(
                "Feature",
                cityId,
                new("Point", GeographyPoint.Create(latitude, longitude)),
                new(city, "JP", zone, "verification", null, null, [])
            );
            var candidates = await research.FindAsync(query, destination, deadline.Token);
            Console.WriteLine(JsonSerializer.Serialize(candidates, JsonSerializerOptions.Web));
            bool found = candidates.Any(candidate =>
                candidate.Geometry is not null
                && expectedNames.Any(name =>
                    candidate.Name.Contains(name, StringComparison.OrdinalIgnoreCase)
                )
            );
            Console.WriteLine(
                $"Activity place verification ({city}, {query}): {(found ? "passed: sourced venue has a reviewable Azure map pin" : "failed: no reviewable venue pin returned")}."
            );
            successful &= found;
        }
        return successful;
    }
}
