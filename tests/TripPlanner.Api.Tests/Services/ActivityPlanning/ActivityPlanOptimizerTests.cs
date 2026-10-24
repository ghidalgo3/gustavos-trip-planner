using System.Text.Json;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services.ActivityPlanning;
using static TripPlanner.Api.Tests.Support.ActivityPlanningFixture;

namespace TripPlanner.Api.Tests.Services.ActivityPlanning;

[TestClass]
public sealed class ActivityPlanOptimizerTests
{
    [TestMethod]
    public async Task ScheduleSelected_MinimizesTheCompleteStayRoundTrip_ComparedWithAllOrders()
    {
        var context = Context(
            TimeSpan.FromMinutes(5),
            TimeSpan.FromMinutes(5),
            TimeSpan.FromMinutes(5),
            TimeSpan.FromMinutes(5)
        );
        var ids = context.Activities.Take(3).Select(a => a.Id).ToArray();
        Guid?[] stops = [null, .. ids];
        int[,] costs =
        {
            { 0, 8, 2, 9 },
            { 4, 0, 7, 3 },
            { 6, 5, 0, 8 },
            { 2, 9, 4, 0 },
        };
        var routes = new List<ActivityTransportOverride>();
        for (int from = 0; from < stops.Length; from++)
        {
            for (int to = 0; to < stops.Length; to++)
            {
                if (from != to)
                {
                    routes.Add(
                        new(
                            Date,
                            stops[from],
                            stops[to],
                            "walking",
                            TimeSpan.FromMinutes(costs[from, to])
                        )
                    );
                }
            }
        }
        var plan = Plan(context) with
        {
            SelectedActivityIds = ids,
            Days = [Plan(context).Days[0] with { ActivityIds = [] }],
            TransportOverrides = [.. routes],
        };
        int reference = int.MaxValue;
        foreach (int first in new[] { 1, 2, 3 })
        {
            foreach (int second in new[] { 1, 2, 3 }.Where(i => i != first))
            {
                int third = 6 - first - second;
                reference = Math.Min(
                    reference,
                    costs[0, first] + costs[first, second] + costs[second, third] + costs[third, 0]
                );
            }
        }
        var result = await Schedule(context, plan);
        Assert.HasCount(1, result.Alternatives);
        var choice = result.Alternatives.Single();
        CollectionAssert.AreEquivalent(ids, choice.Plan.SelectedActivityIds);
        CollectionAssert.AreEquivalent(ids, choice.Plan.Days.Single().ActivityIds);
        CollectionAssert.AreEqual(plan.Rules, choice.Plan.Rules);
        Assert.AreEqual(TimeSpan.FromMinutes(reference), choice.Assessment.TravelDuration);
        var legs = choice.Assessment.Days.Single().Travel;
        Assert.HasCount(4, legs);
        Assert.IsNull(legs[0].FromActivityId);
        Assert.IsNull(legs[^1].ToActivityId);
        Assert.IsEmpty(result.Suggestions);
    }

    [TestMethod]
    [DataRow(true)]
    [DataRow(false)]
    public async Task ScheduleSelected_NeedsAStay_AndNeverDropsActivitiesToFit(bool missingStay)
    {
        var context = Context(TimeSpan.FromHours(24), TimeSpan.FromHours(24));
        if (missingStay)
        {
            context = context with { StayLocation = null };
        }
        var plan = Plan(context) with { Days = [Plan(context).Days[0] with { ActivityIds = [] }] };
        var result = await Schedule(context, plan);
        Assert.IsEmpty(result.Alternatives);
        Assert.IsEmpty(result.Suggestions);
        Assert.IsTrue(
            result.Warnings.Any(w =>
                w.Contains(missingStay ? "accommodation" : "All selected activities")
            )
        );
    }

    private static Task<ActivityPlanningResult> Schedule(
        ActivityPlanningContext context,
        ActivityPlan plan
    )
    {
        var optimizer = new ActivityPlanOptimizer(
            Microsoft.Extensions.Options.Options.Create(
                new ActivityPlanningOptions { SolverSeconds = 3 }
            ),
            TimeProvider.System
        );
        var job = new ActivityPlanningJob(
            Guid.NewGuid(),
            context.Trip.OwnerUserId,
            context.Trip.Id,
            context.Place.CityId,
            "schedule",
            "hash",
            plan,
            1,
            0,
            false,
            false,
            "Website",
            Now
        );
        return optimizer.ProposeAsync(
            context,
            job,
            [],
            _ => Task.CompletedTask,
            CancellationToken.None
        );
    }

