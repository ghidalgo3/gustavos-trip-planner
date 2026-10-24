using System.Text.Json;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Flights;

namespace TripPlanner.Api.Tests.Services.Flights;

[TestClass]
public sealed class SavedFlightChoicesTests
{
    [TestMethod]
    [DataRow(0)]
    [DataRow(1)]
    public void OverviewExposesOnlyChosenLegsFromRetainedBundles(int selectedIndex)
    {
        var party = Guid.NewGuid();
        var legs = new[] { "outbound", "return" }
            .Select(number =>
                JsonSerializer.SerializeToElement(
                    new
                    {
                        segments = new[]
                        {
                            new
                            {
                                departure_airport = "JFK",
                                arrival_airport = "BOS",
                                flight_number = number,
                            },
                        },
                    }
                )
            )
            .ToArray();
        string?[] keys = [null, null];
        keys[selectedIndex] = FlightChoiceRoute.FlightKey(legs[selectedIndex]);
        var saved = new FlightChoiceProgress(party, keys, [])
        {
            SavedFares =
            [
                new(
                    party,
                    "expired",
                    new("JFK", "BOS", new(2030, 1, 1), new(2030, 1, 2), 1, "economy", "US", null),
                    JsonSerializer.SerializeToElement(new { itineraries = new[] { new { legs } } }),
                    DateTimeOffset.UtcNow.AddHours(-2),
                    DateTimeOffset.UtcNow.AddHours(-1)
                ),
            ],
        };
        var displayed = SavedFlightChoices.SelectedLegs(saved);
        Assert.HasCount(1, displayed);
        Assert.AreEqual(selectedIndex, displayed[0].LegIndex);
        Assert.AreEqual(keys[selectedIndex], FlightChoiceRoute.FlightKey(displayed[0].Leg));
        Assert.IsEmpty(SavedFlightChoices.SelectedLegs(saved with { LegKeys = [] }));
    }

    [TestMethod]
    [DataRow(false)]
    [DataRow(true)]
    public void SharedSearchesRemainUntilEveryVisitTheyServeHasASelectedFlight(bool bothSelected)
    {
        var partyId = Guid.NewGuid();
        var leg = JsonSerializer.SerializeToElement(
            new
            {
                segments = new[]
                {
                    new
                    {
                        departure_airport = "JFK",
                        arrival_airport = "BOS",
                        flight_number = "1",
                    },
                },
            }
        );
        var key = FlightChoiceRoute.FlightKey(leg)!;
        var body = new IgnavFareRequest(
            "JFK",
            "BOS",
            new(2030, 5, 1),
            new(2030, 5, 1),
            1,
            "economy",
            "US",
            null,
            "oneWay"
        );
        var shared = new PreparedSearch(body, "shared", 0) { LegIndexes = [1, 3] };
        var other = new PreparedSearch(body, "other", 0) { LegIndexes = [2] };
        var preview = new SearchPlanPreview(
            true,
            10,
            [],
            [new(partyId, 1, [shared, other], [], [])]
        );
        var choice = new FlightChoiceProgress(
            partyId,
            [null, key, null, bothSelected ? key : null],
            []
        )
        {
            SavedFares =
            [
                new(
                    partyId,
                    "shared",
                    body,
                    JsonSerializer.SerializeToElement(
                        new { itineraries = new[] { new { outbound = leg } } }
                    ),
                    DateTimeOffset.UtcNow,
                    DateTimeOffset.UtcNow
                ),
            ],
        };
        var remaining = SavedFlightChoices
            .RemainingSearches(preview, [choice])
            .Parties.Single()
            .Requests;
        Assert.AreEqual(!bothSelected, remaining.Any(request => request.CacheKey == "shared"));
        Assert.IsTrue(remaining.Any(request => request.CacheKey == "other"));
        // Old keys alone, and keys that moved to a different visit, cannot suppress new searches.
        Assert.HasCount(
            2,
            SavedFlightChoices
                .RemainingSearches(preview, [choice with { SavedFares = [] }])
                .Parties.Single()
                .Requests
        );
        Assert.HasCount(
            2,
            SavedFlightChoices
                .RemainingSearches(preview, [choice with { LegKeys = [null, null, key] }])
                .Parties.Single()
                .Requests
        );
    }
}
