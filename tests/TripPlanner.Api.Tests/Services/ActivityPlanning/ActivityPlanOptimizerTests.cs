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
    public async Task RepeatVisits_ScheduleUsesAccommodationOnlyForTheVisitThatHasIt()
    {
        var context = Context(TimeSpan.FromMinutes(15), TimeSpan.FromMinutes(15));
        var first = context.Visits[0];
        var second = first with
        {
            StayId = Guid.NewGuid(),
            Order = 1,
            ArrivalDate = Date.AddDays(2),
            DepartureDate = Date.AddDays(2),
        };
        context = context with { Visits = [first, second] };
        var plan = Plan(context);
        plan = plan with
        {
            Days =
            [
                plan.Days[0] with
                {
                    ActivityIds = [],
                },
                plan.Days[0] with
                {
                    StayId = second.StayId,
                    Date = second.ArrivalDate!.Value,
                    ActivityIds = [],
                },
            ],
            Rules =
            [
                plan.Rules[0] with
                {
                    FixedDate = Date,
                },
                plan.Rules[1] with
                {
                    FixedDate = second.ArrivalDate,
                },
            ],
        };
        var result = await Schedule(context, plan);
        Assert.HasCount(1, result.Alternatives);
        var days = result.Alternatives.Single().Assessment.Days;
        Assert.HasCount(2, days.Single(d => d.StayId == first.StayId).Travel);
        var dayWithoutStay = days.Single(d => d.StayId == second.StayId);
        Assert.IsEmpty(dayWithoutStay.Travel);
        Assert.IsTrue(
            dayWithoutStay.Entries.Single().Start
                >= dayWithoutStay.Breaks.Single(b => b.Name == "dinner").End
        );
    }

    [TestMethod]
    [DataRow(false)]
    [DataRow(true)]
    public async Task ScheduleSelected_MinimizesTravel_WithOrWithoutStay_ComparedWithAllOrders(
        bool missingStay
    )
    {
        var context = Context(
            TimeSpan.FromMinutes(5),
            TimeSpan.FromMinutes(5),
            TimeSpan.FromMinutes(5),
            TimeSpan.FromMinutes(5)
        );
        if (missingStay)
        {
            context = context with
            {
                StayLocations = new Dictionary<Guid, GeoJsonFeature<StayLocationProperties>>(),
            };
        }
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
            Days = [Plan(context).Days[0] with { ActivityIds = [], Name = "EPCOT Visit" }],
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
                    costs[first, second]
                        + costs[second, third]
                        + (missingStay ? 0 : costs[0, first] + costs[third, 0])
                );
            }
        }
        var result = await Schedule(context, plan);
        Assert.HasCount(1, result.Alternatives);
        var choice = result.Alternatives.Single();
        CollectionAssert.AreEquivalent(ids, choice.Plan.SelectedActivityIds);
        CollectionAssert.AreEquivalent(ids, choice.Plan.Days.Single().ActivityIds);
        Assert.AreEqual("EPCOT Visit", choice.Plan.Days.Single().Name);
        CollectionAssert.AreEqual(plan.Rules, choice.Plan.Rules);
        Assert.AreEqual(TimeSpan.FromMinutes(reference), choice.Assessment.TravelDuration);
        var legs = choice.Assessment.Days.Single().Travel;
        Assert.HasCount(missingStay ? 2 : 4, legs);
        if (missingStay)
        {
            Assert.IsTrue(
                legs.All(l => l.FromActivityId is not null && l.ToActivityId is not null)
            );
            var day = choice.Assessment.Days.Single();
            Assert.AreEqual(
                day.Breaks.Single(b => b.Name == "breakfast").End,
                day.Entries[0].Start
            );
            Assert.IsTrue(day.Entries[^1].Start >= day.Breaks.Single(b => b.Name == "dinner").End);
            Assert.AreEqual(
                new TimeOnly(19, 0),
                TimeOnly.FromDateTime(
                    day.Breaks.Single(b => b.Name == "dinner").Start!.Value.DateTime
                )
            );
        }
        else
        {
            Assert.IsNull(legs[0].FromActivityId);
            Assert.IsNull(legs[^1].ToActivityId);
        }
        Assert.IsEmpty(result.Suggestions);
    }

    [TestMethod]
    [DataRow(true)]
    [DataRow(false)]
    public async Task ScheduleSelected_NeverDropsActivitiesToFit_WithOrWithoutAStay(
        bool missingStay
    )
    {
        var context = Context(TimeSpan.FromHours(24), TimeSpan.FromHours(24));
        if (missingStay)
        {
            context = context with
            {
                StayLocations = new Dictionary<Guid, GeoJsonFeature<StayLocationProperties>>(),
            };
        }
        var plan = Plan(context) with { Days = [Plan(context).Days[0] with { ActivityIds = [] }] };
        var result = await Schedule(context, plan);
        Assert.IsEmpty(result.Alternatives);
        Assert.IsEmpty(result.Suggestions);
        Assert.IsTrue(result.Warnings.Any(w => w.Contains("All selected activities")));
    }

    [TestMethod]
    public async Task WithoutStay_DinnerBoundaryRespectsFixedTimes_AndEditableMealAllowance()
    {
        var context = Context(TimeSpan.FromHours(1)) with
        {
            StayLocations = new Dictionary<Guid, GeoJsonFeature<StayLocationProperties>>(),
        };
        var plan = Plan(context);
        plan = plan with
        {
            Days = [plan.Days[0] with { ActivityIds = [] }],
            Rules = [plan.Rules[0] with { FixedStart = new TimeOnly(17, 0) }],
        };
        var conflict = await Schedule(context, plan);
        Assert.IsEmpty(conflict.Alternatives);

        var allowed = await Schedule(
            context,
            plan with
            {
                Settings = plan.Settings with { DinnerDuration = TimeSpan.Zero },
            }
        );
        var day = allowed.Alternatives.Single().Assessment.Days.Single();
        Assert.AreEqual(
            new TimeOnly(17, 0),
            TimeOnly.FromDateTime(day.Entries.Single().Start!.Value.DateTime)
        );
        Assert.IsFalse(day.Breaks.Any(b => b.Name == "dinner"));
        Assert.IsEmpty(day.Travel);
    }

    [TestMethod]
    public async Task SelectedFlights_ConstrainGeneratedSchedulesWithoutManualConfirmation()
    {
        var context = WithFlights(Context(TimeSpan.FromHours(1)));
        var result = await Schedule(context, Plan(context));
        Assert.IsNotEmpty(result.Alternatives);
        foreach (var alternative in result.Alternatives)
        {
            var day = alternative.Assessment.Days.Single();
            Assert.IsTrue(
                day.Entries.Single().Start >= day.FlightAvailability!.AvailableFromInstant
            );
            Assert.IsTrue(
                day.Entries.Single().End <= day.FlightAvailability!.AvailableUntilInstant
            );
            Assert.IsFalse(alternative.Assessment.Issues.Any(i => i.Code == "flight_unavailable"));
        }
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
