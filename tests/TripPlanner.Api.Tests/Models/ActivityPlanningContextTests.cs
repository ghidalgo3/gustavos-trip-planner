using TripPlanner.Api.Models;
using static TripPlanner.Api.Tests.Support.ActivityPlanningFixture;

namespace TripPlanner.Api.Tests.Models;

[TestClass]
public sealed class ActivityPlanningContextTests
{
    [TestMethod]
    public void RepeatVisits_UseTheirOwnAccommodationForBothTravelDirections()
    {
        var context = Context(TimeSpan.FromHours(1));
        var first = context.Visits[0];
        var second = first with
        {
            StayId = Guid.NewGuid(),
            Order = 1,
            ArrivalDate = Date.AddDays(2),
            DepartureDate = Date.AddDays(2),
        };
        var hotel = context.StayLocations[first.StayId];
        var otherHotel = hotel with
        {
            Geometry = new("Point", Microsoft.Spatial.GeographyPoint.Create(48.90, 2.40)),
            Properties = new("Other hotel"),
        };
        context = context with
        {
            Visits = [first, second],
            StayLocations = new Dictionary<Guid, GeoJsonFeature<StayLocationProperties>>
            {
                [first.StayId] = hotel,
                [second.StayId] = otherHotel,
            },
        };
        var plan = Plan(context) with { TransportOverrides = [] };
        var departure = Now;
        var activity = context.Activities[0];
        var evidence = new List<ActivityRouteEvidence>();
        foreach (var (stay, minutes) in new[] { (hotel, 10), (otherHotel, 40) })
        {
            foreach (bool returning in new[] { false, true })
            {
                var from = returning ? activity.Geometry!.Position : stay.Geometry!.Position;
                var to = returning ? stay.Geometry!.Position : activity.Geometry!.Position;
                evidence.Add(
                    new(
                        ActivityPlanningContext.RouteKey(from, to, departure, "walking"),
                        "walking",
                        TimeSpan.FromMinutes(minutes),
                        Now,
                        Now.AddHours(1),
                        stay.Properties.Name
                    )
                );
            }
        }
        context = context with { Evidence = new() { Routes = evidence.ToArray() } };
        foreach (var (visit, expected) in new[] { (first, 10), (second, 40) })
        {
            var day = plan.Days[0] with { StayId = visit.StayId, Date = visit.ArrivalDate!.Value };
            Assert.AreEqual(
                TimeSpan.FromMinutes(expected),
                context.Travel(plan, day, null, activity.Id, departure, Now).Duration
            );
            Assert.AreEqual(
                TimeSpan.FromMinutes(expected),
                context.Travel(plan, day, activity.Id, null, departure, Now).Duration
            );
        }
        context = context with
        {
            StayLocations = new Dictionary<Guid, GeoJsonFeature<StayLocationProperties>>
            {
                [first.StayId] = hotel,
            },
        };
        var withoutStay = plan.Days[0] with
        {
            StayId = second.StayId,
            Date = second.ArrivalDate!.Value,
        };
        Assert.AreEqual(
            TimeSpan.Zero,
            context.Travel(plan, withoutStay, null, activity.Id, departure, Now).Duration
        );
        Assert.AreEqual(
            TimeSpan.Zero,
            context.Travel(plan, withoutStay, activity.Id, null, departure, Now).Duration
        );
        Assert.AreEqual(
            TimeSpan.FromMinutes(10),
            context.Travel(plan, plan.Days[0], null, activity.Id, departure, Now).Duration
        );
    }

