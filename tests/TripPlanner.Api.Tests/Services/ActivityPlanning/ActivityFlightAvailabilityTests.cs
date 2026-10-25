using System.Text.Json;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.ActivityPlanning;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Services.ActivityPlanning;

[TestClass]
public sealed class ActivityFlightAvailabilityTests
{
    [TestMethod]
    public void FlightAvailability_UsesLatestArrivalAndEarliestDeparture_ForAllTravellers()
    {
        var s = ActivityPlanningFixture.Context(TimeSpan.FromHours(1));
        var second = s.Travellers[0] with { Id = Guid.NewGuid(), DisplayName = "Second traveller" };
        var party = new Party(Guid.NewGuid(), s.Trip.Id, [second.Id]);
        SelectedFlight Flight(Guid partyId, int arrivalHour, int departureHour) =>
            new(
                s.Trip.Id,
                partyId,
                "key",
                0,
                new(
                    "BOS",
                    "CDG",
                    ActivityPlanningFixture.Date,
                    ActivityPlanningFixture.Date,
                    1,
                    "economy",
                    "US",
                    null
                ),
                JsonSerializer.SerializeToElement(
                    new
                    {
                        outbound = new
                        {
                            segments = new[]
                            {
                                new
                                {
                                    departure_airport = "BOS",
                                    arrival_airport = "CDG",
                                    arrival_time_utc = $"2027-06-10T{arrivalHour:00}:00:00Z",
                                },
                            },
                        },
                        inbound = new
                        {
                            segments = new[]
                            {
                                new
                                {
                                    departure_airport = "CDG",
                                    arrival_airport = "BOS",
                                    departure_time_utc = $"2027-06-10T{departureHour:00}:00:00Z",
                                },
                            },
                        },
                    }
                ),
                ActivityPlanningFixture.Now
            );
        s = s with
        {
            Travellers = [s.Travellers[0], second],
            Parties = [s.Parties[0], party],
            Flights = [Flight(s.Parties[0].Id, 9, 18), Flight(party.Id, 10, 16)],
        };
        var suggestion = new ActivityFlightAvailability(new())
            .Suggest(s, ActivityPlanningFixture.Plan(s))
            .Single();
        Assert.IsFalse(suggestion.Ambiguous);
        Assert.AreEqual(new TimeOnly(14, 0), suggestion.AvailableFrom);
        Assert.AreEqual(new TimeOnly(15, 0), suggestion.AvailableUntil);
        var ambiguous = s with { Flights = [.. s.Flights, Flight(s.Parties[0].Id, 8, 18)] };
        var plan = ActivityPlanningFixture.Plan(ambiguous);
        var matches = new ActivityFlightAvailability(new()).Suggest(ambiguous, plan).Single();
        Assert.IsTrue(matches.Ambiguous);
        Assert.IsNotNull(matches.AvailableFromInstant);
        Assert.IsNotNull(matches.AvailableUntilInstant);
        var choice = matches.Candidates.First(c =>
            c.TravellerId == s.Travellers[0].Id && c.Direction == "arrival"
        );
        plan = plan with
        {
            Days =
            [
                plan.Days[0] with
                {
                    FlightMatches = [new(choice.TravellerId, choice.Direction, choice.Id)],
                },
            ],
        };
        matches = new ActivityFlightAvailability(new()).Suggest(ambiguous, plan).Single();
        Assert.IsFalse(matches.Ambiguous);
        Assert.AreEqual(new TimeOnly(14, 0), matches.AvailableFrom);
        s = s with { Flights = [s.Flights[0]] };
        suggestion = new ActivityFlightAvailability(new())
            .Suggest(s, ActivityPlanningFixture.Plan(s))
            .Single();
        Assert.IsTrue(suggestion.Ambiguous);
        Assert.IsNull(suggestion.AvailableFrom);
    }

