using System.Text.Json;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Flights;

namespace TripPlanner.Api.Tests.Services.Flights;

[TestClass]
public sealed class SavedFlightChoicesTests
{
    [TestMethod]
    [DataRow(false)]
    [DataRow(true)]
    public void InsertingStopPreservesUnchangedFlightsAndRetainsDisplacedFlightForReview(
        bool stableIds
    )
    {
        var (document, choice) = Route(stableIds);
        var hiroshima = new PlannedVisit
        {
            Id = Guid.NewGuid(),
            Location = new AirportCatalog().Resolve("HIJ"),
        };
        var changed = document with
        {
            Visits = [.. document.Visits[..3], hiroshima, document.Visits[3]],
        };
        var reconciled = SavedFlightChoices.Reconcile(choice, changed, new());
        CollectionAssert.AreEqual(
            new string?[]
            {
                choice.LegKeys[0],
                choice.LegKeys[1],
                choice.LegKeys[2],
                null,
                null,
                choice.LegKeys[4],
            },
            reconciled.LegKeys
        );
        CollectionAssert.AreEqual(new[] { choice.LegKeys[3] }, reconciled.UnmatchedLegKeys);
        Assert.HasCount(1, SavedFlightChoices.UnmatchedFlights(reconciled));
        Assert.AreEqual(5, SavedFlightChoices.SelectedLegs(reconciled).Last().LegIndex);
        CollectionAssert.AreEqual(choice.PurchasedOfferIds, reconciled.PurchasedOfferIds);
        CollectionAssert.AreEqual(
            choice.LegKeys,
            SavedFlightChoices.Reconcile(reconciled, document, new()).LegKeys
        );
        // Reconciliation must not mutate the stored selection or its retained offers.
        Assert.HasCount(5, choice.LegKeys);
        Assert.HasCount(5, reconciled.SavedFares);
    }

    [TestMethod]
    [DataRow(false)]
    [DataRow(true)]
    public void RemovingOrReorderingStopsCannotAttachFlightsToTheWrongCity(bool reorder)
    {
        var (document, choice) = Route(true);
        var changed = document with
        {
            Visits = reorder
                ? [document.Visits[0], document.Visits[2], document.Visits[1], document.Visits[3]]
                : [document.Visits[0], document.Visits[2], document.Visits[3]],
        };
        var reconciled = SavedFlightChoices.Reconcile(choice, changed, new());
        Assert.AreEqual(choice.LegKeys[0], reconciled.LegKeys[0]);
        Assert.AreEqual(choice.LegKeys[4], reconciled.LegKeys[^1]);
        Assert.IsNull(reconciled.LegKeys[1]);
        if (reorder)
        {
            Assert.IsNull(reconciled.LegKeys[2]);
        }
        else
        {
            Assert.AreEqual(choice.LegKeys[3], reconciled.LegKeys[2]);
        }
        Assert.HasCount(reorder ? 3 : 2, reconciled.UnmatchedLegKeys);
    }

    [TestMethod]
    public void NewVisitInTheSameCityDoesNotInheritTheDeletedVisitsSelection()
    {
        var (document, choice) = Route(true);
        var changed = document with
        {
            Visits = [document.Visits[0] with { Id = Guid.NewGuid() }, .. document.Visits[1..]],
        };
        var reconciled = SavedFlightChoices.Reconcile(choice, changed, new());
        Assert.IsNull(reconciled.LegKeys[0]);
        Assert.IsNull(reconciled.LegKeys[1]);
        Assert.HasCount(2, reconciled.UnmatchedLegKeys);
    }

