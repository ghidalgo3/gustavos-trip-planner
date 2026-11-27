using System.Text.Json;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Flights;

namespace TripPlanner.Api.Tests.Services.Flights;

[TestClass]
public sealed class RoundTripGridTests
{
    private readonly AirportCatalog _airports = new();
    private readonly Guid _partyId = Guid.NewGuid();
    private Party Party => new(_partyId, Guid.NewGuid(), [Guid.NewGuid()]);
    private PlanningDocument Document =>
        new()
        {
            Visits =
            [
                new()
                {
                    Id = Guid.NewGuid(),
                    Location = _airports.Resolve("New York"),
                    PresentFrom = new(2030, 5, 1),
                    PresentThrough = new(2030, 5, 5),
                    ArrivalFlexibilityDays = 0,
                    DepartureFlexibilityDays = 0,
                },
            ],
            Parties = [new() { PartyId = _partyId, Origin = _airports.Resolve("ATL") }],
        };

    [TestMethod]
    [DataRow(8, 1)]
    [DataRow(30, 30)]
    public void RankingDoesNotHideCompatibleRoundTripFlights(int outboundCount, int returnCount)
    {
        var fares = Enumerable
            .Range(0, outboundCount)
            .Select(index => Fare(false, index))
            .Concat(Enumerable.Range(0, returnCount).Select(index => Fare(true, index)))
            .ToArray();
        var response = new RouteFareComposer(_airports)
            .Compose(Document, [Party], fares)
            .Single()
            .Response;
        var flights = response.GetProperty("flights").EnumerateArray().ToArray();
        var routes = response.GetProperty("itineraries").EnumerateArray().ToArray();
        var connections = response.GetProperty("roundTripConnections").EnumerateArray().ToArray();
        Assert.HasCount(outboundCount + returnCount, flights);
        Assert.HasCount(outboundCount * returnCount, connections);
        foreach (var flight in flights)
        {
            var index = flight.GetProperty("legIndex").GetInt32();
            var key = FlightChoiceRoute.FlightKey(flight.GetProperty("leg"));
            Assert.IsTrue(
                routes.Any(route =>
                    FlightChoiceRoute.FlightKey(route.GetProperty("legs")[index]) == key
                ),
                "Every compatible card needs a reviewable route, including expensive flights."
            );
        }
        for (int outbound = 0; outbound < outboundCount; outbound++)
        {
            var matches = connections
                .Where(connection =>
                    connection.GetProperty("outboundFlightIndex").GetInt32() == outbound
                )
                .ToArray();
            Assert.HasCount(returnCount, matches);
            CollectionAssert.AreEquivalent(
                Enumerable.Range(outboundCount, returnCount).ToArray(),
                matches
                    .Select(connection => connection.GetProperty("returnFlightIndex").GetInt32())
                    .ToArray()
            );
        }
    }

    [TestMethod]
    [DataRow(1, false)]
    [DataRow(4, false)]
    [DataRow(5, true)]
    public void CompleteRoundTripStillRequiresCompatibleStayDates(int returnDay, bool compatible)
    {
        var response = new RouteFareComposer(_airports)
            .Compose(Document, [Party], [Fare(false, 0), Fare(true, 0, returnDay)])
            .Single()
            .Response;
        Assert.AreEqual(
            compatible ? 1 : 0,
            response.GetProperty("roundTripConnections").GetArrayLength()
        );
    }

    [TestMethod]
    public void BundledFaresOnlyConnectTheFlightsPricedTogether()
    {
        var fares = Enumerable
            .Range(0, 2)
            .Select(index => Bundle(Fare(false, index), Fare(true, index), $"bundle-{index}"))
            .ToArray();
        var response = new RouteFareComposer(_airports)
            .Compose(Document, [Party], fares)
            .Single()
            .Response;
        var flights = response.GetProperty("flights").EnumerateArray().ToArray();
        var connections = response.GetProperty("roundTripConnections").EnumerateArray().ToArray();
        Assert.HasCount(2, connections);
        foreach (var connection in connections)
        {
            var outbound = flights[connection.GetProperty("outboundFlightIndex").GetInt32()];
            var inbound = flights[connection.GetProperty("returnFlightIndex").GetInt32()];
            Assert.AreEqual(
                outbound
                    .GetProperty("leg")
                    .GetProperty("segments")[0]
                    .GetProperty("flight_number")
                    .GetString(),
                inbound
                    .GetProperty("leg")
                    .GetProperty("segments")[0]
                    .GetProperty("flight_number")
                    .GetString()
            );
        }
    }