    [TestMethod]
    public async Task Solver_SelectsBestSubsetAndHonorsLocks_ComparedWithExhaustiveSmallFixture()
    {
        var s = Context(
            TimeSpan.FromMinutes(30),
            TimeSpan.FromMinutes(50),
            TimeSpan.FromMinutes(65),
            TimeSpan.FromMinutes(80)
        );
        var initial = Plan(s) with
        {
            SelectedActivityIds = [],
            Days =
            [
                Plan(s).Days[0] with
                {
                    ActivityIds = [],
                    AvailableFrom = new TimeOnly(9, 0),
                    AvailableUntil = new TimeOnly(11, 0),
                },
            ],
            Settings = new()
            {
                BreakfastDuration = TimeSpan.Zero,
                LunchDuration = TimeSpan.Zero,
                DinnerDuration = TimeSpan.Zero,
                SlackDuration = TimeSpan.Zero,
                TransportMode = "walking",
            },
        };
        var affinity = s
            .Activities.Select(
                (a, i) =>
                    new ActivityAffinity(a.Id, s.Travellers[0].Id, new[] { 2d, 3d, 4d, 2d }[i], 1)
            )
            .ToArray();
        s = s with
        {
            Evidence = new() { Affinities = affinity, AffinityContext = s.AffinityContext() },
        };

        double reference = 0;
        for (int mask = 0; mask < 16; mask++)
        {
            var ids = s
                .Activities.Where((_, i) => (mask & (1 << i)) != 0)
                .Select(a => a.Id)
                .ToArray();
            var candidate = initial with
            {
                SelectedActivityIds = ids,
                Days = [initial.Days[0] with { ActivityIds = ids }],
            };
            var evaluation = s.Evaluate(candidate, Now);
            if (evaluation.ConflictCount == 0)
            {
                reference = Math.Max(reference, evaluation.GroupUtility);
            }
        }
        var optimizer = new ActivityPlanOptimizer(
            Microsoft.Extensions.Options.Options.Create(
                new ActivityPlanningOptions { SolverSeconds = 3 }
            ),
            TimeProvider.System
        );
        var job = new ActivityPlanningJob(
            Guid.NewGuid(),
            s.Trip.OwnerUserId,
            s.Trip.Id,
            s.Place.CityId,
            "draft",
            "hash",
            initial,
            1,
            0,
            false,
            false,
            "Website",
            Now
        );
        var result = await optimizer.ProposeAsync(
            s,
            job,
            [],
            _ => Task.CompletedTask,
            CancellationToken.None
        );
        Assert.IsNotEmpty(result.Alternatives, JsonSerializer.Serialize(result));
        Assert.AreEqual(
            reference,
            result.Alternatives.First(a => a.Id == "overall").Assessment.GroupUtility
        );
        Assert.IsTrue(result.Alternatives.All(a => a.Assessment.ConflictCount == 0));
        Assert.IsTrue(
            result
                .Alternatives.Where(a => a.Id == "travel")
                .All(a => a.Assessment.GroupUtility >= reference * .9)
        );
        var locked = initial with
        {
            Rules =
            [
                new(s.Activities[3].Id)
                {
                    MustDo = true,
                    FixedDate = Date,
                    FixedStart = new TimeOnly(9, 10),
                    AlwaysAvailable = true,
                },
            ],
        };
        result = await optimizer.ProposeAsync(
            s,
            job with
            {
                Plan = locked,
            },
            [],
            _ => Task.CompletedTask,
            CancellationToken.None
        );
        Assert.IsNotEmpty(result.Alternatives);
        Assert.IsTrue(
            result.Alternatives.All(a => a.Plan.SelectedActivityIds.Contains(s.Activities[3].Id))
        );
    }

