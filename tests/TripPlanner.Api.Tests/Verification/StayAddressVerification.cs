using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Destinations;

namespace TripPlanner.Api.Tests.Verification;

public static class StayAddressVerification
{
    public static async Task<bool> RunAsync(IStayAddressResearch research)
    {
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(45));
        var destination = new GeoJsonFeature<DestinationProperties>(
            "Feature",
            "sapporo-jp",
            new("Point", GeographyPoint.Create(43.0618, 141.3545)),
            new("Sapporo", "JP", "Asia/Tokyo", "verification", null, null, [])
        );
        var candidates = await research.FindAsync(
            "SAPPORO STREAM HOTEL",
            destination,
            cancellation.Token
        );
        Console.WriteLine(JsonSerializer.Serialize(candidates, JsonSerializerOptions.Web));
        bool found = candidates.Any(candidate =>
            candidate.Geometry is not null
            && candidate.Name.Contains("STREAM", StringComparison.OrdinalIgnoreCase)
            && candidate.MapAddress?.Contains("064-0804", StringComparison.Ordinal) == true
        );
        Console.WriteLine(
            found
                ? "Stay address verification passed: sourced hotel has a reviewable Azure map pin."
                : "Stay address verification failed: no reviewable hotel pin was returned."
        );
        return found;
    }
}
