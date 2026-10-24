using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Activities;

namespace TripPlanner.Api.Tests.Verification;

public static class ActivityPlaceVerification
{
    public static async Task<bool> RunAsync(IActivityPlaceResearch research)
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(45));
        var destination = new GeoJsonFeature<DestinationProperties>(
            "Feature",
            "tokyo-jp",
            new("Point", GeographyPoint.Create(35.68, 139.69)),
            new("Tokyo", "JP", "Asia/Tokyo", "verification", null, null, [])
        );
        var candidates = await research.FindAsync("teamlabs planets", destination, deadline.Token);
        Console.WriteLine(JsonSerializer.Serialize(candidates, JsonSerializerOptions.Web));
        bool found = candidates.Any(candidate =>
            candidate.Geometry is not null
            && (
                candidate.Name.Contains("Planets", StringComparison.OrdinalIgnoreCase)
                || candidate.Name.Contains("プラネッツ", StringComparison.Ordinal)
            )
        );
        Console.WriteLine(
            found
                ? "Activity place verification passed: sourced teamLab Planets venue has a reviewable Azure map pin."
                : "Activity place verification failed: no reviewable Planets pin returned."
        );
        return found;
    }
}
