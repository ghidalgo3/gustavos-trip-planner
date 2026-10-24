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
}
