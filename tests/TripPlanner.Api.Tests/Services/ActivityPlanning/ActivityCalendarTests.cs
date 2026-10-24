using TripPlanner.Api.Models;
using TripPlanner.Api.Services.ActivityPlanning;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Services.ActivityPlanning;

[TestClass]
public sealed class ActivityCalendarTests
{
    [TestMethod]
    public void Calendar_StableIdentity_Revision_Removals_AndUtf8Folding()
    {
        var planningContext = ActivityPlanningFixture.Context(TimeSpan.FromHours(1));
        var plan = ActivityPlanningFixture.Plan(planningContext);
        planningContext = planningContext with
        {
            Activities =
            [
                planningContext.Activities[0] with
                {
                    Properties = planningContext.Activities[0].Properties with
                    {
                        State = ActivityState.Planned,
                        Name = new string('é', 80) + ", museum; visit\nTomorrow",
                    },
                },
            ],
        };
        var saved = new StoredActivityPlan(
            plan,
            planningContext.Evaluate(plan, ActivityPlanningFixture.Now),
            1,
            1,
            ActivityPlanningFixture.Now
        );
        string first = ActivityCalendar.Render(
            planningContext.Trip,
            [(saved, planningContext.Activities, planningContext.Visits)]
        );
        var updatedPlan = plan with
        {
            Rules = [plan.Rules[0] with { FixedStart = new TimeOnly(10, 0) }],
        };
        string second = ActivityCalendar.Render(
            planningContext.Trip,
            [
                (
                    saved with
                    {
                        Plan = updatedPlan,
                        Version = 2,
                        Assessment = planningContext.Evaluate(
                            updatedPlan,
                            ActivityPlanningFixture.Now
                        ),
                    },
                    planningContext.Activities,
                    planningContext.Visits
                ),
            ]
        );
        string Uid(string text) => text.Split("\r\n").Single(line => line.StartsWith("UID:"));
        Assert.AreEqual(Uid(first), Uid(second));
        StringAssert.Contains(second, "SEQUENCE:2");
        StringAssert.Contains(second, "DTSTART:20270610T080000Z");
        Assert.IsTrue(
            first.Split("\r\n").All(line => System.Text.Encoding.UTF8.GetByteCount(line) <= 75)
        );
        StringAssert.Contains(first.Replace("\r\n ", ""), "\\, museum\\; visit\\nTomorrow");
        Assert.DoesNotContain(
            "BEGIN:VEVENT",
            ActivityCalendar.Render(planningContext.Trip, [(saved, [], planningContext.Visits)])
        );
        Assert.DoesNotContain(
            "BEGIN:VEVENT",
            ActivityCalendar.Render(planningContext.Trip, [(saved, planningContext.Activities, [])])
        );
    }
}
