using System.Net;
using System.Net.Http.Json;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Endpoints;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Flights;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Services.Flights;

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
            "/user/profile",
            new UserProfile(new("Atlanta", -84.388, 33.749), [], "ATL")
        );
        profileResponse.EnsureSuccessStatusCode();
        var user = (await profileResponse.Content.ReadFromJsonAsync<CurrentUserResponse>())!;
        var tripResponse = await client.PostAsJsonAsync(
            $"/user/{user.Id}/trips",
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
            await client.PutAsJsonAsync($"/trips/{trip.Id}/flights/constraints", document)
        ).EnsureSuccessStatusCode();
        var path = $"/trips/{trip.Id}/flights/search";
        Assert.AreEqual(HttpStatusCode.NotFound, (await client.GetAsync(path)).StatusCode);
        var response = await client.PostAsJsonAsync(
            $"/trips/{trip.Id}/flights:search",
            new StartFlightSearchRequest(Guid.NewGuid())
        );
        Assert.AreEqual(HttpStatusCode.Accepted, response.StatusCode);
        var operation = (await response.Content.ReadFromJsonAsync<TrackedOperation>())!;
        var available = Fares()
            .ToDictionary(f => SearchPlanBuilder.CacheKey(f.Request), f => f.Response);
        var firstCacheKey = SearchPlanBuilder.CacheKey(Fares()[0].Request);
        var choiceKey = BrowserLegKey(
            Fares()[0].Response.GetProperty("itineraries")[0].GetProperty("outbound")
        );
        var firstFareReady = false;
        while (await factory.Database.ClaimFareWorkAsync(TimeSpan.FromMinutes(2)) is { } work)
        {
            await factory.Database.CompleteFareWorkAsync(
                work,
                available.GetValueOrDefault(
                    work.CacheKey,
                    JsonSerializer.SerializeToElement(new { itineraries = Array.Empty<object>() })
                ),
                DateTimeOffset.UtcNow,
                null
            );
            if (work.CacheKey == firstCacheKey)
            {
                firstFareReady = true;
                break;
            }
        }
        Assert.IsTrue(firstFareReady);
        var choicesPath = $"/trips/{trip.Id}/flights/choices/{party.Id}";
        var choiceResponse = await client.PutAsJsonAsync(
            choicesPath,
            new SetFlightChoicesRequest([choiceKey])
        );
        Assert.AreEqual(HttpStatusCode.OK, choiceResponse.StatusCode);
        CollectionAssert.Contains(
            (
                await client.GetFromJsonAsync<FlightChoiceProgress[]>(
                    $"/trips/{trip.Id}/flights/choices"
                )
            )!
                .Single()
                .NextOrigins,
            "HKT"
        );
        var prioritized = await factory.Database.ClaimFareWorkAsync(TimeSpan.FromMinutes(2));
        Assert.IsNotNull(prioritized);
        Assert.AreEqual("HKT", prioritized.Request.Origin);
        await factory.Database.CompleteFareWorkAsync(
            prioritized,
            available.GetValueOrDefault(
                prioritized.CacheKey,
                JsonSerializer.SerializeToElement(new { itineraries = Array.Empty<object>() })
            ),
            DateTimeOffset.UtcNow,
            null
        );
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
        var selectionPath = $"/trips/{trip.Id}/flights";
        var selection = await client.PutAsJsonAsync(
            $"{selectionPath}/{party.Id}",
            new SelectFlightRequest(fares[0].CacheKey, 0)
        );
        Assert.AreEqual(HttpStatusCode.OK, selection.StatusCode);
        var saved = (await client.GetFromJsonAsync<SelectedFlight[]>(selectionPath))!.Single();
        Assert.AreEqual(4, saved.Itinerary.GetProperty("legs").GetArrayLength());
        Assert.AreEqual(3, saved.Itinerary.GetProperty("bookingOffers").GetArrayLength());
        // Composed result keys and indexes can change while new fares arrive.
        var legKeys = saved
            .Itinerary.GetProperty("legs")
            .EnumerateArray()
            .Select(FlightChoiceRoute.FlightKey)
            .Select(key => key!)
            .ToArray();
        decimal quote = saved.Itinerary.GetProperty("price").GetProperty("amount").GetDecimal();
        string currency = saved.Itinerary.GetProperty("price").GetProperty("currency").GetString()!;
        var stableSelection = await client.PutAsJsonAsync(
            $"{selectionPath}/{party.Id}",
            new SelectFlightRequest("older-composition", 999, legKeys, quote, currency)
        );
        Assert.AreEqual(
            HttpStatusCode.OK,
            stableSelection.StatusCode,
            await stableSelection.Content.ReadAsStringAsync()
        );
        var persisted = (await client.GetFromJsonAsync<SelectedFlight[]>(selectionPath))!.Single();
        Assert.AreEqual(saved.Itinerary.GetRawText(), persisted.Itinerary.GetRawText());
        var changedQuote = await client.PutAsJsonAsync(
            $"{selectionPath}/{party.Id}",
            new SelectFlightRequest("older-composition", 999, legKeys, quote + 1, currency)
        );
        Assert.AreEqual(HttpStatusCode.Conflict, changedQuote.StatusCode);
        var cached = await client.PostAsJsonAsync(
            $"/trips/{trip.Id}/flights:search",
            new StartFlightSearchRequest(Guid.NewGuid())
        );
        Assert.AreEqual(
            "Completed",
            (await cached.Content.ReadFromJsonAsync<TrackedOperation>())!.Status
        );
        Assert.IsNull(await factory.Database.ClaimFareWorkAsync(TimeSpan.FromMinutes(2)));
    }

    [TestMethod]
    [DataRow(0)]
    [DataRow(1)]
    [DataRow(3)]
    public async Task PartialChoicesSurviveExpiryAndOnlyUnselectedLegsAreSearched(int selectedIndex)
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Subject", "saved-route-owner");
        client.DefaultRequestHeaders.Add("X-Test-Email", "saved-route@example.com");
        var profile = await client.PutAsJsonAsync(
            "/user/profile",
            new UserProfile(new("Atlanta", -84.388, 33.749), [], "ATL")
        );
        profile.EnsureSuccessStatusCode();
        var user = (await profile.Content.ReadFromJsonAsync<CurrentUserResponse>())!;
        var created = await client.PostAsJsonAsync(
            $"/user/{user.Id}/trips",
            new CreateTripRequest("Saved flights", "")
        );
        created.EnsureSuccessStatusCode();
        var trip = (await created.Content.ReadFromJsonAsync<Trip>())!;
        var party = factory.Database.Parties.Single();
        var document = Wedding() with
        {
            Parties = [new() { PartyId = party.Id, Origin = _airports.Resolve("ATL") }],
        };
        (
            await client.PutAsJsonAsync($"/trips/{trip.Id}/flights/constraints", document)
        ).EnsureSuccessStatusCode();
        var clock = new OperationFixture.TestClock();
        factory.Database.OperationClock = clock;
        var offers = Fares()
            .ToDictionary(fare => SearchPlanBuilder.CacheKey(fare.Request), fare => fare.Response);
        async Task<List<IgnavFareRequest>> Search()
        {
            (
                await client.PostAsJsonAsync(
                    $"/trips/{trip.Id}/flights:search",
                    new StartFlightSearchRequest(Guid.NewGuid())
                )
            ).EnsureSuccessStatusCode();
            var searched = new List<IgnavFareRequest>();
            while (await factory.Database.ClaimFareWorkAsync(TimeSpan.FromMinutes(2)) is { } work)
            {
                searched.Add(work.Request);
                await factory.Database.CompleteFareWorkAsync(
                    work,
                    offers.GetValueOrDefault(
                        work.CacheKey,
                        JsonSerializer.SerializeToElement(
                            new { itineraries = Array.Empty<object>() }
                        )
                    ),
                    clock.GetUtcNow(),
                    null
                );
            }
            return searched;
        }
        await Search();
        var keys = Fares()
            .Take(4)
            .Select(fare =>
                FlightChoiceRoute.FlightKey(
                    fare.Response.GetProperty("itineraries")[0].GetProperty("outbound")
                )!
            )
            .ToArray();
        var partial = new string?[selectedIndex + 1];
        partial[selectedIndex] = keys[selectedIndex];
        var choicesUrl = $"/trips/{trip.Id}/flights/choices/{party.Id}";
        var saved = await client.PutAsJsonAsync(choicesUrl, new SetFlightChoicesRequest(partial));
        Assert.AreEqual(
            HttpStatusCode.OK,
            saved.StatusCode,
            await saved.Content.ReadAsStringAsync()
        );
        Assert.IsFalse(
            (await saved.Content.ReadFromJsonAsync<JsonElement>()).TryGetProperty(
                "savedFares",
                out _
            )
        );
        clock.Advance(TimeSpan.FromHours(2));
        var restored = (
            await client.GetFromJsonAsync<FlightChoiceProgressDto[]>(
                $"/trips/{trip.Id}/flights/choices"
            )
        )!.Single();
        CollectionAssert.AreEqual(partial, restored.LegKeys);
        Assert.HasCount(1, restored.Flights);
        Assert.AreEqual(selectedIndex, restored.Flights[0].LegIndex);
        Assert.AreEqual(keys[selectedIndex], FlightChoiceRoute.FlightKey(restored.Flights[0].Leg));
        var grid = (
            await client.GetFromJsonAsync<EvaluatedFareSearchResultDto[]>(
                $"/trips/{trip.Id}/flights/search"
            )
        )!.Single();
        Assert.IsTrue(
            grid.Response.GetProperty("flights")
                .EnumerateArray()
                .Any(flight =>
                    flight.GetProperty("legIndex").GetInt32() == selectedIndex
                    && FlightChoiceRoute.FlightKey(flight.GetProperty("leg")) == keys[selectedIndex]
                )
        );
        Assert.AreEqual(0, grid.Response.GetProperty("itineraries").GetArrayLength());
        var searched = await Search();
        var selectedRequest = Fares()[selectedIndex].Request;
        Assert.IsFalse(
            searched.Any(request =>
                request.SearchKind == "oneWay"
                && request.Origin == selectedRequest.Origin
                && request.Destination == selectedRequest.Destination
            )
        );
        Assert.IsGreaterThan(0, searched.Count);
        if (selectedIndex is 0 or 3)
        {
            Assert.IsFalse(searched.Any(request => request.SearchKind == "flexible"));
        }
        // Saving the remaining legs can combine fresh results with the expired saved offer.
        (
            await client.PutAsJsonAsync(choicesUrl, new SetFlightChoicesRequest(keys))
        ).EnsureSuccessStatusCode();
        var automaticallySelected = (
            await client.GetFromJsonAsync<SelectedFlight[]>($"/trips/{trip.Id}/flights")
        )!.Single();
        CollectionAssert.AreEqual(
            keys,
            automaticallySelected
                .Itinerary.GetProperty("legs")
                .EnumerateArray()
                .Select(FlightChoiceRoute.FlightKey)
                .ToArray()
        );
        clock.Advance(TimeSpan.FromHours(2));
        Assert.HasCount(0, await Search());
        var complete = (
            await client.GetFromJsonAsync<EvaluatedFareSearchResultDto[]>(
                $"/trips/{trip.Id}/flights/search"
            )
        )!.Single();
        Assert.IsGreaterThan(0, complete.Response.GetProperty("itineraries").GetArrayLength());
        Assert.AreEqual(
            900m,
            complete
                .Response.GetProperty("itineraries")[0]
                .GetProperty("price")
                .GetProperty("amount")
                .GetDecimal()
        );
        // No separate itinerary-save request is needed after choosing all legs.
        // Clearing the resource drops snapshots and makes every leg searchable again.
        (
            await client.PutAsJsonAsync(choicesUrl, new SetFlightChoicesRequest([]))
        ).EnsureSuccessStatusCode();
        Assert.HasCount(
            0,
            (await factory.Database.GetFlightChoicesAsync(user.Id!.Value, trip.Id))
                .Single()
                .SavedFares
        );
        Assert.AreEqual(
            HttpStatusCode.NoContent,
            (await client.GetAsync($"/trips/{trip.Id}/flights")).StatusCode
        );
        var reopened = await Search();
        Assert.IsTrue(
            reopened.Any(request =>
                request.SearchKind == "oneWay"
                && request.Origin == selectedRequest.Origin
                && request.Destination == selectedRequest.Destination
            )
        );
    }

    [TestMethod]
    public async Task LongRouteCanSearchChooseSaveAndMarkEveryFlightPurchased()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Subject", "long-route-owner");
        client.DefaultRequestHeaders.Add("X-Test-Email", "long-route@example.com");
        var profile = await client.PutAsJsonAsync(
            "/user/profile",
            new UserProfile(new("Atlanta", -84.388, 33.749), [], "ATL")
        );
        profile.EnsureSuccessStatusCode();
        var user = (await profile.Content.ReadFromJsonAsync<CurrentUserResponse>())!;
        var created = await client.PostAsJsonAsync(
            $"/user/{user.Id}/trips",
            new CreateTripRequest("Long route", "")
        );
        created.EnsureSuccessStatusCode();
        var trip = (await created.Content.ReadFromJsonAsync<Trip>())!;
        var party = factory.Database.Parties.Single();
        var start = new DateOnly(2030, 5, 1);
        var codes = new[] { "JFK", "BOS", "IAD", "JFK", "BOS" };
        var document = new PlanningDocument
        {
            TravelDates = new(start, null),
            Visits = codes
                .Select(
                    (code, index) =>
                        new PlannedVisit
                        {
                            Id = Guid.NewGuid(),
                            Location = _airports.Resolve(code),
                            PresentFrom = start.AddDays(index),
                            PresentThrough = start.AddDays(index + 1),
                            ArrivalFlexibilityDays = 0,
                            DepartureFlexibilityDays = 0,
                        }
                )
                .ToArray(),
            Parties = [new() { PartyId = party.Id, Origin = _airports.Resolve("ATL") }],
        };
        (
            await client.PutAsJsonAsync($"/trips/{trip.Id}/flights/constraints", document)
        ).EnsureSuccessStatusCode();
        (
            await client.PostAsJsonAsync(
                $"/trips/{trip.Id}/flights:search",
                new StartFlightSearchRequest(Guid.NewGuid())
            )
        ).EnsureSuccessStatusCode();
        while (await factory.Database.ClaimFareWorkAsync(TimeSpan.FromMinutes(2)) is { } work)
        {
            var request = work.Request;
            object[] itineraries =
                request.SearchKind == "oneWay"
                    ?
                    [
                        new
                        {
                            ignav_id = work.CacheKey,
                            price = new
                            {
                                amount = 100,
                                currency = "USD",
                                status = "verified",
                            },
                            outbound = new
                            {
                                segments = new[]
                                {
                                    new
                                    {
                                        departure_airport = request.Origin,
                                        arrival_airport = request.Destination,
                                        departure_time_local = $"{request.DepartureDate:yyyy-MM-dd}T10:00:00",
                                        arrival_time_local = $"{request.DepartureDate:yyyy-MM-dd}T12:00:00",
                                        departure_time_utc = $"{request.DepartureDate:yyyy-MM-dd}T14:00:00Z",
                                        arrival_time_utc = $"{request.DepartureDate:yyyy-MM-dd}T16:00:00Z",
                                        marketing_carrier_code = "AA",
                                        flight_number = "100",
                                    },
                                },
                            },
                        },
                    ]
                    : [];
            await factory.Database.CompleteFareWorkAsync(
                work,
                JsonSerializer.SerializeToElement(new { itineraries }),
                DateTimeOffset.UtcNow,
                null
            );
        }
        var result = (
            await client.GetFromJsonAsync<EvaluatedFareSearchResultDto[]>(
                $"/trips/{trip.Id}/flights/search"
            )
        )!.Single();
        var itinerary = result.Response.GetProperty("itineraries")[0];
        var keys = itinerary.GetProperty("legs").EnumerateArray().Select(BrowserLegKey).ToArray();
        Assert.HasCount(6, keys);
        var grid = result.Response.GetProperty("flights").EnumerateArray().ToArray();
        CollectionAssert.AreEqual(
            new[] { 0, 1, 2, 3, 4, 5 },
            grid.Select(f => f.GetProperty("legIndex").GetInt32()).ToArray()
        );
        for (var index = 0; index < grid.Length; index++)
        {
            Assert.AreEqual(
                $"{start.AddDays(index):yyyy-MM-dd}T10:00:00",
                grid[index]
                    .GetProperty("leg")
                    .GetProperty("segments")[0]
                    .GetProperty("departure_time_local")
                    .GetString()
            );
        }
        (
            await client.PutAsJsonAsync(
                $"/trips/{trip.Id}/flights/choices/{party.Id}",
                new SetFlightChoicesRequest(keys)
            )
        ).EnsureSuccessStatusCode();
        var savedResponse = await client.PutAsJsonAsync(
            $"/trips/{trip.Id}/flights/{party.Id}",
            new SelectFlightRequest(result.CacheKey, 0, keys, 600, "USD")
        );
        savedResponse.EnsureSuccessStatusCode();
        var saved = (await savedResponse.Content.ReadFromJsonAsync<SelectedFlight>())!;
        var purchased = await client.PutAsJsonAsync(
            $"/trips/{trip.Id}/flights/{party.Id}/purchases",
            new SetFlightPurchasesRequest(
                saved.CacheKey,
                saved.ItineraryIndex,
                Enumerable.Repeat(true, keys.Length).ToArray()
            )
        );
        purchased.EnsureSuccessStatusCode();
        Assert.IsTrue(
            (await purchased.Content.ReadFromJsonAsync<SelectedFlight>())!.PurchasedLegs!.All(
                value => value
            )
        );
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
        {
            Assert.IsTrue(
                queries.Any(q =>
                    q.Body.SearchKind == "oneWay"
                    && q.Body.Origin == edge.Item1
                    && q.Body.Destination == edge.Item2
                    && q.Body.DepartureDate == new DateOnly(2030, 5, edge.Item3)
                ),
                $"Missing {edge}"
            );
        }

        Assert.IsNull(document.TravelDates);
    }

    [TestMethod]
    public void RouteBudgetSpreadsAcrossAllLegs()
    {
        var requests = new MultiCityPlanner(_airports, TimeProvider.System, 160)
            .Build(Wedding(), [Party], default)
            .Parties.Single()
            .Requests;
        Assert.IsGreaterThan(40, requests.Count);
        foreach (
            var (origin, destination) in new[]
            {
                ("ATL", "HKT"),
                ("HKT", "HKG"),
                ("HKG", "HND"),
                ("HND", "ATL"),
            }
        )
        {
            Assert.IsGreaterThan(
                1,
                requests.Count(q =>
                    q.Body.SearchKind == "oneWay"
                    && q.Body.Origin == origin
                    && q.Body.Destination == destination
                ),
                $"Expected more than one dated search for {origin} to {destination}."
            );
        }
    }

    [TestMethod]
    public void FlightChoiceUsesDestinationAirportsEvenWhenSearchCoverageIsIncomplete()
    {
        var newYork = new PlannedVisit
        {
            Id = Guid.NewGuid(),
            Location = _airports.Resolve("New York"),
            Nights = 3,
        };
        var hongKong = new PlannedVisit
        {
            Id = Guid.NewGuid(),
            Location = _airports.Resolve("HKG"),
            Nights = 3,
            AfterVisitIds = [newYork.Id],
        };
        var document = new PlanningDocument
        {
            Visits = [newYork, hongKong],
            Parties = [new() { PartyId = _party, Origin = _airports.Resolve("ATL") }],
        };
        FareSearchResult Fare(
            string searchedOrigin,
            string searchedDestination,
            string actualOrigin,
            string actualDestination
        ) =>
            new(
                _party,
                Guid.NewGuid().ToString(),
                new(
                    searchedOrigin,
                    searchedDestination,
                    new(2030, 5, 1),
                    new(2030, 5, 1),
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
                                            departure_airport = actualOrigin,
                                            arrival_airport = actualDestination,
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
        var fares = new[]
        {
            Fare("ATL", "NYC", "PDK", "JFK"),
            Fare("NYC", "HKG", "LGA", "HKG"),
            Fare("HKG", "ATL", "HKG", "ATL"),
        };
        var keys = fares
            .Select(f =>
                BrowserLegKey(f.Response.GetProperty("itineraries")[0].GetProperty("outbound"))
            )
            .ToArray();

        var next = FlightChoiceRoute.NextOrigins(document, _party, [keys[0]], fares, _airports);
        Assert.IsNotNull(next);
        CollectionAssert.IsSubsetOf(new[] { "JFK", "LGA", "EWR", "NYC" }, next);
        CollectionAssert.AreEqual(
            new[] { "HKG" },
            FlightChoiceRoute.NextOrigins(document, _party, keys[..2], fares, _airports)
        );
        CollectionAssert.AreEqual(
            Array.Empty<string>(),
            FlightChoiceRoute.NextOrigins(document, _party, keys, fares, _airports)
        );
        Assert.IsNull(FlightChoiceRoute.NextOrigins(document, _party, [keys[1]], fares, _airports));

        var paired = fares[0] with
        {
            Request = fares[0].Request with
            {
                SearchKind = "flexible",
                Legs =
                [
                    new("ATL", "NYC", new(2030, 5, 1), null),
                    new("HKG", "ATL", new(2030, 5, 1), null),
                ],
            },
            Response = JsonSerializer.SerializeToElement(
                new
                {
                    itineraries = new[]
                    {
                        new
                        {
                            legs = new[]
                            {
                                fares[0]
                                    .Response.GetProperty("itineraries")[0]
                                    .GetProperty("outbound"),
                                fares[2]
                                    .Response.GetProperty("itineraries")[0]
                                    .GetProperty("outbound"),
                            },
                        },
                    },
                }
            ),
        };
        CollectionAssert.Contains(
            FlightChoiceRoute.NextOrigins(document, _party, [keys[0]], [paired], _airports)!,
            "NYC"
        );
    }

    [TestMethod]
    public async Task FlightChoiceAcceptsMetroArrivalWithoutAnAirportSpecificNextSearch()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Subject", "metro-owner");
        client.DefaultRequestHeaders.Add("X-Test-Email", "metro-owner@example.com");
        var profile = await client.PutAsJsonAsync(
            "/user/profile",
            new UserProfile(new("Atlanta", -84.388, 33.749), [], "ATL")
        );
        profile.EnsureSuccessStatusCode();
        var user = (await profile.Content.ReadFromJsonAsync<CurrentUserResponse>())!;
        var created = await client.PostAsJsonAsync(
            $"/user/{user.Id}/trips",
            new CreateTripRequest("Metro connection", "")
        );
        created.EnsureSuccessStatusCode();
        var trip = (await created.Content.ReadFromJsonAsync<Trip>())!;
        var party = factory.Database.Parties.Single();
        var firstVisit = new PlannedVisit
        {
            Id = Guid.NewGuid(),
            Location = _airports.Resolve("New York"),
            Nights = 3,
        };
        var document = new PlanningDocument
        {
            TravelDates = new(new(2030, 5, 1), null),
            Visits =
            [
                firstVisit,
                new PlannedVisit
                {
                    Id = Guid.NewGuid(),
                    Location = _airports.Resolve("HKG"),
                    Nights = 3,
                    AfterVisitIds = [firstVisit.Id],
                },
            ],
            Parties = [new() { PartyId = party.Id, Origin = _airports.Resolve("ATL") }],
        };
        (
            await client.PutAsJsonAsync($"/trips/{trip.Id}/flights/constraints", document)
        ).EnsureSuccessStatusCode();
        var preview = new MultiCityPlanner(_airports, TimeProvider.System).Build(
            document,
            [party],
            default
        );
        var firstRequest = preview
            .Parties.Single()
            .Requests.First(search =>
                search.Body.SearchKind == "oneWay"
                && search.Body.Origin == "ATL"
                && search.Body.Destination == "NYC"
                && search.Body.SearchPriority == 0
            );
        var searchResponse = await client.PostAsJsonAsync(
            $"/trips/{trip.Id}/flights:search",
            new StartFlightSearchRequest(Guid.NewGuid())
        );
        Assert.AreEqual(HttpStatusCode.Accepted, searchResponse.StatusCode);
        var fareResponse = JsonSerializer.SerializeToElement(
            new
            {
                itineraries = new[]
                {
                    new
                    {
                        price = new
                        {
                            amount = 150,
                            currency = "USD",
                            status = "verified",
                        },
                        outbound = new
                        {
                            segments = new[]
                            {
                                new
                                {
                                    departure_airport = "PDK",
                                    arrival_airport = "JFK",
                                    departure_time_local = "2030-05-01T09:00:00",
                                    arrival_time_local = "2030-05-01T12:00:00",
                                    marketing_carrier_code = "DL",
                                    flight_number = "DL1",
                                },
                            },
                        },
                    },
                },
            }
        );
        var firstFareReady = false;
        while (await factory.Database.ClaimFareWorkAsync(TimeSpan.FromMinutes(2)) is { } work)
        {
            await factory.Database.CompleteFareWorkAsync(
                work,
                work.CacheKey == firstRequest.CacheKey
                    ? fareResponse
                    : JsonSerializer.SerializeToElement(
                        new { itineraries = Array.Empty<object>() }
                    ),
                DateTimeOffset.UtcNow,
                null
            );
            if (work.CacheKey == firstRequest.CacheKey)
            {
                firstFareReady = true;
                break;
            }
        }
        Assert.IsTrue(firstFareReady);
        var key = BrowserLegKey(fareResponse.GetProperty("itineraries")[0].GetProperty("outbound"));
        var response = await client.PutAsJsonAsync(
            $"/trips/{trip.Id}/flights/choices/{party.Id}",
            new SetFlightChoicesRequest([key])
        );
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        var saved = (await response.Content.ReadFromJsonAsync<FlightChoiceProgress>())!;
        CollectionAssert.Contains(saved.NextOrigins, "NYC");
    }

    [TestMethod]
    public void VisitOrderingAlwaysUsesSavedSequenceIncludingLegacyHints()
    {
        var document = Wedding();
        foreach (
            var visits in new[]
            {
                document.Visits,
                document.Visits.Select(v => v with { AfterVisitIds = [] }).ToArray(),
                document
                    .Visits.Select(v =>
                        v with
                        {
                            AfterVisitIds = document
                                .Visits.Where(other => other.Id != v.Id)
                                .Select(other => other.Id)
                                .ToArray(),
                        }
                    )
                    .ToArray(),
            }
        )
        {
            var order = MultiCityPlanner.Orders(visits).Single();
            CollectionAssert.AreEqual(
                visits.Select(v => v.Id).ToArray(),
                order.Select(v => v.Id).ToArray()
            );
            Assert.IsTrue(
                new MultiCityPlanner(_airports, TimeProvider.System)
                    .Build(document with { Visits = visits }, [Party], default)
                    .Ready
            );
        }
    }

    [TestMethod]
    [DataRow(4)]
    [DataRow(12)]
    [DataRow(80)]
    public void EveryDestinationGetsSearchCoverageEvenBeyondTheRequestBudget(int count)
    {
        var codes = new[] { "JFK", "BOS", "IAD" };
        var start = new DateOnly(2030, 5, 1);
        var visits = Enumerable
            .Range(0, count)
            .Select(index => new PlannedVisit
            {
                Id = Guid.NewGuid(),
                Location = _airports.Resolve(codes[index % codes.Length]),
                PresentFrom = start.AddDays(index * 2 + 1),
                PresentThrough = start.AddDays(index * 2 + 2),
                ArrivalFlexibilityDays = 0,
                DepartureFlexibilityDays = 0,
            })
            .ToArray();
        var document = Wedding() with
        {
            Visits = visits,
            TravelDates = new(start, null),
            SearchLimits = new() { MaxTripDays = count * 2 + 2 },
        };
        var plan = new MultiCityPlanner(_airports, TimeProvider.System, 4).Build(
            document,
            [Party],
            default
        );
        Assert.IsTrue(plan.Ready, string.Join("; ", plan.Issues.Select(i => i.Message)));
        var requests = plan.Parties.Single().Requests;
        Assert.HasCount(count + 1, requests);
        var locations = new[] { "ATL" }
            .Concat(visits.Select(v => v.Location!.Code))
            .Append("ATL")
            .ToArray();
        for (var index = 0; index <= count; index++)
        {
            Assert.IsTrue(
                requests.Any(q =>
                    q.Body.Origin == locations[index]
                    && q.Body.Destination == locations[index + 1]
                    && (index == 0 || q.Body.DepartureDate == visits[index - 1].PresentThrough)
                ),
                $"Missing leg {index}"
            );
        }
    }

    [TestMethod]
    public void GridFlightsArriveInEveryColumnBeforeACompleteRouteExists()
    {
        var document = Wedding();
        var fares = Fares();
        var composer = new RouteFareComposer(_airports);
        var partial = composer.Compose(document, [Party], [fares[2], fares[4]]).Single();
        Assert.AreEqual(0, partial.Response.GetProperty("itineraries").GetArrayLength());
        var flights = partial.Response.GetProperty("flights").EnumerateArray().ToArray();
        CollectionAssert.AreEquivalent(
            new[] { 0, 2, 3 },
            flights.Select(f => f.GetProperty("legIndex").GetInt32()).ToArray()
        );
        Assert.AreEqual(
            2,
            flights
                .Single(f => f.GetProperty("legIndex").GetInt32() == 0)
                .GetProperty("bookingLegCount")
                .GetInt32()
        );
        var complete = composer.Compose(document, [Party], fares).Single();
        Assert.IsGreaterThan(0, complete.Response.GetProperty("itineraries").GetArrayLength());
        CollectionAssert.AreEquivalent(
            new[] { 0, 1, 2, 3 },
            complete
                .Response.GetProperty("flights")
                .EnumerateArray()
                .Select(f => f.GetProperty("legIndex").GetInt32())
                .ToArray()
        );
    }

    [TestMethod]
    [DataRow("verified")]
    [DataRow("unverified")]
    [DataRow(null)]
    public void ComposedPrices_PreserveVerificationIncludingMissingProviderStatus(string? status)
    {
        var fares = Fares();
        // This one-way offer is required by every complete itinerary.
        var response = JsonNode.Parse(fares[1].Response.GetRawText())!;
        var price = response["itineraries"]![0]!["price"]!.AsObject();
        if (status is null)
        {
            price.Remove("status");
        }
        else
        {
            price["status"] = status;
        }
        fares[1] = fares[1] with { Response = JsonSerializer.SerializeToElement(response) };
        var composer = new RouteFareComposer(_airports);
        var result = composer.Compose(Wedding(), [Party], fares).Single().Response;
        var expected = status == "verified" ? "verified" : "unverified";
        var itineraries = result.GetProperty("itineraries").EnumerateArray().ToArray();
        Assert.IsGreaterThan(0, itineraries.Length);
        foreach (var itinerary in itineraries)
        {
            Assert.AreEqual(
                expected,
                itinerary.GetProperty("price").GetProperty("status").GetString()
            );
            var booking = itinerary
                .GetProperty("bookingOffers")
                .EnumerateArray()
                .Single(b => b.GetProperty("ignavId").GetString() == "fare-1");
            Assert.AreEqual(
                expected,
                booking.GetProperty("price").GetProperty("status").GetString()
            );
        }
        var flight = result
            .GetProperty("flights")
            .EnumerateArray()
            .Single(f => f.GetProperty("legIndex").GetInt32() == 1);
        Assert.AreEqual(expected, flight.GetProperty("price").GetProperty("status").GetString());
        var costs = result
            .GetProperty("routeGraphs")
            .EnumerateArray()
            .SelectMany(g => g.GetProperty("costs").EnumerateArray())
            .Where(c => c.GetProperty("ignavId").GetString() == "fare-1")
            .ToArray();
        Assert.IsGreaterThan(0, costs.Length);
        Assert.IsTrue(costs.All(c => c.GetProperty("status").GetString() == expected));
        var choice = new FlightChoiceProgress(
            _party,
            itineraries[0].GetProperty("legs").EnumerateArray().Select(BrowserLegKey).ToArray(),
            []
        )
        {
            SavedFares = fares,
        };
        var saved = composer
            .ChoiceBookings(Wedding(), Party, choice)
            .Single(b => b.IgnavId == "fare-1");
        Assert.AreEqual(expected, saved.Price.Status);
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

    [TestMethod]
    public void ChosenRoutePrefixKeepsAlternativesForTheNextLeg()
    {
        var document = Wedding();
        var fares = Fares();
        var firstResponse = JsonNode.Parse(fares[0].Response.GetRawText())!;
        firstResponse["itineraries"]![0]!["outbound"]!["segments"]![0]!["departure_time_utc"] =
            "2030-05-01T13:00:00+00:00";
        fares[0] = fares[0] with { Response = JsonSerializer.SerializeToElement(firstResponse) };
        var pairedResponse = JsonNode.Parse(fares[4].Response.GetRawText())!;
        pairedResponse["itineraries"]![0]!["legs"]![0]!["segments"]![0]!["departure_time_utc"] =
            "2030-05-01T13:00:00+00:00";
        fares[4] = fares[4] with { Response = JsonSerializer.SerializeToElement(pairedResponse) };
        var alternateResponse = JsonNode.Parse(fares[1].Response.GetRawText())!;
        var alternate = alternateResponse["itineraries"]![0]!.DeepClone();
        alternate["ignav_id"] = "fare-middle-alternate";
        alternate["price"]!["amount"] = 150;
        alternate["outbound"]!["segments"]![0]!["flight_number"] = "AA2";
        alternateResponse["itineraries"]!.AsArray().Add(alternate);
        fares[1] = fares[1] with
        {
            Response = JsonSerializer.SerializeToElement(alternateResponse),
        };

        var composer = new RouteFareComposer(_airports);
        var initial = composer.Compose(document, [Party], fares).Single();
        var first = initial.Response.GetProperty("itineraries")[0].GetProperty("legs")[0];
        var key = BrowserLegKey(first);
        StringAssert.Contains(key, "+00:00");
        var focused = composer
            .Compose(document, [Party], fares, [new FlightChoiceProgress(_party, [key], [])])
            .Single();
        Assert.AreNotEqual(initial.CacheKey, focused.CacheKey);
        var secondFlights = focused
            .Response.GetProperty("itineraries")
            .EnumerateArray()
            .Select(itinerary =>
                itinerary
                    .GetProperty("legs")[1]
                    .GetProperty("segments")[0]
                    .GetProperty("flight_number")
                    .GetString()
            )
            .Distinct()
            .ToArray();
        CollectionAssert.AreEquivalent(new[] { "AA1", "AA2" }, secondFlights);
    }

    [TestMethod]
    [DataRow(false)]
    [DataRow(true)]
    public async Task PartialBookingLinksAndPurchasesUseWholeSavedOffers(bool paired)
    {
        var provider = new ChoiceBookingClient();
        await using var factory = new TestApplicationFactory { FlightClient = provider };
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Subject", "partial-booking-owner");
        client.DefaultRequestHeaders.Add("X-Test-Email", "partial-booking@example.com");
        var profile = await client.PutAsJsonAsync(
            "/user/profile",
            new UserProfile(new("Atlanta", -84.388, 33.749), [], "ATL")
        );
        profile.EnsureSuccessStatusCode();
        var user = (await profile.Content.ReadFromJsonAsync<CurrentUserResponse>())!;
        var created = await client.PostAsJsonAsync(
            $"/user/{user.Id}/trips",
            new CreateTripRequest("Partial booking", "")
        );
        created.EnsureSuccessStatusCode();
        var trip = (await created.Content.ReadFromJsonAsync<Trip>())!;
        var party = factory.Database.Parties.Single();
        var document = Wedding() with
        {
            Parties = [new() { PartyId = party.Id, Origin = _airports.Resolve("ATL") }],
        };
        (
            await client.PutAsJsonAsync($"/trips/{trip.Id}/flights/constraints", document)
        ).EnsureSuccessStatusCode();
        var fares = Fares()
            .Select(fare =>
                fare with
                {
                    PartyId = party.Id,
                    CacheKey = SearchPlanBuilder.CacheKey(fare.Request),
                    ExpiresAt = DateTimeOffset.UtcNow.AddHours(-2),
                }
            )
            .ToArray();
        var keys = fares
            .Take(4)
            .Select(fare =>
                FlightChoiceRoute.FlightKey(
                    fare.Response.GetProperty("itineraries")[0].GetProperty("outbound")
                )!
            )
            .ToArray();
        string?[] partial = [keys[0]];
        await factory.Database.SetFlightChoicesAsync(
            user.Id!.Value,
            trip.Id,
            new(party.Id, partial, [])
            {
                SavedFares = SavedFlightChoices.Capture(party.Id, partial, fares),
            }
        );
        var path = $"/trips/{trip.Id}/flights/choices/{party.Id}";
        Assert.AreEqual(
            HttpStatusCode.Conflict,
            (
                await client.PostAsJsonAsync(
                    path + "/bookingLinks",
                    new BookingLinksRequest("open-jaw")
                )
            ).StatusCode
        );
        Assert.IsEmpty(provider.Calls);
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (
                await client.PutAsJsonAsync(
                    path,
                    new SetFlightChoicesRequest(partial, ["open-jaw"])
                )
            ).StatusCode
        );
        if (paired)
        {
            partial = [keys[0], null, null, keys[3]];
            (
                await client.PutAsJsonAsync(path, new SetFlightChoicesRequest(partial))
            ).EnsureSuccessStatusCode();
        }
        var id = paired ? "open-jaw" : "fare-0";
        var choice = (
            await client.GetFromJsonAsync<FlightChoiceProgressDto[]>(
                $"/trips/{trip.Id}/flights/choices"
            )
        )!.Single();
        CollectionAssert.AreEqual(
            paired ? new[] { 0, 3 } : [0],
            choice.Bookings.Single(booking => booking.IgnavId == id).LegIndexes
        );
        Assert.AreEqual(
            HttpStatusCode.Conflict,
            (
                await client.PostAsJsonAsync(
                    path + "/bookingLinks",
                    new BookingLinksRequest("someone-elses-fare")
                )
            ).StatusCode
        );
        (
            await client.PostAsJsonAsync(path + "/bookingLinks", new BookingLinksRequest(id))
        ).EnsureSuccessStatusCode();
        CollectionAssert.AreEqual(new[] { id }, provider.Calls.ToArray());
        var purchase = await client.PutAsJsonAsync(
            path,
            new SetFlightChoicesRequest(partial, [id])
        );
        Assert.AreEqual(
            HttpStatusCode.OK,
            purchase.StatusCode,
            await purchase.Content.ReadAsStringAsync()
        );
        var restored = (
            await client.GetFromJsonAsync<FlightChoiceProgressDto[]>(
                $"/trips/{trip.Id}/flights/choices"
            )
        )!.Single();
        CollectionAssert.AreEqual(new[] { id }, restored.PurchasedOfferIds);
        CollectionAssert.AreEqual(
            new[] { id },
            (await factory.Database.GetFlightChoicesAsync(user.Id.Value, trip.Id))
                .Single()
                .PurchasedOfferIds
        );
        if (paired)
        {
            Assert.AreEqual(
                HttpStatusCode.BadRequest,
                (
                    await client.PutAsJsonAsync(
                        path,
                        new SetFlightChoicesRequest(partial, [id, "fare-0"])
                    )
                ).StatusCode
            );
            // Completing the itinerary carries the shared purchase into Plans.
            await factory.Database.SetFlightChoicesAsync(
                user.Id.Value,
                trip.Id,
                new(party.Id, keys, []) { SavedFares = fares, PurchasedOfferIds = [id] }
            );
            var complete = (
                await client.GetFromJsonAsync<EvaluatedFareSearchResultDto[]>(
                    $"/trips/{trip.Id}/flights/search"
                )
            )!.Single();
            var selectedResponse = await client.PutAsJsonAsync(
                $"/trips/{trip.Id}/flights/{party.Id}",
                new SelectFlightRequest(complete.CacheKey, 0)
            );
            selectedResponse.EnsureSuccessStatusCode();
            var selected = (await selectedResponse.Content.ReadFromJsonAsync<SelectedFlight>())!;
            CollectionAssert.AreEqual(new[] { true, false, false, true }, selected.PurchasedLegs);
            // Changing either half in Plans changes the whole booking and the partial-choice resource.
            var changed = await client.PutAsJsonAsync(
                $"/trips/{trip.Id}/flights/{party.Id}/purchases",
                new SetFlightPurchasesRequest(
                    selected.CacheKey,
                    selected.ItineraryIndex,
                    [false, false, false, true]
                )
            );
            changed.EnsureSuccessStatusCode();
            CollectionAssert.AreEqual(
                new[] { false, false, false, false },
                (await changed.Content.ReadFromJsonAsync<SelectedFlight>())!.PurchasedLegs
            );
            Assert.IsEmpty(
                (await factory.Database.GetFlightChoicesAsync(user.Id.Value, trip.Id))
                    .Single()
                    .PurchasedOfferIds
            );
            (
                await client.PutAsJsonAsync(path, new SetFlightChoicesRequest(keys, [id]))
            ).EnsureSuccessStatusCode();
            CollectionAssert.AreEqual(
                new[] { true, false, false, true },
                (await factory.Database.GetSelectedFlightsAsync(user.Id.Value, trip.Id))
                    .Single()
                    .PurchasedLegs
            );
            (
                await client.PutAsJsonAsync(path, new SetFlightChoicesRequest(partial))
            ).EnsureSuccessStatusCode();
        }
        // A purchase update cannot accidentally reselect flights from a stale tab.
        Assert.AreEqual(
            HttpStatusCode.Conflict,
            (await client.PutAsJsonAsync(path, new SetFlightChoicesRequest([], [id]))).StatusCode
        );
        (
            await client.PutAsJsonAsync(path, new SetFlightChoicesRequest(partial, []))
        ).EnsureSuccessStatusCode();
        Assert.IsEmpty(
            (await factory.Database.GetFlightChoicesAsync(user.Id.Value, trip.Id))
                .Single()
                .PurchasedOfferIds
        );
        (
            await client.PutAsJsonAsync(path, new SetFlightChoicesRequest(partial, [id]))
        ).EnsureSuccessStatusCode();
        (
            await client.PutAsJsonAsync(path, new SetFlightChoicesRequest(paired ? [keys[0]] : []))
        ).EnsureSuccessStatusCode();
        Assert.IsEmpty(
            (await factory.Database.GetFlightChoicesAsync(user.Id.Value, trip.Id))
                .Single()
                .PurchasedOfferIds
        );
    }

    private sealed class ChoiceBookingClient : IIgnavClient
    {
        public List<string> Calls { get; } = [];

        public Task<JsonElement> SearchAsync(
            IgnavFareRequest request,
            CancellationToken cancellationToken
        ) =>
            throw new InvalidOperationException("Booking controls must not start a flight search.");

        public Task<JsonElement> GetBookingLinksAsync(
            string ignavId,
            CancellationToken cancellationToken
        )
        {
            Calls.Add(ignavId);
            return Task.FromResult(
                JsonSerializer.SerializeToElement(
                    new
                    {
                        booking_options = new[]
                        {
                            new
                            {
                                leg_indexes = new[] { 0, 1 },
                                links = new[]
                                {
                                    new
                                    {
                                        provider_type = "airline",
                                        provider_name = "Airline",
                                        url = "https://airline.example/book",
                                    },
                                },
                            },
                        },
                    }
                )
            );
        }
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
                                price = new
                                {
                                    amount = i is 0 or 3 ? 600 : 100,
                                    currency = "USD",
                                    status = "verified",
                                },
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
                                price = new
                                {
                                    amount = 700,
                                    currency = "USD",
                                    status = "verified",
                                },
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

    private static string BrowserLegKey(JsonElement leg)
    {
        static string? Text(JsonElement segment, string name) =>
            segment.TryGetProperty(name, out var value) ? value.GetString() : null;
        return JsonSerializer.Serialize(
            leg.GetProperty("segments")
                .EnumerateArray()
                .Select(segment =>
                    new string?[]
                    {
                        Text(segment, "departure_airport"),
                        Text(segment, "arrival_airport"),
                        Text(segment, "departure_time_utc")
                            ?? Text(segment, "departure_time_local"),
                        Text(segment, "arrival_time_utc") ?? Text(segment, "arrival_time_local"),
                        Text(segment, "marketing_carrier_code"),
                        Text(segment, "flight_number"),
                    }
                ),
            new JsonSerializerOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }
        );
    }
}
