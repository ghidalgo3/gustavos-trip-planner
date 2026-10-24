using System.Text.Json;
using System.Text.Json.Nodes;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Flights;

namespace TripPlanner.Api.Tests.Services.Flights;

[TestClass]
public sealed class MultiStopGridTests
{
    private readonly AirportCatalog _airports = new();
    private readonly Guid _partyId = Guid.NewGuid();
    private Party Party => new(_partyId, Guid.NewGuid(), [Guid.NewGuid()]);

    private PlanningDocument Document(params string[] destinations) =>
        new()
        {
            Visits = destinations
                .Select(code => new PlannedVisit
                {
                    Id = Guid.NewGuid(),
                    Location = _airports.Resolve(code),
                })
                .ToArray(),
            Parties =
            [
                new()
                {
                    PartyId = _partyId,
                    Origin = _airports.Resolve("ATL"),
                    PreferredAirlines = ["DL"],
                },
            ],
        };

    [TestMethod]
    [DataRow(8, 2)]
    [DataRow(32, 32)]
    [DataRow(220, 1)]
    public void EveryCompatibleFlightHasConnectionsAndAReviewableRoute(
        int outboundCount,
        int onwardCount
    )
    {
        // Repeat New York, and include more combinations than can be enumerated
        // or represented by a top-200 itinerary sample.
        var codes = new[] { "ATL", "JFK", "BOS", "IAD", "JFK", "ATL" };
        var fares = Enumerable
            .Range(0, 5)
            .SelectMany(step =>
                Enumerable
                    .Range(0, step == 0 ? outboundCount : onwardCount)
                    .Select(index => Fare(codes[step], codes[step + 1], 1 + step * 3, index))
            )
            .ToArray();
        var response = Compose(Document("JFK", "BOS", "IAD", "JFK"), fares);
        foreach (var graph in response.GetProperty("routeGraphs").EnumerateArray())
        {
            Assert.IsFalse(graph.GetProperty("bundledReturn").GetBoolean());
        }
        var flights = response.GetProperty("flights").EnumerateArray().ToArray();
        var routes = response.GetProperty("itineraries").EnumerateArray().ToArray();
        var connections = response.GetProperty("flightConnections").EnumerateArray().ToArray();
        Assert.HasCount(outboundCount + 4 * onwardCount, flights);
        Assert.HasCount(outboundCount * onwardCount + 3 * onwardCount * onwardCount, connections);
        var connected = connections
            .SelectMany(edge =>
                new[]
                {
                    edge.GetProperty("fromFlightIndex").GetInt32(),
                    edge.GetProperty("toFlightIndex").GetInt32(),
                }
            )
            .ToHashSet();
        for (int index = 0; index < flights.Length; index++)
        {
            var flight = flights[index];
            var column = flight.GetProperty("legIndex").GetInt32();
            var key = FlightChoiceRoute.FlightKey(flight.GetProperty("leg"));
            Assert.Contains(index, connected, "Price ranking cannot remove valid connections.");
            Assert.IsTrue(
                routes.Any(route =>
                    FlightChoiceRoute.FlightKey(route.GetProperty("legs")[column]) == key
                ),
                "Every compatible card, including expensive Delta flights, needs a reviewable route."
            );
        }
        foreach (var route in routes)
        {
            Assert.AreEqual(5, route.GetProperty("legs").GetArrayLength());
            Assert.AreEqual(
                route.GetProperty("price").GetProperty("amount").GetDecimal(),
                route
                    .GetProperty("bookingOffers")
                    .EnumerateArray()
                    .Sum(booking => booking.GetProperty("price").GetProperty("amount").GetDecimal())
            );
        }
    }