    [TestMethod]
    [DataRow(11, 0, true)]
    [DataRow(16, 30, true)]
    [DataRow(14, 0, false)]
    public void SelectedFlights_EnforceAirportBuffersEvenWithManualAvailability(
        int hour,
        int minute,
        bool conflict
    )
    {
        var context = ActivityPlanningFixture.WithFlights(
            ActivityPlanningFixture.Context(TimeSpan.FromHours(1))
        );
        var plan = ActivityPlanningFixture.Plan(context);
        plan = plan with
        {
            Days =
            [
                plan.Days[0] with
                {
                    AvailableFrom = new(7, 0),
                    AvailableUntil = new(23, 0),
                    MealPositions = new(0, 0, 1),
                },
            ],
            Rules = [plan.Rules[0] with { FixedStart = new(hour, minute) }],
        };
        var result = context.Evaluate(plan, ActivityPlanningFixture.Now);
        Assert.AreEqual(conflict, result.Issues.Any(i => i.Code == "flight_unavailable"));
        var day = result.Days.Single();
        Assert.AreEqual(TimeSpan.FromHours(5), day.AvailableDuration);
        Assert.AreEqual(TimeSpan.FromMinutes(45), day.MealDuration);
        var window = day.FlightAvailability!;
        Assert.AreEqual(12, window.AvailableFromInstant!.Value.Hour);
        Assert.AreEqual(17, window.AvailableUntilInstant!.Value.Hour);
        Assert.AreEqual(2, window.Candidates.Count(c => c.Selected));
        Assert.AreEqual(0, window.Candidates.First().Departure!.Value.Hour);
        Assert.AreEqual(10, window.Candidates.First().Arrival!.Value.Hour);
    }

    [TestMethod]
    public void AirportBuffers_CrossMidnightAndRestrictThePreviousVisitDay()
    {
        var context = ActivityPlanningFixture.WithFlights(
            ActivityPlanningFixture.Context(TimeSpan.FromHours(1))
        );
        context = context with
        {
            Visits =
            [
                context.Visits[0] with
                {
                    ArrivalDate = ActivityPlanningFixture.Date.AddDays(-1),
                },
            ],
            FlightLegs =
            [
                context.FlightLegs.Single(l => l.DepartsDestination) with
                {
                    Departure = new DateTimeOffset(2027, 6, 10, 1, 0, 0, TimeSpan.FromHours(2)),
                },
            ],
        };
        var plan = ActivityPlanningFixture.Plan(context);
        plan = plan with
        {
            Days =
            [
                plan.Days[0] with
                {
                    Date = ActivityPlanningFixture.Date.AddDays(-1),
                    MealPositions = new(0, 0, 1),
                },
            ],
            Rules = [plan.Rules[0] with { FixedStart = new(22, 0) }],
        };
        var result = context.Evaluate(plan, ActivityPlanningFixture.Now);
        Assert.IsTrue(result.Issues.Any(i => i.Code == "flight_unavailable"));
        Assert.AreEqual(
            new TimeOnly(22, 0),
            TimeOnly.FromDateTime(
                result.Days.Single().FlightAvailability!.AvailableUntilInstant!.Value.DateTime
            )
        );
    }

    [TestMethod]
    public void UnmatchedCandidateCannotRemoveFlightRestrictions()
    {
        var context = ActivityPlanningFixture.WithFlights(
            ActivityPlanningFixture.Context(TimeSpan.FromHours(1))
        );
        var plan = ActivityPlanningFixture.Plan(context);
        plan = plan with
        {
            Days =
            [
                plan.Days[0] with
                {
                    FlightMatches = [new(context.Travellers[0].Id, "arrival", new string('a', 64))],
                },
            ],
        };
        Assert.IsTrue(ActivityPlanRules.Validate(plan, context).ContainsKey("flightMatches"));
    }

    [TestMethod]
    public void EmptyFlightBlockedDayHasNoCapacityWarning()
    {
        var context = ActivityPlanningFixture.WithFlights(
            ActivityPlanningFixture.Context(TimeSpan.FromHours(1))
        );
        context = context with
        {
            FlightLegs =
            [
                context.FlightLegs.Single(l => l.DepartsDestination) with
                {
                    Departure = new DateTimeOffset(2027, 6, 10, 1, 0, 0, TimeSpan.FromHours(2)),
                },
            ],
        };
        var plan = ActivityPlanningFixture.Plan(context);
        plan = plan with
        {
            SelectedActivityIds = [],
            Days = [plan.Days[0] with { ActivityIds = [] }],
        };
        var day = context.Evaluate(plan, ActivityPlanningFixture.Now).Days.Single();
        Assert.AreEqual(TimeSpan.Zero, day.AvailableDuration);
        Assert.AreEqual(TimeSpan.Zero, day.OverrunDuration);
    }
}
