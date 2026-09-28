using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Endpoints;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services;

namespace TripPlanner.Api.Tests;

[TestClass]
public sealed class MultiCityPlannerTests
{
    private readonly AirportCatalog _airports = new();
    private readonly Guid _owner = Guid.NewGuid();
    private readonly Guid _party = Guid.NewGuid();

    private PlanningDocument Wedding()
    {
        var phuket = new PlannedVisit
        {
            Id = Guid.NewGuid(),
            Location = _airports.Resolve("HKT"),
            PresentFrom = new(2030, 5, 2),
            PresentThrough = new(2030, 5, 5),
        };
        var hongKong = new PlannedVisit
        {
            Id = Guid.NewGuid(),
            Location = _airports.Resolve("HKG"),
            Nights = 4,
            AfterVisitIds = [phuket.Id],
        };
        var tokyo = new PlannedVisit
        {
            Id = Guid.NewGuid(),
            Location = _airports.Resolve("HND"),
            Nights = 4,
            AfterVisitIds = [hongKong.Id],
        };
        return new()
        {
            Visits = [phuket, hongKong, tokyo],
            Parties = [new() { PartyId = _party, Origin = _airports.Resolve("ATL") }],
        };
    }

    private Party Party => new(_party, Guid.NewGuid(), [_owner]);

