using Microsoft.Spatial;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services.ActivityPlanning;
using TripPlanner.Api.Services.Maps;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Services.Maps;

[TestClass]
public sealed class AzureMapsConsumerTests
{
    [TestMethod]
    public async Task PlanningAppliesTaxiPickupTimeToTheTypedRouteEstimate()
    {
        var maps = new Maps();
        var provider = new ActivityPlanningProviders(
            maps,
            Microsoft.Extensions.Options.Options.Create(new ActivityPlanningOptions())
        );
        using var budget = new PlanningProviderBudget(1);
        var evidence = await provider.RoutesAsync(
            GeographyPoint.Create(48.8, 2.3),
            GeographyPoint.Create(48.9, 2.4),
            DateTimeOffset.Parse("2027-06-10T07:00:00Z"),
            "taxi",
            budget,
            default
        );
        Assert.AreEqual(TimeSpan.FromMinutes(21), evidence.Single().Duration);
        Assert.AreEqual(maps.Estimate.RetrievedAt, evidence.Single().RetrievedAt);
        Assert.AreEqual(maps.Estimate.ExpiresAt, evidence.Single().ExpiresAt);
    }

    private sealed class Maps : AzureMapsStub
    {
        public MapRouteEstimate Estimate { get; } =
            new(
                TimeSpan.FromSeconds(901),
                DateTimeOffset.Parse("2027-06-10T07:00:00Z"),
                DateTimeOffset.Parse("2027-06-10T07:15:00Z")
            );

        public override Task<MapRouteEstimate?> EstimateRouteAsync(
            GeographyPoint from,
            GeographyPoint to,
            DateTimeOffset departure,
            string mode,
            PlanningProviderBudget budget,
            CancellationToken cancellationToken
        ) => Task.FromResult<MapRouteEstimate?>(Estimate);
    }
}