    [TestMethod]
    public void SharedMiddleFlightsDoNotMixBundledReturns()
    {
        var bundles = Enumerable
            .Range(0, 2)
            .Select(index =>
            {
                var outbound = Fare("ATL", "JFK", 1, index);
                var inbound = Fare("JFK", "ATL", 13, index);
                return outbound with
                {
                    Request = outbound.Request with
                    {
                        SearchKind = "flexible",
                        Legs =
                        [
                            new("ATL", "JFK", new(2030, 5, 1), null),
                            new("JFK", "ATL", new(2030, 5, 13), null),
                        ],
                    },
                    Response = JsonSerializer.SerializeToElement(
                        new
                        {
                            itineraries = new[]
                            {
                                new
                                {
                                    ignav_id = $"bundle-{index}",
                                    price = new { amount = 200 + index, currency = "USD" },
                                    legs = new[] { Outbound(outbound), Outbound(inbound) },
                                },
                            },
                        }
                    ),
                };
            })
            .ToArray();
        var response = Compose(
            Document("JFK", "BOS", "IAD", "JFK"),
            [.. bundles, Fare("JFK", "BOS", 4), Fare("BOS", "IAD", 7), Fare("IAD", "JFK", 10)]
        );
        var paths = GraphPaths(response);
        Assert.HasCount(2, paths);
        foreach (var path in paths)
        {
            Assert.AreEqual(
                path[0][^1],
                path[^1][^1],
                "A bundle's return cannot be swapped for another return departing at the same time."
            );
        }
        foreach (var route in response.GetProperty("itineraries").EnumerateArray())
        {
            Assert.AreEqual(4, route.GetProperty("bookingOffers").GetArrayLength());
            var outboundNumber = route
                .GetProperty("legs")[0]
                .GetProperty("segments")[0]
                .GetProperty("flight_number")
                .GetString()!;
            Assert.AreEqual(
                500 + int.Parse(outboundNumber[^1..]),
                route.GetProperty("price").GetProperty("amount").GetInt32()
            );
        }
        var cards = response.GetProperty("flights");
        foreach (var graph in response.GetProperty("routeGraphs").EnumerateArray())
        {
            Assert.IsTrue(graph.GetProperty("bundledReturn").GetBoolean());
            var costs = graph.GetProperty("costs").EnumerateArray().ToArray();
            var outgoing = costs.Single(cost =>
                cards[cost.GetProperty("flightIndex").GetInt32()].GetProperty("legIndex").GetInt32()
                == 0
            );
            var returning = costs.Single(cost =>
                cards[cost.GetProperty("flightIndex").GetInt32()].GetProperty("legIndex").GetInt32()
                == 4
            );
            Assert.AreEqual("USD", graph.GetProperty("currency").GetString());
            Assert.AreEqual(
                0m,
                returning.GetProperty("amount").GetDecimal(),
                "The return price is already included in the outbound bundle."
            );
            Assert.AreEqual(
                outgoing.GetProperty("amount").GetDecimal() + 300m,
                costs.Sum(cost => cost.GetProperty("amount").GetDecimal())
            );
        }
    }

    [TestMethod]
    public void WholeTripDurationKeepsOutboundAndReturnCompatibilitySeparate()
    {
        var document = Document("JFK", "BOS") with { SearchLimits = new() { MaxTripDays = 5 } };
        var response = Compose(
            document,
            [
                Fare("ATL", "JFK", 1),
                Fare("ATL", "JFK", 2),
                Fare("JFK", "BOS", 3),
                Fare("BOS", "ATL", 5),
                Fare("BOS", "ATL", 6),
            ]
        );
        var paths = GraphPaths(response);
        CollectionAssert.AreEquivalent(
            new[]
            {
                "ATL-JFK-1-0,JFK-BOS-3-0,BOS-ATL-5-0",
                "ATL-JFK-2-0,JFK-BOS-3-0,BOS-ATL-5-0",
                "ATL-JFK-2-0,JFK-BOS-3-0,BOS-ATL-6-0",
            },
            paths.Select(path => string.Join(',', path)).ToArray()
        );
    }

    [TestMethod]
    public void DeadEndsStayProvisionalEvenWhenTheyHaveAnIncomingConnection()
    {
        var response = Compose(
            Document("JFK", "BOS"),
            [
                Fare("ATL", "JFK", 1),
                Fare("JFK", "BOS", 3),
                Fare("JFK", "BOS", 5),
                Fare("BOS", "ATL", 4),
            ]
        );
        Assert.AreEqual(4, response.GetProperty("flights").GetArrayLength());
        CollectionAssert.AreEqual(
            new[] { "ATL-JFK-1-0", "JFK-BOS-3-0", "BOS-ATL-4-0" },
            GraphPaths(response).Single()
        );
    }

    [TestMethod]
    [DataRow("USD", true)]
    [DataRow("EUR", false)]
    public void RouteGraphsOnlyCombineFaresInTheSameCurrency(string currency, bool compatible)
    {
        var response = Compose(
            Document("JFK", "BOS"),
            [
                Fare("ATL", "JFK", 1, currency: currency),
                Fare("JFK", "BOS", 3),
                Fare("BOS", "ATL", 5),
            ]
        );
        Assert.HasCount(compatible ? 1 : 0, GraphPaths(response));
        Assert.AreEqual(compatible ? 1 : 0, response.GetProperty("itineraries").GetArrayLength());
    }

