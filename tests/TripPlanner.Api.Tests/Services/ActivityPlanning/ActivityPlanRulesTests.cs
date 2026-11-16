using TripPlanner.Api.Models;
using TripPlanner.Api.Services.ActivityPlanning;
using static TripPlanner.Api.Tests.Support.ActivityPlanningFixture;

namespace TripPlanner.Api.Tests.Services.ActivityPlanning;

[TestClass]
public sealed class ActivityPlanRulesTests
{
    [TestMethod]
    public void VisitDateInvalidationPreservesOtherVisitOnSharedDayAndClearsUnassignedDateAnchors()
    {
        var context = Context(TimeSpan.FromHours(1), TimeSpan.FromHours(1));
        var first = context.Visits[0];
        var repeat = first with { StayId = Guid.NewGuid() };
        var affected = context.Activities[0].Id;
        var retained = context.Activities[1].Id;
        var unassigned = Guid.NewGuid();
        var plan = Plan(context) with
        {
            Days =
            [
                new(first.StayId, Date, [affected]),
                new(repeat.StayId, Date, [retained]) { Name = "Keep" },
            ],
            Rules =
            [
                new(affected)
                {
                    FixedDate = Date,
                    FixedStart = new(9, 0),
                    MustDo = true,
                },
                new(retained) { FixedDate = Date, FixedStart = new(11, 0) },
                new(unassigned) { FixedDate = Date, FixedStart = new(12, 0) },
            ],
            TransportOverrides =
            [
                new(Date, null, affected, "walking", TimeSpan.Zero),
                new(Date, null, retained, "walking", TimeSpan.Zero),
            ],
        };
        var invalidated = ActivityPlanRules.InvalidateVisitSchedule(plan, first);
        Assert.HasCount(1, invalidated.Days);
        Assert.AreEqual(plan.Days[1], invalidated.Days[0]);
        Assert.IsNull(invalidated.Rules[0].FixedDate);
        Assert.IsNull(invalidated.Rules[0].FixedStart);
        Assert.IsTrue(invalidated.Rules[0].MustDo);
        Assert.AreEqual(plan.Rules[1], invalidated.Rules[1]);
        Assert.IsNull(invalidated.Rules[2].FixedDate);
        Assert.IsNull(invalidated.Rules[2].FixedStart);
        CollectionAssert.AreEqual(
            new[] { plan.TransportOverrides[1] },
            invalidated.TransportOverrides
        );
    }

    [TestMethod]
    [DataRow(null, "Europe/Paris")]
    [DataRow("", "Europe/Paris")]
    [DataRow("   ", "Europe/Paris")]
    [DataRow("Asia/Seoul", "Asia/Seoul")]
    public void MissingPlanTimezoneUsesTheCityZone(string? supplied, string expected)
    {
        var context = Context();
        var plan = Plan(context) with { TimeZone = supplied };
        Assert.AreEqual(expected, ActivityPlanRules.EffectiveTimeZone(plan, context));
    }

    [TestMethod]
    public void RepeatVisits_AllowOneOccurrenceAndRetainUnscheduledSelections()
    {
        var s = Context(TimeSpan.FromMinutes(90));
        var second = s.Visits[0] with
        {
            StayId = Guid.NewGuid(),
            Order = 1,
            ArrivalDate = Date.AddDays(5),
            DepartureDate = Date.AddDays(5),
        };
        s = s with
        {
            Visits = [s.Visits[0], second],
            Activities =
            [
                s.Activities[0] with
                {
                    Properties = s.Activities[0].Properties with { State = ActivityState.Yes },
                },
            ],
        };
        var initial = ActivityPlanRules.Initial(s);
        Assert.HasCount(1, initial.SelectedActivityIds);
        Assert.IsEmpty(initial.Days.SelectMany(d => d.ActivityIds));
        var duplicate = initial with
        {
            Days = initial
                .Days.Select(d => d with { ActivityIds = initial.SelectedActivityIds })
                .ToArray(),
        };
        Assert.IsTrue(ActivityPlanRules.Validate(duplicate, s).ContainsKey("days"));
    }

    [TestMethod]
    [DataRow(-1, 0, 0, false)]
    [DataRow(1, 0, 1, false)]
    [DataRow(0, 1, 2, false)]
    [DataRow(0, 1, 1, true)]
    public void ManualMealPositions_ValidateOrderAndActivityCount(
        int breakfast,
        int lunch,
        int dinner,
        bool valid
    )
    {
        var context = Context(TimeSpan.FromHours(1));
        var plan = Plan(context);
        plan = plan with
        {
            Days = [plan.Days[0] with { MealPositions = new(breakfast, lunch, dinner) }],
        };
        Assert.AreEqual(
            !valid,
            ActivityPlanRules.Validate(plan, context).ContainsKey("mealPositions")
        );
    }
}
