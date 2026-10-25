using System.Collections.Concurrent;
using Microsoft.Spatial;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.ActivityPlanning;
using static TripPlanner.Api.Tests.Support.ActivityPlanningFixture;

namespace TripPlanner.Api.Tests.Services.ActivityPlanning;

[TestClass]
public sealed class ActivityPlanningEnrichmentTests
{
    [TestMethod]
    [DataRow(4, 12, "walking")]
    [DataRow(12, 4, "driving")]
    public async Task AutomaticRouting_RequestsBothModesAndUsesShortestTimeDespitePreferenceScores(
        int walkingMinutes,
        int drivingMinutes,
        string expectedMode
    )
    {
        var provider = new Routes(walkingMinutes, drivingMinutes);
        var enrichment = new ActivityPlanningEnrichment(provider, provider, provider, new Clock());
        var context = Context(TimeSpan.FromHours(1));
        var plan = Plan(context) with { TransportOverrides = [] };
        using var budget = new PlanningProviderBudget(100);
        var evidence = await enrichment.RoutesAsync(
            context,
            [plan],
            true,
            budget,
            CancellationToken.None
        );
        CollectionAssert.AreEquivalent(
            new[] { "walking", "driving" },
            provider.Requested.Distinct().ToArray()
        );
        var assessment = (context with { Evidence = evidence }).Evaluate(plan, Now);
        foreach (var leg in assessment.Days.Single().Travel)
        {
            Assert.AreEqual(expectedMode, leg.Mode);
            Assert.AreEqual(
                TimeSpan.FromMinutes(Math.Min(walkingMinutes, drivingMinutes)),
                leg.Duration
            );
        }
        Assert.IsTrue(
            evidence.Routes.All(r =>
                r.Duration
                == TimeSpan.FromMinutes(r.Mode == "walking" ? walkingMinutes : drivingMinutes)
            )
        );
    }

    private sealed class Clock : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private sealed class Routes(int walkingMinutes, int drivingMinutes)
        : IActivityRoutingProvider,
            IActivityPreferenceScorer,
            IActivityPlanningResearch
    {
        public ConcurrentBag<string> Requested { get; } = [];

        public Task<ActivityRouteEvidence[]> RoutesAsync(
            GeographyPoint from,
            GeographyPoint to,
            DateTimeOffset departure,
            string mode,
            PlanningProviderBudget budget,
            CancellationToken ct
        )
        {
            Requested.Add(mode);
            int duration = mode == "walking" ? walkingMinutes : drivingMinutes;
            var route = new ActivityRouteEvidence(
                ActivityPlanningContext.RouteKey(from, to, departure, mode),
                mode,
                TimeSpan.FromMinutes(duration),
                Now,
                Now.AddDays(1),
                "Provider route",
                PreferenceScore: 1
            );
            return Task.FromResult(
                new[]
                {
                    route,
                    route with
                    {
                        Duration = route.Duration + TimeSpan.FromMinutes(10),
                        PreferenceScore = 5,
                    },
                }
            );
        }

        public Task<ActivityRouteEvidence[]> TransportAsync(
            ActivityPlanningContext context,
            ActivityRouteEvidence[] choices,
            PlanningProviderBudget budget,
            CancellationToken ct
        ) => Task.FromResult(choices);

        public Task<ActivityAffinity[]> AffinityAsync(
            ActivityPlanningContext context,
            PlanningProviderBudget budget,
            CancellationToken ct
        ) => throw new NotSupportedException();

        public Task<ActivityHoursEvidence?> HoursAsync(
            Activity activity,
            string city,
            DateOnly[] dates,
            PlanningProviderBudget budget,
            CancellationToken ct
        ) => throw new NotSupportedException();

        public Task<SuggestedPlanningRule[]> InterpretAsync(
            ActivityPlanningContext context,
            ActivityPlan plan,
            PlanningProviderBudget budget,
            CancellationToken ct
        ) => throw new NotSupportedException();
    }
}
