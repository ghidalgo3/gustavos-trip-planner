using TripPlanner.Api.Models;
using TripPlanner.Api.Services.ActivityPlanning;
using static TripPlanner.Api.Tests.Support.ActivityPlanningFixture;

namespace TripPlanner.Api.Tests.Services.ActivityPlanning;

[TestClass]
public sealed class ActivityPlanRulesTests
{
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
                    Properties = s.Activities[0].Properties with { State = ActivityState.Planned },
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
}