    [TestMethod]
    public async Task Solver_BalancesTravellers_AndSeparatelyExplainsContradictoryRestrictions()
    {
        var s = Context(
            TimeSpan.FromMinutes(50),
            TimeSpan.FromMinutes(50),
            TimeSpan.FromMinutes(50)
        );
        var second = s.Travellers[0] with { Id = Guid.NewGuid(), DisplayName = "Second" };
        s = s with { Travellers = [s.Travellers[0], second] };
        var scores = new[] { new[] { 4d, 4d, 0d }, new[] { 0d, 0d, 3d } };
        s = s with
        {
            Evidence = new()
            {
                AffinityContext = s.AffinityContext(),
                Affinities = s
                    .Travellers.SelectMany(
                        (u, i) =>
                            s.Activities.Select(
                                (a, j) => new ActivityAffinity(a.Id, u.Id, scores[i][j], 1)
                            )
                    )
                    .ToArray(),
            },
        };
        var initial = Plan(s);
        initial = initial with
        {
            SelectedActivityIds = [],
            Days =
            [
                initial.Days[0] with
                {
                    ActivityIds = [],
                    AvailableFrom = new TimeOnly(9, 0),
                    AvailableUntil = new TimeOnly(11, 0),
                },
            ],
            Settings = initial.Settings with
            {
                BreakfastDuration = TimeSpan.Zero,
                LunchDuration = TimeSpan.Zero,
                DinnerDuration = TimeSpan.Zero,
                SlackDuration = TimeSpan.Zero,
            },
        };
        var optimizer = new ActivityPlanOptimizer(
            Microsoft.Extensions.Options.Options.Create(
                new ActivityPlanningOptions { SolverSeconds = 3 }
            ),
            TimeProvider.System
        );
        var job = new ActivityPlanningJob(
            Guid.NewGuid(),
            s.Trip.OwnerUserId,
            s.Trip.Id,
            s.Place.CityId,
            "draft",
            "hash",
            initial,
            1,
            0,
            false,
            false,
            "Website",
            Now
        );
        var result = await optimizer.ProposeAsync(
            s,
            job,
            [],
            _ => Task.CompletedTask,
            CancellationToken.None
        );
        var overall = result.Alternatives.Single(a => a.Id == "overall");
        var balanced = result.Alternatives.Single(a => a.Id == "balanced");
        Assert.IsFalse(overall.Plan.SelectedActivityIds.Contains(s.Activities[2].Id));
        Assert.Contains(s.Activities[2].Id, balanced.Plan.SelectedActivityIds);
        Assert.IsTrue(balanced.Assessment.TravellerFit.All(f => f.Points > 0));
        var contradictory = initial with
        {
            ExcludedActivityIds = [s.Activities[0].Id],
            Rules = [new(s.Activities[0].Id) { MustDo = true }],
        };
        result = await optimizer.ProposeAsync(
            s,
            job with
            {
                Plan = contradictory,
            },
            [],
            _ => Task.CompletedTask,
            CancellationToken.None
        );
        Assert.AreEqual("proven_infeasible", result.Status);
        Assert.IsEmpty(result.Alternatives);
        Assert.IsNotEmpty(result.RuleChanges);
    }

    [TestMethod]
    public async Task Solver_HandlesOneHundredCandidatesAcrossThirtyDaysWithinJobDeadline()
    {
        var s = Context(Enumerable.Repeat<TimeSpan?>(TimeSpan.FromHours(1), 100).ToArray());
        s = s with { Visits = [s.Visits[0] with { DepartureDate = Date.AddDays(29) }] };
        var plan = ActivityPlanRules.Initial(s) with
        {
            Rules = s
                .Activities.Select(a => new ActivityPlanRule(a.Id) { AlwaysAvailable = true })
                .ToArray(),
        };
        var optimizer = new ActivityPlanOptimizer(
            Microsoft.Extensions.Options.Options.Create(
                new ActivityPlanningOptions { SolverSeconds = 8 }
            ),
            TimeProvider.System
        );
        var job = new ActivityPlanningJob(
            Guid.NewGuid(),
            s.Trip.OwnerUserId,
            s.Trip.Id,
            s.Place.CityId,
            "draft",
            "hash",
            plan,
            1,
            0,
            false,
            false,
            "Website",
            Now
        );
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var watch = System.Diagnostics.Stopwatch.StartNew();
        var result = await optimizer.ProposeAsync(
            s,
            job,
            [],
            _ => Task.CompletedTask,
            deadline.Token
        );
        Assert.IsLessThan(30d, watch.Elapsed.TotalSeconds);
        Assert.IsTrue(
            result.Status is "completed" or "timeout" or "no_improvement_found",
            result.Status
        );
        Assert.IsNotEmpty(
            result.Alternatives,
            "The target workload must return a usable partial schedule."
        );
        Assert.IsTrue(result.Alternatives.All(a => a.Assessment.ConflictCount == 0));
    }
}
