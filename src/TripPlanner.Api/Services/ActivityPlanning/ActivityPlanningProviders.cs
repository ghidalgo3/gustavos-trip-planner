using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Microsoft.Spatial;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services.Maps;

namespace TripPlanner.Api.Services.ActivityPlanning;

public sealed class PlanningProviderBudget(int limit) : IDisposable
{
    private int remaining = limit;
    public SemaphoreSlim Concurrency { get; } = new(4);

    public bool Take() => Interlocked.Decrement(ref remaining) >= 0;

    public bool Exhausted => Volatile.Read(ref remaining) <= 0;

    public void Dispose() => Concurrency.Dispose();
}

public interface IActivityRoutingProvider
{
    Task<ActivityRouteEvidence[]> RoutesAsync(
        GeographyPoint from,
        GeographyPoint to,
        DateTimeOffset departure,
        string mode,
        PlanningProviderBudget budget,
        CancellationToken ct
    );
}

// Fixed provider hosts only. Untrusted venue URLs are evidence, never request targets.
public sealed class ActivityPlanningProviders(
    IAzureMapsClient maps,
    IOptions<ActivityPlanningOptions> planning
) : IActivityRoutingProvider
{
    public async Task<ActivityRouteEvidence[]> RoutesAsync(
        GeographyPoint from,
        GeographyPoint to,
        DateTimeOffset departure,
        string mode,
        PlanningProviderBudget budget,
        CancellationToken ct
    )
    {
        string key = ActivityPlanningContext.RouteKey(from, to, departure, mode);
        if (!ActivityPlanRules.TransportModes.Contains(mode))
        {
            throw new PlanningProviderException("Choose walking, taxi, or driving.");
        }
        var estimate = await maps.EstimateRouteAsync(from, to, departure, mode, budget, ct);
        if (estimate is null || estimate.Duration > TimeSpan.FromDays(1))
        {
            return [];
        }
        double seconds = estimate.Duration.TotalSeconds;
        var now = estimate.RetrievedAt;
        int minutes = (int)Math.Ceiling(seconds / 60) + (mode == "taxi" ? 5 : 0);
        // A taxi pickup allowance is explicitly an assumption, even when road time is verified.
        return
        [
            new(
                key,
                mode,
                TimeSpan.FromMinutes(minutes),
                now,
                (
                    estimate.ExpiresAt is { } until
                    && until < now.AddHours(Math.Clamp(planning.Value.EvidenceHours, 1, 24))
                        ? until
                        : now.AddHours(Math.Clamp(planning.Value.EvidenceHours, 1, 24))
                ),
                mode == "taxi" ? "Azure Maps road + 5-minute pickup assumption" : "Azure Maps",
                Provisional: mode == "taxi",
                WalkingDuration: mode == "walking" ? TimeSpan.FromMinutes(minutes) : TimeSpan.Zero
            ),
        ];
    }
}

public sealed class PlanningProviderException(string message) : Exception(message);