    [TestMethod]
    public void QuotesForTheSameFlightsRemainReviewableInEachCurrency()
    {
        var fares = new[] { "USD", "EUR" }
            .SelectMany(currency =>
                new[]
                {
                    Fare("ATL", "JFK", 1, currency: currency),
                    Fare("JFK", "BOS", 3, currency: currency),
                    Fare("BOS", "ATL", 5, currency: currency),
                }
            )
            .ToArray();
        var response = Compose(Document("JFK", "BOS"), fares);
        CollectionAssert.AreEquivalent(
            new[] { "USD", "EUR" },
            response
                .GetProperty("itineraries")
                .EnumerateArray()
                .Select(route => route.GetProperty("price").GetProperty("currency").GetString())
                .ToArray()
        );
        CollectionAssert.AreEquivalent(
            new[] { "USD", "EUR" },
            response
                .GetProperty("routeGraphs")
                .EnumerateArray()
                .Select(graph => graph.GetProperty("currency").GetString())
                .ToArray()
        );
    }

    [TestMethod]
    public void SavedChoicesRestrictBothGraphConnectionsAndReviewableRoutes()
    {
        var expensive = Fare("ATL", "JFK", 1, 10);
        var choice = FlightChoiceRoute.FlightKey(Outbound(expensive))!;
        var response = new RouteFareComposer(_airports)
            .Compose(
                Document("JFK", "BOS"),
                [Party],
                [Fare("ATL", "JFK", 1), expensive, Fare("JFK", "BOS", 3), Fare("BOS", "ATL", 5)],
                [new FlightChoiceProgress(_partyId, [choice], [])]
            )
            .Single()
            .Response;
        Assert.AreEqual("ATL-JFK-1-10", GraphPaths(response).Single()[0]);
        Assert.AreEqual(
            choice,
            FlightChoiceRoute.FlightKey(
                response.GetProperty("itineraries")[0].GetProperty("legs")[0]
            )
        );
    }

    [TestMethod]
    public void DistinctArrivalTimesRetainAReviewableRouteForEachCard()
    {
        var original = Fare("ATL", "JFK", 1);
        var revised = JsonNode.Parse(original.Response.GetRawText())!;
        var segment = revised["itineraries"]![0]!["outbound"]!["segments"]![0]!;
        segment["arrival_time_local"] = "2030-05-01T12:30:00";
        segment["arrival_time_utc"] = "2030-05-01T16:30:00Z";
        var response = Compose(
            Document("JFK", "BOS"),
            [
                original,
                original with
                {
                    CacheKey = "updated-arrival",
                    Response = JsonSerializer.SerializeToElement(revised),
                },
                Fare("JFK", "BOS", 3),
                Fare("BOS", "ATL", 5),
            ]
        );
        var routes = response.GetProperty("itineraries").EnumerateArray().ToArray();
        Assert.HasCount(2, routes);
        var arrivals = routes
            .Select(route =>
                route
                    .GetProperty("legs")[0]
                    .GetProperty("segments")[0]
                    .GetProperty("arrival_time_local")
                    .GetString()
            )
            .ToArray();
        CollectionAssert.AreEquivalent(
            new[] { "2030-05-01T12:00:00", "2030-05-01T12:30:00" },
            arrivals
        );
    }

