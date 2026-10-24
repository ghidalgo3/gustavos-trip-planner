using TripPlanner.Api.Models;
using static TripPlanner.Api.Tests.Support.ActivityPlanningFixture;

namespace TripPlanner.Api.Tests.Models;

[TestClass]
public sealed class ActivityPlanningContextTests
{
    public static IEnumerable<object[]> CapacityCases =>
        [
            [TimeSpan.FromHours(13), TimeSpan.Zero],
            [TimeSpan.FromHours(13) + TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(1)],
            [TimeSpan.FromHours(15), TimeSpan.FromHours(2)],
        ];

    [TestMethod]
    [DynamicData(nameof(CapacityCases))]
    public void Capacity_ReservesMealsRestAndSlack(TimeSpan duration, TimeSpan expectedOverrun)
    {
        var planningContext = Context(duration);
        var result = planningContext.Evaluate(Plan(planningContext), Now);
        var day = result.Days.Single();
        Assert.AreEqual(TimeSpan.FromHours(16), day.AvailableDuration);
        Assert.AreEqual(TimeSpan.FromHours(2), day.MealDuration);
        Assert.AreEqual(TimeSpan.FromHours(8), day.RestDuration);
        Assert.AreEqual(expectedOverrun, day.OverrunDuration);
        Assert.AreEqual(expectedOverrun == TimeSpan.Zero ? "fits" : "conflicting", result.Status);
    }

    [TestMethod]
    public void DiningCountsOnce_AndIndividualRestOverridesChangeCapacity()
    {
        var planningContext = Context(TimeSpan.FromHours(1), TimeSpan.FromMinutes(760));
        var plan = Plan(planningContext);
        plan = plan with
        {
            Rules = [plan.Rules[0] with { CoversMeal = "lunch" }, plan.Rules[1]],
            Days =
            [
                plan.Days[0] with
                {
                    Settings = plan.Settings with { SleepStart = new TimeOnly(1, 0) },
                },
            ],
        };
        var day = planningContext.Evaluate(plan, Now).Days.Single();
        Assert.AreEqual(TimeSpan.FromMinutes(75), day.MealDuration);
        Assert.AreEqual(TimeSpan.FromHours(18), day.AvailableDuration);
        Assert.AreEqual(TimeSpan.FromHours(6), day.RestDuration);
        Assert.AreEqual(TimeSpan.Zero, day.OverrunDuration);
    }

    [TestMethod]
    public void AnchorsAndOrderConflicts_AreExplainedWithoutMovingOrDroppingActivities()
    {
        var planningContext = Context(TimeSpan.FromHours(2), TimeSpan.FromHours(1));
        var plan = Plan(planningContext);
        plan = plan with
        {
            Rules =
            [
                plan.Rules[0] with
                {
                    AfterActivityId = planningContext.Activities[1].Id,
                },
                plan.Rules[1] with
                {
                    FixedStart = new TimeOnly(8, 0),
                },
            ],
        };
        var result = planningContext.Evaluate(plan, Now);
        Assert.IsTrue(result.Issues.Any(i => i.Code == "relative_order"));
        Assert.IsTrue(result.Issues.Any(i => i.Code == "late_for_anchor"));
        Assert.HasCount(2, result.Days[0].Entries);
        Assert.AreEqual(8, result.Days[0].Entries[1].Start!.Value.Hour);
    }

    [TestMethod]
    public void UnknownInputs_NeverBecomeZeroCostFacts()
    {
        var planningContext = Context((TimeSpan?)null);
        planningContext = planningContext with
        {
            Activities = [planningContext.Activities[0] with { Geometry = null }],
        };
        var plan = Plan(planningContext) with { TransportOverrides = [], Rules = [] };
        var result = planningContext.Evaluate(plan, Now);
        Assert.AreEqual("provisional", result.Status);
        Assert.AreEqual(TimeSpan.FromHours(1), result.Days[0].ActivityDuration);
        Assert.IsGreaterThan(TimeSpan.Zero, result.TravelDuration);
        Assert.IsTrue(result.Issues.Any(i => i.Code == "hours_unknown"));
        Assert.IsTrue(result.TravellerFit.All(f => f.Estimated));
    }