    [TestMethod]
    public void LegacyRepeatRoutesUseFlightDatesAndAmbiguousRoutesRequireReview()
    {
        var (document, choice) = Route(false);
        var repeated = document with
        {
            Visits =
            [
                document.Visits[0],
                document.Visits[1],
                document.Visits[0] with
                {
                    Id = Guid.NewGuid(),
                },
                document.Visits[1] with
                {
                    Id = Guid.NewGuid(),
                },
                .. document.Visits[2..],
            ],
        };
        // Without dates the two Tokyo-to-Seoul edges are ambiguous: never guess a position.
        var ambiguous = SavedFlightChoices.Reconcile(choice, repeated, new());
        Assert.Contains(choice.LegKeys[1]!, ambiguous.UnmatchedLegKeys);
        var dated = repeated with
        {
            Visits = repeated
                .Visits.Select(
                    (visit, index) =>
                        index == 1
                            ? visit with
                            {
                                PresentFrom = new(2030, 5, 2),
                                ArrivalFlexibilityDays = 0,
                            }
                        : index == 3
                            ? visit with
                            {
                                PresentFrom = new(2030, 6, 2),
                                ArrivalFlexibilityDays = 0,
                            }
                        : visit
                )
                .ToArray(),
        };
        var matched = SavedFlightChoices.Reconcile(choice, dated, new());
        Assert.AreEqual(choice.LegKeys[1], matched.LegKeys[1]);
        Assert.IsNull(matched.LegKeys[3]);
    }

    [TestMethod]
    [DataRow(0, true)]
    [DataRow(1, false)]
    public void DateChangesKeepFlightsOnlyWithinTheVisitsFlexibility(int flexibility, bool review)
    {
        var (document, choice) = Route(true);
        var changed = document with
        {
            Visits =
            [
                .. document.Visits[..3],
                document.Visits[3] with
                {
                    PresentThrough = new(2030, 5, 6),
                    DepartureFlexibilityDays = flexibility,
                },
            ],
        };
        var reconciled = SavedFlightChoices.Reconcile(choice, changed, new());
        Assert.AreEqual(review, reconciled.UnmatchedLegKeys.Contains(choice.LegKeys[4]));
        if (!review)
        {
            Assert.AreEqual(choice.LegKeys[4], reconciled.LegKeys[4]);
        }
    }

    private static (PlanningDocument Document, FlightChoiceProgress Choice) Route(bool stableIds)
    {
        var airports = new AirportCatalog();
        var party = Guid.NewGuid();
        var document = new PlanningDocument
        {
            Visits = new[] { "HND", "ICN", "CTS", "HND" }
                .Select(code => new PlannedVisit
                {
                    Id = Guid.NewGuid(),
                    Location = airports.Resolve(code),
                })
                .ToArray(),
            Parties = [new() { PartyId = party, Origin = airports.Resolve("ATL") }],
        };
        var codes = new[] { "ATL", "HND", "ICN", "CTS", "HND", "ATL" };
        var fares = Enumerable
            .Range(0, 5)
            .Select(index => new FareSearchResult(
                party,
                $"cache-{index}",
                new(
                    codes[index],
                    codes[index + 1],
                    new(2030, 5, index + 1),
                    new(2030, 5, index + 1),
                    1,
                    "economy",
                    "US",
                    null,
                    "oneWay"
                ),
                JsonSerializer.SerializeToElement(
                    new
                    {
                        itineraries = new[]
                        {
                            new
                            {
                                outbound = new
                                {
                                    segments = new[]
                                    {
                                        new
                                        {
                                            departure_airport = codes[index],
                                            arrival_airport = codes[index + 1],
                                            flight_number = $"flight-{index}",
                                            departure_time_local = $"2030-05-{index + 1:00}T09:00:00",
                                            arrival_time_local = $"2030-05-{index + 1:00}T12:00:00",
                                        },
                                    },
                                },
                            },
                        },
                    }
                ),
                DateTimeOffset.UtcNow.AddHours(-2),
                DateTimeOffset.UtcNow.AddHours(-1)
            ))
            .ToArray();
        var keys = fares
            .Select(fare =>
                FlightChoiceRoute.FlightKey(
                    fare.Response.GetProperty("itineraries")[0].GetProperty("outbound")
                )
            )
            .ToArray();
        return (
            document,
            new(party, keys, [])
            {
                SavedFares = fares,
                LegRoutes = stableIds ? SavedFlightChoices.Bind(document, keys) : null,
                PurchasedOfferIds = ["booked-return"],
            }
        );
    }

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