    [TestMethod]
    public void GridKeepsAlternativesAfterReviewAndCanReviewAnUnsampledCombination()
    {
        var document = Document("JFK", "BOS", "IAD", "JFK");
        var codes = new[] { "ATL", "JFK", "BOS", "IAD", "JFK", "ATL" };
        var fares = Enumerable
            .Range(0, 5)
            .SelectMany(step =>
                Enumerable
                    .Range(0, 3)
                    .Select(index => Fare(codes[step], codes[step + 1], 1 + step * 3, index))
            )
            .ToArray();
        var composer = new RouteFareComposer(_airports);
        var first = composer.Compose(document, [Party], fares).Single().Response;
        var keys = Enumerable
            .Range(0, 5)
            .Select(step => FlightChoiceRoute.FlightKey(Outbound(fares[step * 3 + 2]))!)
            .ToArray();
        Assert.IsFalse(
            first
                .GetProperty("itineraries")
                .EnumerateArray()
                .Any(route =>
                    route
                        .GetProperty("legs")
                        .EnumerateArray()
                        .Select(FlightChoiceRoute.FlightKey)
                        .SequenceEqual(keys)
                )
        );
        var reviewed = composer
            .Compose(
                document,
                [Party],
                fares,
                [new FlightChoiceProgress(_partyId, keys, [])],
                includeAllConnections: true
            )
            .Single()
            .Response;
        CollectionAssert.AreEqual(
            keys,
            reviewed
                .GetProperty("choiceKeys")
                .EnumerateArray()
                .Select(key => key.GetString())
                .ToArray()
        );
        var route = reviewed.GetProperty("itineraries")[0];
        Assert.AreEqual(510m, route.GetProperty("price").GetProperty("amount").GetDecimal());
        CollectionAssert.AreEqual(
            keys,
            route.GetProperty("legs").EnumerateArray().Select(FlightChoiceRoute.FlightKey).ToArray()
        );
        Assert.AreEqual(
            first.GetProperty("flightConnections").GetArrayLength(),
            reviewed.GetProperty("flightConnections").GetArrayLength(),
            "Reviewing a route must not prevent the grid from changing one flight or clearing selections."
        );
    }

    private JsonElement Compose(PlanningDocument document, FareSearchResult[] fares) =>
        new RouteFareComposer(_airports).Compose(document, [Party], fares).Single().Response;

    // Enumerate only the tiny constraint fixtures, independently of sampled itineraries.
    private static string[][] GraphPaths(JsonElement response)
    {
        var flights = response.GetProperty("flights");
        var allEdges = response.GetProperty("flightConnections");
        var paths = new List<string[]>();
        foreach (var graph in response.GetProperty("routeGraphs").EnumerateArray())
        {
            var edges = graph
                .GetProperty("connectionIndexes")
                .EnumerateArray()
                .Select(index => allEdges[index.GetInt32()])
                .Select(edge =>
                    (
                        From: edge.GetProperty("fromFlightIndex").GetInt32(),
                        To: edge.GetProperty("toFlightIndex").GetInt32()
                    )
                )
                .ToArray();
            void Walk(int node, string[] prefix)
            {
                string[] path =
                [
                    .. prefix,
                    flights[node]
                        .GetProperty("leg")
                        .GetProperty("segments")[0]
                        .GetProperty("flight_number")
                        .GetString()!,
                ];
                var next = edges.Where(edge => edge.From == node).ToArray();
                if (next.Length == 0)
                {
                    paths.Add(path);
                }
                foreach (var edge in next)
                {
                    Walk(edge.To, path);
                }
            }
            foreach (
                var start in edges
                    .Select(edge => edge.From)
                    .Distinct()
                    .Where(index => flights[index].GetProperty("legIndex").GetInt32() == 0)
            )
            {
                Walk(start, []);
            }
        }
        return paths.DistinctBy(path => string.Join(',', path)).ToArray();
    }

    private static JsonElement Outbound(FareSearchResult fare) =>
        fare.Response.GetProperty("itineraries")[0].GetProperty("outbound");

    private FareSearchResult Fare(
        string origin,
        string destination,
        int day,
        int index = 0,
        string currency = "USD"
    )
    {
        var date = new DateOnly(2030, 5, day);
        var id = $"{origin}-{destination}-{day}-{index}";
        return new(
            _partyId,
            id,
            new(origin, destination, date, date, 1, "economy", "US", null, "oneWay"),
            JsonSerializer.SerializeToElement(
                new
                {
                    itineraries = new[]
                    {
                        new
                        {
                            ignav_id = id,
                            price = new { amount = 100 + index, currency },
                            outbound = new
                            {
                                segments = new[]
                                {
                                    new
                                    {
                                        departure_airport = origin,
                                        arrival_airport = destination,
                                        departure_time_local = $"{date:yyyy-MM-dd}T10:00:00",
                                        arrival_time_local = $"{date:yyyy-MM-dd}T12:00:00",
                                        departure_time_utc = $"{date:yyyy-MM-dd}T14:00:00Z",
                                        arrival_time_utc = $"{date:yyyy-MM-dd}T16:00:00Z",
                                        marketing_carrier_code = index > 0 ? "DL" : "AA",
                                        flight_number = id,
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