    [TestMethod]
    [DataRow("2027-03-14", 120)]
    [DataRow("2027-11-07", 240)]
    public void DaylightSaving_UsesElapsedMinutesAndRejectsAmbiguousAnchors(
        string dateText,
        int expected
    )
    {
        var date = DateOnly.Parse(dateText);
        var planningContext = Context(TimeSpan.FromHours(1));
        planningContext = planningContext with
        {
            Place = planningContext.Place with { TimeZone = "America/New_York" },
            Visits = [planningContext.Visits[0] with { ArrivalDate = date, DepartureDate = date }],
        };
        var plan = Plan(planningContext) with
        {
            Settings = new()
            {
                SleepEnd = new TimeOnly(0, 0),
                SleepStart = new TimeOnly(3, 0),
                BreakfastDuration = TimeSpan.Zero,
                LunchDuration = TimeSpan.Zero,
                DinnerDuration = TimeSpan.Zero,
                SlackDuration = TimeSpan.Zero,
            },
        };
        var result = planningContext.Evaluate(plan, Now);
        Assert.AreEqual(TimeSpan.FromMinutes(expected), result.Days[0].AvailableDuration);
        plan = plan with
        {
            Rules =
            [
                plan.Rules[0] with
                {
                    FixedStart = date.Month == 3 ? new TimeOnly(2, 30) : new TimeOnly(1, 30),
                },
            ],
        };
        result = planningContext.Evaluate(plan, Now);
        Assert.IsTrue(result.Issues.Any(i => i.Code == "ambiguous_anchor"));
        Assert.IsNull(result.Days[0].Entries[0].Start);
    }

    [TestMethod]
    public void OvernightBooking_UsesNextCalendarDate_AndExpiredHoursStayUnknown()
    {
        var planningContext = Context(TimeSpan.FromHours(1));
        var plan = Plan(planningContext) with
        {
            Settings = new()
            {
                SleepStart = new TimeOnly(3, 0),
                BreakfastDuration = TimeSpan.Zero,
                LunchDuration = TimeSpan.Zero,
                DinnerDuration = TimeSpan.Zero,
                SlackDuration = TimeSpan.Zero,
            },
        };
        plan = plan with
        {
            Rules =
            [
                new(planningContext.Activities[0].Id)
                {
                    FixedStart = new TimeOnly(1, 0),
                    OpeningWindows = [new(Date, new TimeOnly(22, 0), new TimeOnly(3, 0))],
                },
            ],
        };
        var assessment = planningContext.Evaluate(plan, Now);
        Assert.AreEqual(0, assessment.ConflictCount);
        Assert.AreEqual(
            Date.AddDays(1),
            DateOnly.FromDateTime(assessment.Days[0].Entries[0].Start!.Value.DateTime)
        );
        Assert.AreEqual(1, assessment.Days[0].Entries[0].Start!.Value.Hour);
        planningContext = planningContext with
        {
            Evidence = new()
            {
                Hours =
                [
                    new(
                        planningContext.Activities[0].Id,
                        [new(Date, new TimeOnly(9, 0), new TimeOnly(10, 0))],
                        "https://example.com/hours",
                        Now.AddDays(-2),
                        false
                    )
                    {
                        ActivityContext = ActivityPlanningContext.ActivityContext(
                            planningContext.Activities[0]
                        ),
                    },
                ],
            },
        };
        assessment = planningContext.Evaluate(plan with { Rules = [] }, Now);
        Assert.IsTrue(assessment.Issues.Any(i => i.Code == "hours_unknown"));
        Assert.IsTrue(assessment.Evidence.Single().Provisional);
    }
}