    [TestMethod]
    public void WithoutStay_OnlyCountsTravelBetweenActivities_AndKeepsUnknownLocationsEstimated()
    {
        var original = Context(TimeSpan.FromHours(1), TimeSpan.FromHours(1));
        var context = original with
        {
            StayLocations = new Dictionary<Guid, GeoJsonFeature<StayLocationProperties>>(),
            Activities = [original.Activities[0], original.Activities[1] with { Geometry = null }],
        };
        var plan = Plan(context) with { TransportOverrides = [] };
        var result = context.Evaluate(plan, Now);
        var day = result.Days.Single();
        Assert.HasCount(1, day.Travel);
        Assert.AreEqual(context.Activities[0].Id, day.Travel[0].FromActivityId);
        Assert.AreEqual(context.Activities[1].Id, day.Travel[0].ToActivityId);
        Assert.AreEqual(TimeSpan.FromMinutes(20), day.TravelDuration);
        Assert.IsTrue(day.Travel[0].Provisional);
        Assert.AreEqual(day.Breaks.Single(b => b.Name == "breakfast").End, day.Entries[0].Start);
        Assert.IsTrue(day.Entries[^1].Start >= day.Breaks.Single(b => b.Name == "dinner").End);
        Assert.AreEqual(TimeSpan.FromHours(2), day.MealDuration);
        Assert.AreEqual(TimeSpan.FromHours(8), day.RestDuration);
        Assert.AreEqual(TimeSpan.FromHours(1), day.RequiredSlackDuration);
        Assert.IsFalse(result.Issues.Any(i => i.Code == "return_travel_estimated"));

        var withStay = (context with { StayLocations = original.StayLocations }).Evaluate(
            plan,
            Now
        );
        Assert.HasCount(3, withStay.Days.Single().Travel);
        Assert.IsGreaterThan(day.TravelDuration, withStay.TravelDuration);
    }

    [TestMethod]
    public void WithoutStay_FixedBookingBeforeDinnerRemainsVisibleAsAConflict()
    {
        var context = Context(TimeSpan.FromHours(1)) with
        {
            StayLocations = new Dictionary<Guid, GeoJsonFeature<StayLocationProperties>>(),
        };
        var plan = Plan(context);
        plan = plan with { Rules = [plan.Rules[0] with { FixedStart = new TimeOnly(17, 0) }] };
        var result = context.Evaluate(plan, Now);
        Assert.IsTrue(result.Issues.Any(i => i.Code == "late_for_anchor"));
        Assert.AreEqual(
            new TimeOnly(17, 0),
            TimeOnly.FromDateTime(result.Days.Single().Entries.Single().Start!.Value.DateTime)
        );
    }

    [TestMethod]
    public void WithoutStay_DiningActivityDoesNotDoubleCountDinner()
    {
        var context = Context(TimeSpan.FromHours(1), TimeSpan.FromHours(1)) with
        {
            StayLocations = new Dictionary<Guid, GeoJsonFeature<StayLocationProperties>>(),
        };
        var plan = Plan(context);
        plan = plan with
        {
            Rules =
            [
                plan.Rules[0] with
                {
                    CoversMeal = "dinner",
                    FixedStart = new TimeOnly(19, 0),
                },
                plan.Rules[1],
            ],
        };
        var result = context.Evaluate(plan, Now);
        var day = result.Days.Single();
        Assert.AreEqual(0, result.ConflictCount);
        Assert.AreEqual(TimeSpan.FromMinutes(75), day.MealDuration);
        Assert.IsFalse(day.Breaks.Any(b => b.Name == "dinner"));
        Assert.IsTrue(day.Entries[^1].Start >= day.Entries[0].End);
    }

    [TestMethod]
    [DataRow(0, 1, 1, 1, 7, 0)]
    [DataRow(1, 0, 1, 1, 7, 30)]
    [DataRow(2, 0, 0, 1, 13, 45)]
    [DataRow(3, 0, 0, 0, 19, 45)]
    public void ManualMealPositions_CalculateSingleActivityStart(
        int mealsBefore,
        int breakfast,
        int lunch,
        int dinner,
        int hour,
        int minute
    )
    {
        var context = Context(TimeSpan.FromHours(3)) with
        {
            StayLocations = new Dictionary<Guid, GeoJsonFeature<StayLocationProperties>>(),
        };
        var plan = Plan(context);
        plan = plan with
        {
            Days = [plan.Days[0] with { MealPositions = new(breakfast, lunch, dinner) }],
        };
        var result = context.Evaluate(plan, Now);
        var day = result.Days.Single();
        var entry = day.Entries.Single();
        Assert.AreEqual(
            new TimeOnly(hour, minute),
            TimeOnly.FromDateTime(entry.Start!.Value.DateTime)
        );
        Assert.AreEqual(TimeSpan.FromHours(3), entry.End - entry.Start);
        Assert.AreEqual(mealsBefore, day.Breaks.Count(b => b.End <= entry.Start));
        Assert.IsFalse(plan.Rules.Any(r => r.FixedStart is not null));
        Assert.AreEqual(TimeSpan.FromHours(11), day.SlackDuration);
        Assert.AreEqual(TimeSpan.Zero, day.OverrunDuration);
    }