    [TestMethod]
    [DataRow(true)]
    [DataRow(false)]
    public void ABookedBundleOnlyRestrictsOptionsWhileBothFlightsAreSelected(bool bothSelected)
    {
        var bookedOutbound = Fare(false, 0, bothSelected ? 1 : 2);
        var nextOutbound = Fare(false, 1);
        var inbound = Fare(true, 0);
        var bundle = Bundle(bookedOutbound, inbound, "booked-bundle");
        var bookedKey = FlightChoiceRoute.FlightKey(OneWayLeg(bookedOutbound))!;
        var inboundKey = FlightChoiceRoute.FlightKey(OneWayLeg(inbound))!;
        var choice = new FlightChoiceProgress(
            _partyId,
            [bothSelected ? bookedKey : null, inboundKey],
            []
        )
        {
            PurchasedOfferIds = ["booked-bundle"],
            UnmatchedLegKeys = bothSelected ? [] : [bookedKey],
            SavedFares = [bundle, inbound],
        };

        var response = new RouteFareComposer(_airports)
            .Compose(
                Document,
                [Party],
                [bundle, nextOutbound, inbound],
                [choice],
                includeAllConnections: true
            )
            .Single()
            .Response;

        var itinerary = response.GetProperty("itineraries").EnumerateArray().Single();
        var legs = itinerary.GetProperty("legs");
        Assert.AreEqual(
            bothSelected ? bookedKey : FlightChoiceRoute.FlightKey(OneWayLeg(nextOutbound)),
            FlightChoiceRoute.FlightKey(legs[0])
        );
        Assert.AreEqual(inboundKey, FlightChoiceRoute.FlightKey(legs[1]));
        Assert.AreEqual(
            bothSelected ? 1 : 2,
            itinerary.GetProperty("bookingOffers").GetArrayLength()
        );
        Assert.HasCount(1, response.GetProperty("roundTripConnections").EnumerateArray().ToArray());
        CollectionAssert.AreEqual(new[] { "booked-bundle" }, choice.PurchasedOfferIds);
    }

    private static FareSearchResult Bundle(
        FareSearchResult outbound,
        FareSearchResult inbound,
        string offerId
    ) =>
        outbound with
        {
            Request = outbound.Request with
            {
                SearchKind = "flexible",
                Legs =
                [
                    new(
                        outbound.Request.Origin,
                        outbound.Request.Destination,
                        outbound.Request.DepartureDate,
                        null
                    ),
                    new(
                        inbound.Request.Origin,
                        inbound.Request.Destination,
                        inbound.Request.DepartureDate,
                        null
                    ),
                ],
            },
            Response = JsonSerializer.SerializeToElement(
                new
                {
                    itineraries = new[]
                    {
                        new
                        {
                            ignav_id = offerId,
                            price = new { amount = 200, currency = "USD" },
                            legs = new[] { OneWayLeg(outbound), OneWayLeg(inbound) },
                        },
                    },
                }
            ),
        };

    private static JsonElement OneWayLeg(FareSearchResult fare) =>
        fare.Response.GetProperty("itineraries")[0].GetProperty("outbound");

    private FareSearchResult Fare(bool returning, int index, int? dayOfMonth = null)
    {
        string origin = returning ? "LGA" : "ATL";
        string destination = returning ? "ATL" : "JFK";
        var day = new DateOnly(2030, 5, dayOfMonth ?? (returning ? 5 : 1));
        return new(
            _partyId,
            $"{returning}-{index}",
            new(origin, destination, day, day, 1, "economy", "US", null, "oneWay"),
            JsonSerializer.SerializeToElement(
                new
                {
                    itineraries = new[]
                    {
                        new
                        {
                            ignav_id = $"{returning}-{index}",
                            price = new { amount = 100 + index, currency = "USD" },
                            outbound = new
                            {
                                segments = new[]
                                {
                                    new
                                    {
                                        departure_airport = origin,
                                        arrival_airport = destination,
                                        departure_time_local = $"{day:yyyy-MM-dd}T10:00:00",
                                        arrival_time_local = $"{day:yyyy-MM-dd}T12:00:00",
                                        departure_time_utc = $"{day:yyyy-MM-dd}T14:00:00Z",
                                        arrival_time_utc = $"{day:yyyy-MM-dd}T16:00:00Z",
                                        marketing_carrier_code = "AA",
                                        flight_number = index.ToString(),
                                    },
                                },
                            },
                        },
                    },
                }
            ),
            DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow.AddHours(1)
        );
    }
}