    [TestMethod]
    public async Task RouteSearch_QueuesCachesReturnsAndPersistsCompleteItinerary()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Subject", "route-owner");
        client.DefaultRequestHeaders.Add("X-Test-Email", "route-owner@example.com");
        var profileResponse = await client.PutAsJsonAsync(
            "/api/user/profile",
            new UserProfile(new("Atlanta", -84.388, 33.749), [], "ATL")
        );
        profileResponse.EnsureSuccessStatusCode();
        var user = (await profileResponse.Content.ReadFromJsonAsync<CurrentUserResponse>())!;
        var tripResponse = await client.PostAsJsonAsync(
            $"/api/user/{user.Id}/trips",
            new CreateTripRequest("Wedding route", "")
        );
        tripResponse.EnsureSuccessStatusCode();
        var trip = (await tripResponse.Content.ReadFromJsonAsync<Trip>())!;
        var party = factory.Database.Parties.Single();
        var document = Wedding() with
        {
            Parties = [new() { PartyId = party.Id, Origin = _airports.Resolve("ATL") }],
        };
        (
            await client.PutAsJsonAsync(
                $"/api/user/{user.Id}/trips/{trip.Id}/constraints",
                document
            )
        ).EnsureSuccessStatusCode();
        var path = $"/api/trips/{trip.Id}/flightSearch";
        Assert.AreEqual(HttpStatusCode.NotFound, (await client.GetAsync(path)).StatusCode);
        var response = await client.PostAsJsonAsync(
            path,
            new StartFlightSearchRequest(Guid.NewGuid())
        );
        Assert.AreEqual(HttpStatusCode.Accepted, response.StatusCode);
        var operation = (await response.Content.ReadFromJsonAsync<TrackedOperation>())!;
        var available = Fares()
            .ToDictionary(f => SearchPlanBuilder.CacheKey(f.Request), f => f.Response);
        while (await factory.Database.ClaimFareWorkAsync(TimeSpan.FromMinutes(2)) is { } work)
        {
            var result = available.GetValueOrDefault(
                work.CacheKey,
                JsonSerializer.SerializeToElement(new { itineraries = Array.Empty<object>() })
            );
            await factory.Database.CompleteFareWorkAsync(work, result, DateTimeOffset.UtcNow, null);
        }
        Assert.AreEqual(
            "Completed",
            (await client.GetFromJsonAsync<TrackedOperation>(operation.PollingUrl))!.Status
        );
        var fares = (await client.GetFromJsonAsync<EvaluatedFareSearchResultDto[]>(path))!;
        Assert.HasCount(1, fares);
        Assert.IsGreaterThan(0, fares[0].Response.GetProperty("itineraries").GetArrayLength());
        var selectionPath = $"/api/trips/{trip.Id}/selectedFlights";
        var selection = await client.PutAsJsonAsync(
            $"{selectionPath}/{party.Id}",
            new SelectFlightRequest(fares[0].CacheKey, 0)
        );
        Assert.AreEqual(HttpStatusCode.OK, selection.StatusCode);
        var saved = (await client.GetFromJsonAsync<SelectedFlight[]>(selectionPath))!.Single();
        Assert.AreEqual(4, saved.Itinerary.GetProperty("legs").GetArrayLength());
        Assert.AreEqual(3, saved.Itinerary.GetProperty("bookingOffers").GetArrayLength());
        var cached = await client.PostAsJsonAsync(
            path,
            new StartFlightSearchRequest(Guid.NewGuid())
        );
        Assert.AreEqual(
            "Completed",
            (await cached.Content.ReadFromJsonAsync<TrackedOperation>())!.Status
        );
        Assert.IsNull(await factory.Database.ClaimFareWorkAsync(TimeSpan.FromMinutes(2)));
    }

    [TestMethod]
    public void WeddingWithoutTripDates_PreparesCompleteRoutesWithinBudget()
    {
        var document = Wedding();
        var plan = new MultiCityPlanner(_airports, TimeProvider.System, 40).Build(
            document,
            [Party],
            default
        );
        Assert.IsTrue(plan.Ready, string.Join(";", plan.Issues.Select(i => i.Message)));
        var queries = plan.Parties.Single().Requests;
        Assert.IsTrue(queries.Count is > 0 and <= 40);
        Assert.AreEqual(queries.Count, queries.Select(q => q.CacheKey).Distinct().Count());
        Assert.IsTrue(
            queries.Any(q => q.Body.SearchKind == "flexible" && q.Body.Legs!.Length == 2)
        );
        foreach (
            var edge in new[]
            {
                ("ATL", "HKT", 1),
                ("HKT", "HKG", 5),
                ("HKG", "HND", 9),
                ("HND", "ATL", 13),
            }
        )
            Assert.IsTrue(
                queries.Any(q =>
                    q.Body.SearchKind == "oneWay"
                    && q.Body.Origin == edge.Item1
                    && q.Body.Destination == edge.Item2
                    && q.Body.DepartureDate == new DateOnly(2030, 5, edge.Item3)
                ),
                $"Missing {edge}"
            );
        Assert.IsNull(document.TravelDates);
    }

    [TestMethod]
    public void VisitOrdering_RespectsPrecedenceAndRejectsCycles()
    {
        var document = Wedding();
        Assert.HasCount(1, MultiCityPlanner.Orders(document.Visits).ToArray());
        Assert.HasCount(
            6,
            MultiCityPlanner
                .Orders(document.Visits.Select(v => v with { AfterVisitIds = [] }).ToArray())
                .ToArray()
        );
        document = document with
        {
            Visits =
            [
                document.Visits[0] with
                {
                    AfterVisitIds = [document.Visits[2].Id],
                },
                .. document.Visits.Skip(1),
            ],
        };
        Assert.IsFalse(
            new MultiCityPlanner(_airports, TimeProvider.System)
                .Build(document, [Party], default)
                .Ready
        );
    }

    [TestMethod]
    public void OpenJaw_IsPricedAsOneOfferAndEveryStayIsChecked()
    {
        var document = Wedding();
        var fares = Fares();
        var result = new RouteFareComposer(_airports).Compose(document, [Party], fares).Single();
        var itineraries = result.Response.GetProperty("itineraries");
        Assert.IsGreaterThan(0, itineraries.GetArrayLength());
        Assert.AreEqual(
            900m,
            itineraries[0].GetProperty("price").GetProperty("amount").GetDecimal()
        );
        Assert.AreEqual(4, itineraries[0].GetProperty("legs").GetArrayLength());
        Assert.AreEqual(3, itineraries[0].GetProperty("bookingOffers").GetArrayLength());
        CollectionAssert.AreEqual(
            new[] { 0, 3 },
            itineraries[0]
                .GetProperty("bookingOffers")[0]
                .GetProperty("legIndexes")
                .EnumerateArray()
                .Select(v => v.GetInt32())
                .ToArray()
        );
        foreach (int nights in new[] { 3, 5 })
        {
            var changed = document with
            {
                Visits =
                [
                    document.Visits[0],
                    document.Visits[1] with
                    {
                        Nights = nights,
                    },
                    document.Visits[2],
                ],
            };
            Assert.AreEqual(
                0,
                new RouteFareComposer(_airports)
                    .Compose(changed, [Party], fares)
                    .Single()
                    .Response.GetProperty("itineraries")
                    .GetArrayLength()
            );
        }
        var late = document with
        {
            Visits =
            [
                document.Visits[0] with
                {
                    PresentFrom = new(2030, 5, 1),
                },
                .. document.Visits.Skip(1),
            ],
        };
        Assert.AreEqual(
            0,
            new RouteFareComposer(_airports)
                .Compose(late, [Party], fares)
                .Single()
                .Response.GetProperty("itineraries")
                .GetArrayLength()
        );
    }

    [TestMethod]
    public void NoDateAnchor_ExplainsWhatIsMissing()
    {
        var doc = Wedding() with
        {
            Visits = Wedding()
                .Visits.Select(v =>
                    v with
                    {
                        PresentFrom = null,
                        PresentThrough = null,
                        Nights = 4,
                        AfterVisitIds = [],
                    }
                )
                .ToArray(),
        };
        var plan = new MultiCityPlanner(_airports, TimeProvider.System).Build(
            doc,
            [Party],
            default
        );
        Assert.IsFalse(plan.Ready);
        Assert.IsTrue(plan.Issues.Any(i => i.Message.Contains("anchor")));
    }

    [TestMethod]
    public void ExplicitFlightWindows_ReplaceFixedDatesIndependently()
    {
        var doc = Wedding() with
        {
            TravelDates = new(new(2030, 4, 30), new(2030, 5, 14)),
            Constraints =
            [
                new()
                {
                    Id = Guid.NewGuid(),
                    UserId = _owner,
                    Type = "departureWindow",
                    Window = new(new(2030, 5, 1), new(2030, 5, 2)),
                },
                new()
                {
                    Id = Guid.NewGuid(),
                    UserId = _owner,
                    Type = "returnHomeWindow",
                    Window = new(new(2030, 5, 13), new(2030, 5, 15)),
                },
            ],
        };
        var plan = new MultiCityPlanner(_airports, TimeProvider.System).Build(
            doc,
            [Party],
            default
        );
        Assert.IsTrue(plan.Ready);
        Assert.IsTrue(
            plan.Parties.Single()
                .Requests.Any(q =>
                    q.Body.Origin == "ATL" && q.Body.DepartureDate == new DateOnly(2030, 5, 1)
                )
        );
        var result = new RouteFareComposer(_airports).Compose(doc, [Party], Fares()).Single();
        Assert.IsGreaterThan(0, result.Response.GetProperty("itineraries").GetArrayLength());
    }

    private FareSearchResult[] Fares()
    {
        object Leg(
            string origin,
            string destination,
            string departure,
            string arrival,
            int duration
        ) =>
            new
            {
                duration_minutes = duration,
                segments = new[]
                {
                    new
                    {
                        departure_airport = origin,
                        arrival_airport = destination,
                        departure_time_local = departure,
                        arrival_time_local = arrival,
                        departure_time_utc = Utc(origin, departure),
                        arrival_time_utc = Utc(destination, arrival),
                        marketing_carrier_code = "AA",
                        flight_number = "AA1",
                    },
                },
            };
        string Utc(string code, string local) =>
            TimeZoneInfo
                .ConvertTimeToUtc(
                    DateTime.Parse(local),
                    TimeZoneInfo.FindSystemTimeZoneById(_airports.FindByCode(code)!.TimeZone)
                )
                .ToString("O");
        var legs = new[]
        {
            Leg("ATL", "HKT", "2030-05-01T09:00:00", "2030-05-02T15:00:00", 1140),
            Leg("HKT", "HKG", "2030-05-05T09:00:00", "2030-05-05T13:00:00", 180),
            Leg("HKG", "HND", "2030-05-09T09:00:00", "2030-05-09T14:00:00", 240),
            Leg("HND", "ATL", "2030-05-13T09:00:00", "2030-05-13T09:00:00", 780),
        };
        var codes = new[] { "ATL", "HKT", "HKG", "HND", "ATL" };
        var days = new[] { 1, 5, 9, 13 };
        var results = Enumerable
            .Range(0, 4)
            .Select(i => new FareSearchResult(
                _party,
                $"key-{i}",
                new(
                    codes[i],
                    codes[i + 1],
                    new(2030, 5, days[i]),
                    new(2030, 5, days[i]),
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
                                price = new { amount = i is 0 or 3 ? 600 : 100, currency = "USD" },
                                outbound = legs[i],
                                ignav_id = $"fare-{i}",
                            },
                        },
                    }
                ),
                DateTimeOffset.UtcNow,
                DateTimeOffset.UtcNow.AddHours(1)
            ))
            .ToList();
        var request = results[0].Request with
        {
            SearchKind = "flexible",
            Legs =
            [
                new("ATL", "HKT", new(2030, 5, 1), null),
                new("HND", "ATL", new(2030, 5, 13), null),
            ],
        };
        results.Add(
            new(
                _party,
                "pair",
                request,
                JsonSerializer.SerializeToElement(
                    new
                    {
                        itineraries = new[]
                        {
                            new
                            {
                                price = new { amount = 700, currency = "USD" },
                                legs = new[] { legs[0], legs[3] },
                                ignav_id = "open-jaw",
                            },
                        },
                    }
                ),
                DateTimeOffset.UtcNow,
                DateTimeOffset.UtcNow.AddHours(1)
            )
        );
        return results.ToArray();
    }
}