    [TestMethod]
    public void ManualMealPositions_IncludeTravelAndOpeningHoursInCalculatedStart()
    {
        var context = Context(TimeSpan.FromHours(1));
        var plan = Plan(context);
        plan = plan with
        {
            Days = [plan.Days[0] with { MealPositions = new(0, 1, 1) }],
            TransportOverrides = plan
                .TransportOverrides.Select(t => t with { Duration = TimeSpan.FromMinutes(20) })
                .ToArray(),
            Rules = [plan.Rules[0] with { OpeningWindows = [new(Date, new(10, 0), new(17, 0))] }],
        };
        var day = context.Evaluate(plan, Now).Days.Single();
        Assert.AreEqual(
            new TimeOnly(10, 0),
            TimeOnly.FromDateTime(day.Entries.Single().Start!.Value.DateTime)
        );
        Assert.AreEqual(TimeSpan.FromMinutes(40), day.TravelDuration);
        Assert.IsTrue(day.Breaks.Single(b => b.Name == "lunch").Start >= day.Entries.Single().End);
    }

    [TestMethod]
    public void FreeTime_IncludesMorningAndEveningGapsAroundMeals()
    {
        var context = Context(TimeSpan.FromHours(3));
        var plan = Plan(context);
        plan = plan with
        {
            Days = [plan.Days[0] with { MealPositions = new(0, 0, 1) }],
            TransportOverrides = plan
                .TransportOverrides.Select(t => t with { Duration = TimeSpan.FromMinutes(39) })
                .ToArray(),
        };
        var day = context.Evaluate(plan, Now).Days.Single();
        Assert.AreEqual(
            new TimeOnly(14, 24),
            TimeOnly.FromDateTime(day.Entries.Single().Start!.Value.DateTime)
        );
        Assert.AreEqual(
            new TimeOnly(19, 0),
            TimeOnly.FromDateTime(day.Breaks.Single(b => b.Name == "dinner").Start!.Value.DateTime)
        );
        Assert.AreEqual(TimeSpan.FromMinutes(387), day.WaitingDuration);
        Assert.AreEqual(TimeSpan.FromMinutes(582), day.SlackDuration);
        Assert.AreEqual(TimeSpan.FromMinutes(522), day.SlackDuration - day.RequiredSlackDuration);
        Assert.AreEqual(TimeSpan.Zero, day.OverrunDuration);
    }

    [TestMethod]
    [DataRow("meal")]
    [DataRow("booking")]
    [DataRow("opening")]
    public void FreeTime_IncludesGapsBeforeScheduledItems(string gap)
    {
        var context = Context(TimeSpan.FromHours(1));
        var plan = Plan(context);
        plan = plan with
        {
            Days = [plan.Days[0] with { MealPositions = new(0, gap == "booking" ? 0 : 1, 1) }],
            Rules =
            [
                plan.Rules[0] with
                {
                    FixedStart = gap == "booking" ? new TimeOnly(14, 0) : null,
                    OpeningWindows = gap == "opening" ? [new(Date, new(14, 0), new(16, 0))] : [],
                },
            ],
        };
        var day = context.Evaluate(plan, Now).Days.Single();
        Assert.IsTrue(day.WaitingDuration > TimeSpan.Zero);
        Assert.AreEqual(TimeSpan.FromHours(13), day.SlackDuration);
        Assert.AreEqual(TimeSpan.FromHours(12), day.SlackDuration - day.RequiredSlackDuration);
        Assert.AreEqual(TimeSpan.Zero, day.OverrunDuration);
    }

