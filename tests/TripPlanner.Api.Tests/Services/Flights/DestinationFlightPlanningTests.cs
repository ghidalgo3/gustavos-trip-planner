using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Flights;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Services.Flights;

[TestClass]
public class DestinationFlightPlanningTests
{
    [TestMethod]
    [DataRow(false, false)]
    [DataRow(true, false)]
    [DataRow(true, true)]
    public async Task AddingDestinationRemapsSavedReturnAndKeepsItsBooking(
        bool stableIds,
        bool displaced
    )
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Subject", "insert-stop-owner");
        client.DefaultRequestHeaders.Add("X-Test-Email", "insert-stop@example.com");
        var profile = await client.PutAsJsonAsync(
            "/user/profile",
            new UserProfile(new("Atlanta", -84.388, 33.749), [], "ATL")
        );
        profile.EnsureSuccessStatusCode();
        var owner = (await profile.Content.ReadFromJsonAsync<CurrentUserResponse>())!;
        var created = await client.PostAsJsonAsync(
            $"/user/{owner.Id}/trips",
            new CreateTripRequest("Insert stop", "")
        );
        created.EnsureSuccessStatusCode();
        var trip = (await created.Content.ReadFromJsonAsync<Trip>())!;
        var party = factory.Database.Parties.Single();
        async Task Add(
            string name,
            string country,
            double longitude,
            double latitude,
            string arrival,
            string departure
        )
        {
            var response = await client.PostAsJsonAsync(
                $"/trips/{trip.Id}/destinations",
                new
                {
                    type = "Feature",
                    geometry = new GeoJsonPoint(
                        "Point",
                        GeographyPoint.Create(latitude, longitude)
                    ),
                    properties = new
                    {
                        name,
                        countryCode = country,
                        arrivalDate = arrival,
                        departureDate = departure,
                        constraints = new
                        {
                            arrivalFlexibilityDays = 0,
                            departureFlexibilityDays = 0,
                        },
                    },
                }
            );
            response.EnsureSuccessStatusCode();
        }
        await Add("Tokyo", "JP", 139.69, 35.69, "2030-12-25", "2030-12-30");
        await Add("Seoul", "KR", 126.98, 37.57, "2030-12-30", "2031-01-03");
        await Add("Sapporo", "JP", 141.35, 43.06, "2031-01-03", "2031-01-06");
        await Add("Tokyo", "JP", 139.69, 35.69, "2031-01-07", "2031-01-12");
        var document = (
            await client.GetFromJsonAsync<PlanningDocument>($"/trips/{trip.Id}/flights/constraints")
        )!;
        var airports = new AirportCatalog();
        var plan = new MultiCityPlanner(airports, TimeProvider.System).Build(
            document,
            [party],
            default
        );
        Assert.IsTrue(plan.Ready, string.Join("; ", plan.Issues.Select(issue => issue.Message)));
        var flights = new[]
        {
            (
                Index: 0,
                Origin: "ATL",
                Destination: "HND",
                Departure: "2030-12-24",
                Arrival: "2030-12-25"
            ),
            (
                Index: 1,
                Origin: "NRT",
                Destination: "ICN",
                Departure: "2030-12-30",
                Arrival: "2030-12-30"
            ),
            (
                Index: 2,
                Origin: "ICN",
                Destination: "CTS",
                Departure: "2031-01-03",
                Arrival: "2031-01-03"
            ),
            (
                Index: 4,
                Origin: "HND",
                Destination: "ATL",
                Departure: "2031-01-12",
                Arrival: "2031-01-12"
            ),
        };
        if (displaced)
        {
            flights = [.. flights, (3, "CTS", "HND", "2031-01-06", "2031-01-07")];
        }
        var fares = flights
            .Select(flight =>
            {
                var request = plan
                    .Parties.Single()
                    .Requests.First(request =>
                        request.Body.SearchKind == "oneWay"
                        && request.LegIndexes.Contains(flight.Index)
                    );
                return new FareSearchResult(
                    party.Id,
                    request.CacheKey,
                    request.Body,
                    JsonSerializer.SerializeToElement(
                        new
                        {
                            itineraries = new[]
                            {
                                new
                                {
                                    ignav_id = $"saved-{flight.Index}",
                                    price = new
                                    {
                                        amount = 200,
                                        currency = "USD",
                                        status = "verified",
                                    },
                                    outbound = new
                                    {
                                        segments = new[]
                                        {
                                            new
                                            {
                                                departure_airport = flight.Origin,
                                                arrival_airport = flight.Destination,
                                                departure_time_local = flight.Departure
                                                    + "T09:00:00",
                                                arrival_time_local = flight.Arrival + "T15:00:00",
                                                marketing_carrier_code = "DL",
                                                flight_number = flight.Index.ToString(),
                                            },
                                        },
                                    },
                                },
                            },
                        }
                    ),
                    DateTimeOffset.UtcNow.AddHours(-2),
                    DateTimeOffset.UtcNow.AddHours(-1)
                );
            })
            .ToArray();
        var keys = new string?[5];
        for (int index = 0; index < flights.Length; index++)
        {
            keys[flights[index].Index] = FlightChoiceRoute.FlightKey(
                fares[index].Response.GetProperty("itineraries")[0].GetProperty("outbound")
            );
        }
        await factory.Database.SetFlightChoicesAsync(
            owner.Id!.Value,
            trip.Id,
            new(party.Id, keys, [])
            {
                SavedFares = fares,
                LegRoutes = stableIds ? SavedFlightChoices.Bind(document, keys) : null,
                PurchasedOfferIds = displaced ? ["saved-3", "saved-4"] : ["saved-4"],
            }
        );
        await Add("Hiroshima", "JP", 132.46, 34.39, "2031-01-06", "2031-01-07");
        var choicesUrl = $"/trips/{trip.Id}/flights/choices";
        var restored = (
            await client.GetFromJsonAsync<FlightChoiceProgressDto[]>(choicesUrl)
        )!.Single();
        CollectionAssert.AreEqual(
            new string?[] { keys[0], keys[1], keys[2], null, null, keys[4] },
            restored.LegKeys
        );
        Assert.AreEqual(5, restored.Flights.Last().LegIndex);
        CollectionAssert.AreEqual(
            new[] { 5 },
            restored.Bookings.Single(booking => booking.IgnavId == "saved-4").LegIndexes
        );
        CollectionAssert.Contains(restored.PurchasedOfferIds, "saved-4");
        Assert.HasCount(displaced ? 1 : 0, restored.UnmatchedFlights);
        // Reading and restoring never rewrites production choices.
        Assert.HasCount(
            5,
            (await factory.Database.GetFlightChoicesAsync(owner.Id.Value, trip.Id)).Single().LegKeys
        );
        var saved = await client.PutAsJsonAsync(
            $"{choicesUrl}/{party.Id}",
            new SetFlightChoicesRequest(restored.LegKeys, restored.PurchasedOfferIds)
        );
        Assert.AreEqual(
            HttpStatusCode.OK,
            saved.StatusCode,
            await saved.Content.ReadAsStringAsync()
        );
        var stored = (
            await factory.Database.GetFlightChoicesAsync(owner.Id.Value, trip.Id)
        ).Single();
        Assert.HasCount(displaced ? 5 : 4, stored.LegRoutes!);
        Assert.HasCount(displaced ? 1 : 0, stored.UnmatchedLegKeys);
        if (displaced)
        {
            CollectionAssert.Contains(stored.PurchasedOfferIds, "saved-3");
            Assert.HasCount(5, stored.SavedFares);
            var reloaded = (
                await client.GetFromJsonAsync<FlightChoiceProgressDto[]>(choicesUrl)
            )!.Single();
            Assert.HasCount(1, reloaded.UnmatchedFlights);
        }
        CollectionAssert.Contains(stored.PurchasedOfferIds, "saved-4");
        var search = await client.PostAsJsonAsync(
            $"/trips/{trip.Id}/flights:search",
            new StartFlightSearchRequest(Guid.NewGuid())
        );
        search.EnsureSuccessStatusCode();
        var searched = new List<IgnavFareRequest>();
        while (await factory.Database.ClaimFareWorkAsync(TimeSpan.FromMinutes(2)) is { } work)
        {
            searched.Add(work.Request);
            await factory.Database.CompleteFareWorkAsync(
                work,
                JsonSerializer.SerializeToElement(new { itineraries = Array.Empty<object>() }),
                DateTimeOffset.UtcNow,
                null
            );
        }
        Assert.IsNotEmpty(searched);
        Assert.IsFalse(
            searched.Any(request => request.SearchKind == "oneWay" && request.Destination == "ATL")
        );
        (
            await client.PutAsJsonAsync($"{choicesUrl}/{party.Id}", new SetFlightChoicesRequest([]))
        ).EnsureSuccessStatusCode();
        var cleared = (
            await factory.Database.GetFlightChoicesAsync(owner.Id.Value, trip.Id)
        ).Single();
        Assert.IsEmpty(cleared.SavedFares);
        Assert.IsEmpty(cleared.PurchasedOfferIds);
        Assert.IsEmpty(cleared.UnmatchedLegKeys);
    }

    [TestMethod]
    [DataRow(6, 0, true)]
    [DataRow(12, 0, true)]
    [DataRow(12, 1, false)]
    [DataRow(13, 0, false)]
    public void PastArrivalWindowIdentifiesTheDestination(
        int arrivalDay,
        int flexibility,
        bool expired
    )
    {
        var airports = new TripPlanner.Api.Services.Flights.AirportCatalog();
        var partyId = Guid.NewGuid();
        var visit = new PlannedVisit
        {
            Id = Guid.NewGuid(),
            Location = airports.Resolve("HND")! with { Label = "Tokyo" },
            PresentFrom = new(2026, 10, arrivalDay),
            PresentThrough = new(2026, 10, 20),
            ArrivalFlexibilityDays = flexibility,
            DepartureFlexibilityDays = 0,
        };
        var document = new PlanningDocument
        {
            Visits = [visit],
            Parties = [new() { PartyId = partyId, Origin = airports.Resolve("ATL") }],
        };
        var issues = new TripPlanner.Api.Services.Flights.MultiCityPlanner(
            airports,
            new FixedClock()
        ).Validate(document, [new Party(partyId, Guid.NewGuid(), [Guid.NewGuid()])], true);
        Assert.AreEqual(expired, issues.Any(issue => issue.Message.Contains("in the past")));
        if (expired)
        {
            var issue = issues.Single(item => item.Message.Contains("in the past"));
            StringAssert.Contains(issue.Message, "Tokyo");
            StringAssert.Contains(issue.Message, "Overview");
            CollectionAssert.Contains(issue.ConstraintIds, visit.Id);
        }
        else
        {
            Assert.IsEmpty(issues);
        }
    }

    private sealed class FixedClock : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => DateTimeOffset.Parse("2026-10-13T04:00:00Z");
    }

    [TestMethod]
    [DataRow(0, true)]
    [DataRow(2, false)]
    public async Task SearchUsesCurrentDestinationStaysConstraintsAndOwnerHome(
        int flex,
        bool ordered
    )
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Subject", "destination-flights");
        client.DefaultRequestHeaders.Add("X-Test-Email", "planner@example.com");
        var profile = await client.PutAsJsonAsync(
            "/user/profile",
            new UserProfile(new("Boston", -71.06, 42.36), [], "BOS")
        );
        profile.EnsureSuccessStatusCode();
        var owner = (await profile.Content.ReadFromJsonAsync<CurrentUserResponse>())!;
        var created = await client.PostAsJsonAsync(
            $"/user/{owner.Id}/trips",
            new CreateTripRequest("Destinations", "")
        );
        created.EnsureSuccessStatusCode();
        var trip = (await created.Content.ReadFromJsonAsync<Trip>())!;
        var collection = $"/trips/{trip.Id}/destinations";
        async Task<GeoJsonFeature<DestinationProperties>> Add(
            string name,
            string country,
            double longitude,
            double latitude,
            int start,
            int end
        )
        {
            var response = await client.PostAsJsonAsync(
                collection,
                new
                {
                    type = "Feature",
                    geometry = new GeoJsonPoint(
                        "Point",
                        GeographyPoint.Create(latitude: latitude, longitude: longitude)
                    ),
                    properties = new
                    {
                        name,
                        countryCode = country,
                        arrivalDate = $"2030-06-{start:00}",
                        departureDate = $"2030-06-{end:00}",
                        constraints = new
                        {
                            arrivalFlexibilityDays = flex,
                            departureFlexibilityDays = flex,
                            keepAfterPrevious = ordered,
                        },
                    },
                }
            );
            response.EnsureSuccessStatusCode();
            return (
                await response.Content.ReadFromJsonAsync<GeoJsonFeature<DestinationProperties>>()
            )!;
        }
        var paris = await Add("Paris", "FR", 2.35, 48.86, 10, 14);
        var tokyo = await Add("Tokyo", "JP", 139.69, 35.69, 14, 18);
        await Add("Paris", "FR", 2.35, 48.86, 18, 20);
        string constraintsUrl = $"/trips/{trip.Id}/flights/constraints";
        var document = (await client.GetFromJsonAsync<PlanningDocument>(constraintsUrl))!;
        Assert.HasCount(3, document.Visits);
        Assert.AreEqual(paris.Properties.Stays[0].Id, document.Visits[0].Id);
        Assert.AreEqual(tokyo.Properties.Stays[0].Id, document.Visits[1].Id);
        Assert.AreEqual(flex, document.Visits[0].ArrivalFlexibilityDays);
        Assert.AreEqual(flex, document.Visits[0].DepartureFlexibilityDays);
        CollectionAssert.AreEqual(
            new[] { document.Visits[0].Id },
            document.Visits[1].AfterVisitIds
        );
        Assert.IsTrue(document.Parties.Single().Origin!.AirportCodes.Contains("BOS"));
        Assert.IsTrue(document.Visits[0].Location!.AirportCodes.Contains("CDG"));
        Assert.IsNull(document.TravelDates);
        Assert.IsNull(document.Destination);
        var preview = new TripPlanner.Api.Services.Flights.MultiCityPlanner(
            new(),
            TimeProvider.System,
            200
        ).Build(document, factory.Database.Parties.ToArray(), default);
        Assert.IsTrue(
            preview.Ready,
            string.Join("; ", preview.Issues.Select(issue => issue.Message))
        );
        var returns = preview
            .Parties.Single()
            .Requests.Where(query =>
                query.Body.SearchKind == "oneWay" && query.Body.Destination == "BOS"
            )
            .ToArray();
        Assert.IsNotEmpty(returns);
        Assert.IsTrue(
            returns.All(query =>
                query.Body.DepartureDate >= new DateOnly(2030, 6, 20).AddDays(-flex)
                && query.Body.DepartureDate <= new DateOnly(2030, 6, 20).AddDays(flex)
            )
        );
        var dates = await client.PutAsJsonAsync(
            $"{collection}/{paris.Id}/stays/{document.Visits[0].Id}",
            new { arrivalDate = "2030-06-09", departureDate = "2030-06-13" }
        );
        dates.EnsureSuccessStatusCode();
        var updated = (await client.GetFromJsonAsync<PlanningDocument>(constraintsUrl))!;
        Assert.AreEqual(new DateOnly(2030, 6, 9), updated.Visits[0].PresentFrom);
        var search = await client.PostAsJsonAsync(
            $"/trips/{trip.Id}/flights:search",
            new StartFlightSearchRequest(Guid.NewGuid())
        );
        Assert.AreEqual(
            HttpStatusCode.Accepted,
            search.StatusCode,
            await search.Content.ReadAsStringAsync()
        );
    }

    [TestMethod]
    [DataRow(-1)]
    [DataRow(6)]
    public void PerDestinationFlexibilityIsBounded(int days)
    {
        var planner = new TripPlanner.Api.Services.Flights.MultiCityPlanner(
            new(),
            TimeProvider.System
        );
        var document = new PlanningDocument
        {
            Visits = [new() { Id = Guid.NewGuid(), ArrivalFlexibilityDays = days }],
        };
        Assert.IsTrue(
            planner
                .Validate(document, [], false)
                .Any(issue => issue.Message.Contains("flexibility"))
        );
    }
}