    [TestMethod]
    public void FreeTime_StillReportsActivityFinishingAfterBedtime()
    {
        var context = Context(TimeSpan.FromHours(4));
        var plan = Plan(context);
        plan = plan with { Days = [plan.Days[0] with { MealPositions = new(0, 0, 0) }] };
        var day = context.Evaluate(plan, Now).Days.Single();
        Assert.AreEqual(TimeSpan.FromHours(10), day.SlackDuration);
        Assert.AreEqual(TimeSpan.FromMinutes(45), day.OverrunDuration);
    }

    [TestMethod]
    [DataRow("fastest", 5, 12, "walking", 5)]
    [DataRow("fastest", 20, 6, "driving", 6)]
    [DataRow("walking", 20, 6, "driving", 6)]
    [DataRow("fastest", 6, 6, "walking", 6)]
    public void AutomaticTravel_UsesShortestWalkingOrDrivingTime(
        string setting,
        int walking,
        int driving,
        string expectedMode,
        int expectedMinutes
    )
    {
        var context = Context(TimeSpan.FromHours(1));
        var plan = Plan(context) with { TransportOverrides = [] };
        plan = plan with { Settings = plan.Settings with { TransportMode = setting } };
        var from = context.StayLocations[plan.Days[0].StayId].Geometry!.Position;
        var to = context.Activities[0].Geometry!.Position;
        context = context with
        {
            Evidence = new()
            {
                Routes = new[] { ("walking", walking), ("driving", driving) }
                    .Select(r => new ActivityRouteEvidence(
                        ActivityPlanningContext.RouteKey(from, to, Now, r.Item1),
                        r.Item1,
                        TimeSpan.FromMinutes(r.Item2),
                        Now,
                        Now.AddHours(1),
                        "Verified route",
                        PreferenceScore: r.Item1 == "walking" ? 5 : 1
                    ))
                    .ToArray(),
            },
        };
        var travel = context.Travel(plan, plan.Days[0], null, context.Activities[0].Id, Now, Now);
        Assert.AreEqual(expectedMode, travel.Mode);
        Assert.AreEqual(TimeSpan.FromMinutes(expectedMinutes), travel.Duration);
        Assert.IsFalse(travel.Provisional);
    }

    [TestMethod]
    [DataRow("walking", null, 20)]
    [DataRow("driving", null, 6)]
    [DataRow("walking", 9, 9)]
    public void AutomaticTravel_PreservesExplicitLegChoicesAndDurations(
        string mode,
        int? supplied,
        int expectedMinutes
    )
    {
        var context = Context(TimeSpan.FromHours(1));
        var plan = Plan(context);
        var day = plan.Days[0];
        var id = context.Activities[0].Id;
        var from = context.StayLocations[day.StayId].Geometry!.Position;
        var to = context.Activities[0].Geometry!.Position;
        context = context with
        {
            Evidence = new()
            {
                Routes = new[] { ("walking", 20), ("driving", 6) }
                    .Select(r => new ActivityRouteEvidence(
                        ActivityPlanningContext.RouteKey(from, to, Now, r.Item1),
                        r.Item1,
                        TimeSpan.FromMinutes(r.Item2),
                        Now,
                        Now.AddHours(1),
                        "Verified route"
                    ))
                    .ToArray(),
            },
        };
        plan = plan with
        {
            TransportOverrides =
            [
                new(
                    day.Date,
                    null,
                    id,
                    mode,
                    supplied is { } minutes ? TimeSpan.FromMinutes(minutes) : null
                ),
            ],
        };
        var travel = context.Travel(plan, day, null, id, Now, Now);
        Assert.AreEqual(mode, travel.Mode);
        Assert.AreEqual(TimeSpan.FromMinutes(expectedMinutes), travel.Duration);
    }

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
