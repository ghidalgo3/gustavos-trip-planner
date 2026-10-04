using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Npgsql;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Endpoints;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services;

namespace TripPlanner.Api.Tests;

[TestClass]
public sealed class OperationTests
{
    private static JsonElement Response =>
        JsonSerializer.SerializeToElement(new { itineraries = Array.Empty<object>() });
    private static JsonElement SampleItineraryResponse
    {
        get
        {
            var response = JsonNode.Parse(
                """
                {"itineraries":[{"ignav_id":"fare-1","price":{"amount":350,"currency":"USD"},
                "outbound":{"duration_minutes":600,"segments":[{"departure_airport":"BOS","arrival_airport":"CDG","departure_time_local":"2030-01-05T08:00:00","arrival_time_local":"2030-01-06T01:00:00"}]},
                "inbound":{"duration_minutes":420,"segments":[{"departure_airport":"CDG","arrival_airport":"BOS","departure_time_local":"2030-01-15T09:00:00","arrival_time_local":"2030-01-15T12:00:00"}]}}]}
                """
            )!;
            var alternative = response["itineraries"]![0]!.DeepClone();
            alternative["ignav_id"] = "fare-2";
            alternative["price"]!["amount"] = 450;
            response["itineraries"]!.AsArray().Add(alternative);
            return JsonSerializer.SerializeToElement(response);
        }
    }
    private static IgnavFareRequest Query =>
        new("BOS", "CDG", new(2030, 1, 5), new(2030, 1, 14), 1, "economy", "US", null);

    private static SearchPlanPreview Preview(Guid partyId, params IgnavFareRequest[] requests) =>
        new(
            true,
            20,
            [],
            [
                new(
                    partyId,
                    requests.Length,
                    requests
                        .Select(request => new PreparedSearch(
                            request,
                            SearchPlanBuilder.CacheKey(request),
                            0
                        ))
                        .ToArray(),
                    [],
                    []
                ),
            ]
        );

    private static async Task<(User User, Trip Trip, Party Party)> Seed(IPlannerDb db)
    {
        var user = await db.GetOrCreateUserAsync(
            new("google", $"{Guid.NewGuid()}@example.com", "Ada")
        );
        var trip = await db.CreateTripAsync(user.Id, "Paris", "");
        return (user, trip, (await db.GetPartiesAsync(user.Id, trip.Id)).Single());
    }

    [TestMethod]
    public async Task QueueContract_InMemory()
    {
        var db = new InMemoryPlannerDb();
        await QueueContract(db);
        await QueuePriorityContract(db);
        await TripFormQueueContract(db);
    }

    [TestMethod]
    public async Task QueueContract_Postgres()
    {
        var connectionString = Environment.GetEnvironmentVariable("TRIPPLANNER_TEST_POSTGRES");
        if (string.IsNullOrEmpty(connectionString))
            Assert.Inconclusive(
                "Set TRIPPLANNER_TEST_POSTGRES to run isolated PostgreSQL queue tests."
            );
        var name = "planner_test_" + Guid.NewGuid().ToString("N");
        await using var admin = NpgsqlDataSource.Create(connectionString!);
        await using (var create = admin.CreateCommand($"CREATE DATABASE {name}"))
            await create.ExecuteNonQueryAsync();
        try
        {
            var settings = new NpgsqlConnectionStringBuilder(connectionString)
            {
                Database = name,
                SearchPath = "gustavo_planner,public",
            };
            await using var source = NpgsqlDataSource.Create(settings.ConnectionString);
            await new DatabaseMigrator(
                source,
                NullLogger<DatabaseMigrator>.Instance
            ).MigrateAsync();
            await using (
                var schema = source.CreateCommand(
                    """
                    SELECT count(*), to_regclass('gustavo_planner.operations'),
                        to_regclass('gustavo_planner.fare_searches'), to_regclass('gustavo_planner.operation_items'),
                        to_regclass('gustavo_planner.trip_form_jobs'),
                        (SELECT count(*) FROM information_schema.columns
                         WHERE table_schema = 'gustavo_planner' AND table_name = 'trips'
                           AND column_name = 'selected_flights')
                    FROM schema_migrations;
                    """
                )
            )
            await using (var reader = await schema.ExecuteReaderAsync())
            {
                await reader.ReadAsync();
                Assert.AreEqual(2L, reader.GetInt64(0));
                Assert.IsFalse(reader.IsDBNull(1));
                Assert.IsFalse(reader.IsDBNull(2));
                Assert.IsTrue(reader.IsDBNull(3));
                Assert.IsFalse(reader.IsDBNull(4));
                Assert.AreEqual(1L, reader.GetInt64(5));
            }
            var db = new PostgresPlannerDb(source);
            await QueueContract(db);
            await QueuePriorityContract(db);
            await TripFormQueueContract(db);
        }
        finally
        {
            await using var drop = admin.CreateCommand($"DROP DATABASE {name} WITH (FORCE)");
            await drop.ExecuteNonQueryAsync();
        }
    }

    private static async Task QueueContract(IPlannerDb db)
    {
        var (user, trip, party) = await Seed(db);
        var preview = Preview(
            party.Id,
            Query,
            Query with
            {
                ReturnDate = new(2030, 1, 15),
                SearchPriority = 0,
            }
        );
        var id = Guid.NewGuid();
        var operation = await db.CreateFlightSearchOperationAsync(user.Id, trip.Id, id, preview);
        Assert.AreEqual(OperationState.FlightSearch, operation.Type);
        Assert.AreEqual(trip.Id, operation.ResourceId);
        Assert.AreEqual("pending", operation.Status);
        Assert.AreEqual(new OperationProgress(2, 0, 0), operation.Progress);
        Assert.AreEqual(
            id,
            (await db.CreateFlightSearchOperationAsync(user.Id, trip.Id, id, preview)).Id
        );
        Assert.IsNull(await db.GetOperationAsync(Guid.NewGuid(), id));

        var claims = await Task.WhenAll(
            db.ClaimFareWorkAsync(TimeSpan.FromMinutes(2)),
            db.ClaimFareWorkAsync(TimeSpan.FromMinutes(2))
        );
        Assert.IsTrue(claims.All(claim => claim is not null));
        Assert.AreNotEqual(claims[0]!.CacheKey, claims[1]!.CacheKey);
        Assert.IsNull(await db.ClaimFareWorkAsync(TimeSpan.FromMinutes(2)));
        Assert.AreEqual("InProgress", (await db.GetOperationAsync(user.Id, id))!.Status);

        var fetched = DateTimeOffset.UtcNow;
        Assert.IsTrue(await db.CompleteFareWorkAsync(claims[0]!, Response, fetched, null));
        Assert.IsFalse(await db.CompleteFareWorkAsync(claims[0]!, Response, fetched, null));
        Assert.IsTrue(
            await db.CompleteFareWorkAsync(claims[1]!, null, null, "Provider unavailable")
        );
        operation = (await db.GetOperationAsync(user.Id, id))!;
        Assert.AreEqual("Failed", operation.Status);
        Assert.AreEqual(new OperationProgress(2, 1, 1), operation.Progress);
        var partial = await db.GetFareSearchResultsAsync(user.Id, trip.Id, preview);
        Assert.HasCount(1, partial!);
        Assert.AreEqual(claims[0]!.CacheKey, partial![0].CacheKey);

        var cachedPreview = Preview(party.Id, claims[0]!.Request);
        var cachedOperation = await db.CreateFlightSearchOperationAsync(
            user.Id,
            trip.Id,
            Guid.NewGuid(),
            cachedPreview
        );
        Assert.AreEqual("Completed", cachedOperation.Status);
        Assert.AreEqual(new OperationProgress(1, 1, 0), cachedOperation.Progress);
        Assert.IsNull(await db.ClaimFareWorkAsync(TimeSpan.FromMinutes(2)));
        var results = await db.GetFareSearchResultsAsync(user.Id, trip.Id, cachedPreview);
        Assert.HasCount(1, results!);
        Assert.AreEqual(claims[0]!.CacheKey, results![0].CacheKey);

        var itinerary = JsonSerializer.SerializeToElement(new { ignav_id = "fare-1" });
        var selected = new SelectedFlight(
            trip.Id,
            party.Id,
            claims[0]!.CacheKey,
            0,
            claims[0]!.Request,
            itinerary,
            DateTimeOffset.UtcNow
        );
        await db.SetSelectedFlightAsync(user.Id, selected);
        Assert.IsEmpty(await db.GetSelectedFlightsAsync(Guid.NewGuid(), trip.Id));
        Assert.AreEqual(
            0,
            (await db.GetSelectedFlightsAsync(user.Id, trip.Id)).Single().ItineraryIndex
        );
        await db.SetSelectedFlightAsync(
            user.Id,
            selected with
            {
                ItineraryIndex = 1,
                PurchasedLegs = [true, false],
            }
        );
        Assert.AreEqual(
            1,
            (await db.GetSelectedFlightsAsync(user.Id, trip.Id)).Single().ItineraryIndex
        );
        CollectionAssert.AreEqual(
            new[] { true, false },
            (await db.GetSelectedFlightsAsync(user.Id, trip.Id)).Single().PurchasedLegs
        );
        var member = await db.GetOrCreateUserAsync(
            new("google", $"{Guid.NewGuid()}@example.com", "Ben")
        );
        Assert.AreEqual(
            PartyMemberChangeStatus.Success,
            await db.ChangePartyMemberAsync(user.Id, trip.Id, party.Id, member.Id, true)
        );
        Assert.AreEqual(trip.Id, (await db.GetVisibleTripAsync(member.Id, trip.Id))?.Id);
        Assert.AreEqual(trip.Id, (await db.GetTripsAsync(member.Id)).Single().Id);
        Assert.HasCount(1, await db.GetPartiesAsync(member.Id, trip.Id));
        Assert.HasCount(1, await db.GetSelectedFlightsAsync(member.Id, trip.Id));
        Assert.IsNull(await db.GetTripAsync(member.Id, trip.Id));
        Assert.AreEqual(
            PartyMemberChangeStatus.Success,
            await db.ChangePartyMemberAsync(user.Id, trip.Id, party.Id, member.Id, false)
        );
        Assert.IsNull(await db.GetVisibleTripAsync(member.Id, trip.Id));
        Assert.IsEmpty(await db.GetTripsAsync(member.Id));
        Assert.IsEmpty(await db.GetSelectedFlightsAsync(member.Id, trip.Id));
        if (db is InMemoryPlannerDb memory)
        {
            var expiredClock = new TestClock();
            expiredClock.Advance(TimeSpan.FromHours(2));
            memory.OperationClock = expiredClock;
            Assert.IsNull(await db.GetFareSearchResultsAsync(user.Id, trip.Id, cachedPreview));
            Assert.HasCount(1, await db.GetSelectedFlightsAsync(user.Id, trip.Id));
            memory.OperationClock = TimeProvider.System;
        }
        await db.DeleteSelectedFlightAsync(user.Id, trip.Id, party.Id);
        await db.DeleteSelectedFlightAsync(user.Id, trip.Id, party.Id);
        Assert.IsEmpty(await db.GetSelectedFlightsAsync(user.Id, trip.Id));

        Assert.HasCount(2, await db.GetOperationsAsync(user.Id, "flightSearch", 10, 0));
        Assert.HasCount(1, await db.GetOperationsAsync(user.Id, "flightSearch", 1, 1));
        Assert.IsEmpty(await db.GetOperationsAsync(user.Id, "anotherType", 10, 0));
    }

    private static async Task QueuePriorityContract(IPlannerDb db)
    {
        var (user, trip, party) = await Seed(db);
        var first = Query with
        {
            DepartureDate = new(2031, 6, 1),
            ReturnDate = new(2031, 6, 1),
            SearchKind = "oneWay",
            SearchPriority = 0,
        };
        var next = first with
        {
            Origin = "CDG",
            Destination = "NRT",
            DepartureDate = new(2031, 6, 5),
            ReturnDate = new(2031, 6, 5),
            SearchPriority = 1,
        };
        var later = next with
        {
            Origin = "NRT",
            Destination = "BOS",
            DepartureDate = new(2031, 6, 9),
            ReturnDate = new(2031, 6, 9),
        };
        await db.CreateFlightSearchOperationAsync(
            user.Id,
            trip.Id,
            Guid.NewGuid(),
            Preview(party.Id, first, next, later)
        );
        var saved = await db.SetFlightChoicesAsync(
            user.Id,
            trip.Id,
            new(party.Id, ["selected-first-flight"], ["CDG"])
        );
        CollectionAssert.Contains(saved.NextOrigins, "CDG");
        CollectionAssert.Contains(
            (await db.GetFlightChoicesAsync(user.Id, trip.Id)).Single().NextOrigins,
            "CDG"
        );
        Assert.IsEmpty(await db.GetFlightChoicesAsync(Guid.NewGuid(), trip.Id));
        var claimed = await db.ClaimFareWorkAsync(TimeSpan.FromMinutes(2));
        Assert.IsNotNull(claimed);
        Assert.AreEqual("CDG", claimed.Request.Origin);
        await db.SetFlightChoicesAsync(
            user.Id,
            trip.Id,
            new(party.Id, ["first", "second"], ["NRT"])
        );
        claimed = await db.ClaimFareWorkAsync(TimeSpan.FromMinutes(2));
        Assert.IsNotNull(claimed);
        Assert.AreEqual("NRT", claimed.Request.Origin);
    }

    private static async Task TripFormQueueContract(IPlannerDb db)
    {
        var (user, trip, _) = await Seed(db);
        Guid id = Guid.NewGuid();
        var draft = new PlanningDocument();
        TrackedOperation created = await db.CreateTripFormOperationAsync(
            user.Id,
            trip.Id,
            id,
            "Paris January 5 to 15",
            draft
        );
        Assert.AreEqual(OperationState.TripFormFill, created.Type);
        Assert.AreEqual("pending", created.Status);
        Assert.AreEqual(
            id,
            (
                await db.CreateTripFormOperationAsync(
                    user.Id,
                    trip.Id,
                    id,
                    "Paris January 5 to 15",
                    draft
                )
            ).Id
        );
        Assert.IsNull(await db.GetTripFormProposalAsync(Guid.NewGuid(), trip.Id, id));
        TripFormWork? work = await db.ClaimTripFormWorkAsync(TimeSpan.FromMinutes(2));
        Assert.IsNotNull(work);
        Assert.AreEqual(id, work.OperationId);
        Assert.IsNull(await db.ClaimTripFormWorkAsync(TimeSpan.FromMinutes(2)));
        var proposal = new TripFormProposal(
            draft with
            {
                Destination = new SearchLocation("CDG", "Europe/Paris"),
                AiPrompt = work.Input,
            },
            []
        );
        Assert.IsTrue(await db.CompleteTripFormWorkAsync(work, proposal, null));
        Assert.IsFalse(await db.CompleteTripFormWorkAsync(work, proposal, null));
        Assert.AreEqual("Completed", (await db.GetOperationAsync(user.Id, id))?.Status);
        Assert.AreEqual(
            "CDG",
            (await db.GetTripFormProposalAsync(user.Id, trip.Id, id))?.Document.Destination?.Code
        );
    }

    [TestMethod]
    public async Task Worker_UsesFreshCacheAndRefreshesExpiredEntries()
    {
        var clock = new TestClock();
        var db = new InMemoryPlannerDb { OperationClock = clock };
        var (user, trip, party) = await Seed(db);
        var preview = Preview(party.Id, Query);
        var client = new FakeIgnav();
        var worker = new PlanningWorker(
            db,
            client,
            Microsoft.Extensions.Options.Options.Create(new IgnavOptions()),
            Microsoft.Extensions.Options.Options.Create(new PlanningOptions()),
            clock,
            NullLogger<PlanningWorker>.Instance,
            null
        );
        await db.CreateFlightSearchOperationAsync(user.Id, trip.Id, Guid.NewGuid(), preview);
        Assert.IsTrue(await worker.ProcessNextAsync());
        Assert.AreEqual(1, client.Calls);

        clock.Advance(TimeSpan.FromMinutes(59));
        var cached = await db.CreateFlightSearchOperationAsync(
            user.Id,
            trip.Id,
            Guid.NewGuid(),
            preview
        );
        Assert.AreEqual("Completed", cached.Status);
        Assert.IsFalse(await worker.ProcessNextAsync());
        Assert.AreEqual(1, client.Calls);

        clock.Advance(TimeSpan.FromMinutes(2));
        var refresh = await db.CreateFlightSearchOperationAsync(
            user.Id,
            trip.Id,
            Guid.NewGuid(),
            preview
        );
        Assert.AreEqual("pending", refresh.Status);
        Assert.IsTrue(await worker.ProcessNextAsync());
        Assert.AreEqual(2, client.Calls);
    }

    [TestMethod]
    public async Task Worker_RetriesTransientProviderFailureWithoutFailingOperation()
    {
        var clock = new TestClock();
        var db = new InMemoryPlannerDb { OperationClock = clock };
        var (user, trip, party) = await Seed(db);
        var client = new FakeIgnav(transientFailures: 1);
        var worker = new PlanningWorker(
            db,
            client,
            Microsoft.Extensions.Options.Options.Create(new IgnavOptions()),
            Microsoft.Extensions.Options.Options.Create(new PlanningOptions()),
            clock,
            NullLogger<PlanningWorker>.Instance,
            null
        );
        var operation = await db.CreateFlightSearchOperationAsync(
            user.Id,
            trip.Id,
            Guid.NewGuid(),
            Preview(party.Id, Query)
        );
        Assert.IsTrue(await worker.ProcessNextAsync());
        var retrying = (await db.GetOperationAsync(user.Id, operation.Id))!;
        Assert.AreEqual("InProgress", retrying.Status);
        Assert.AreEqual(new OperationProgress(1, 0, 0), retrying.Progress);
        Assert.IsFalse(await worker.ProcessNextAsync());
        clock.Advance(TimeSpan.FromSeconds(2));
        Assert.IsTrue(await worker.ProcessNextAsync());
        Assert.AreEqual("Completed", (await db.GetOperationAsync(user.Id, operation.Id))!.Status);
        Assert.AreEqual(2, client.Calls);
    }

    [TestMethod]
    public async Task Queue_ClaimsFirstLegBeforeLaterSearches()
    {
        var db = new InMemoryPlannerDb();
        var (user, trip, party) = await Seed(db);
        await db.CreateFlightSearchOperationAsync(
            user.Id,
            trip.Id,
            Guid.NewGuid(),
            Preview(
                party.Id,
                Query,
                Query with
                {
                    ReturnDate = new(2030, 1, 15),
                    SearchPriority = 0,
                }
            )
        );
        var claimed = await db.ClaimFareWorkAsync(TimeSpan.FromMinutes(2));
        Assert.IsNotNull(claimed);
        Assert.AreEqual(0, claimed.Request.SearchPriority);
    }

    [TestMethod]
    public async Task FlightSearchAndGenericOperationRoutes_AreAuthorizedAndUseSavedConstraints()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Subject", "ada");
        client.DefaultRequestHeaders.Add("X-Test-Email", "ada@example.com");
        var user = (
            await (
                await client.PutAsJsonAsync(
                    "/user/profile",
                    new UserProfile(new("Boston", -71, 42), [])
                )
            ).Content.ReadFromJsonAsync<CurrentUserResponse>()
        )!;
        var trip = (
            await (
                await client.PostAsJsonAsync(
                    $"/user/{user.Id}/trips",
                    new CreateTripRequest("Paris", "")
                )
            ).Content.ReadFromJsonAsync<Trip>()
        )!;
        var party = factory.Database.Parties.Single();
        var document = new PlanningDocument
        {
            Destination = new("CDG", "Europe/Paris"),
            TravelDates = new(new(2030, 1, 5), new(2030, 1, 15)),
            Parties = [new() { PartyId = party.Id, Origin = new("BOS", "America/New_York") }],
        };
        Assert.AreEqual(
            HttpStatusCode.OK,
            (
                await client.PutAsJsonAsync($"/trips/{trip.Id}/flights/constraints", document)
            ).StatusCode
        );
        var path = $"/trips/{trip.Id}/flights/search";
        Assert.AreEqual(HttpStatusCode.NotFound, (await client.GetAsync(path)).StatusCode);
        var request = new StartFlightSearchRequest(Guid.NewGuid());
        var response = await client.PostAsJsonAsync($"/trips/{trip.Id}/flights:search", request);
        Assert.AreEqual(HttpStatusCode.Accepted, response.StatusCode);
        var operation = (await response.Content.ReadFromJsonAsync<TrackedOperation>())!;
        Assert.AreEqual("/operations/" + operation.Id, operation.PollingUrl);
        Assert.AreEqual(operation.PollingUrl, response.Headers.Location!.ToString());
        Assert.AreEqual(OperationState.FlightSearch, operation.Type);

        var listed = (
            await client.GetFromJsonAsync<TrackedOperation[]>(
                "/operations?top=1&skip=0&type=flightSearch"
            )
        )!;
        Assert.HasCount(1, listed);
        Assert.AreEqual(operation.Id, listed[0].Id);
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (await client.GetAsync("/operations?top=0")).StatusCode
        );
        Assert.AreEqual(
            operation.Id,
            (await client.GetFromJsonAsync<TrackedOperation>(operation.PollingUrl))!.Id
        );

        var worker = new PlanningWorker(
            factory.Database,
            new FakeIgnav(SampleItineraryResponse),
            Microsoft.Extensions.Options.Options.Create(new IgnavOptions()),
            Microsoft.Extensions.Options.Options.Create(new PlanningOptions()),
            TimeProvider.System,
            NullLogger<PlanningWorker>.Instance,
            null
        );
        while (await worker.ProcessNextAsync()) { }
        using (var fareResponse = await client.GetAsync(path))
        using (var json = JsonDocument.Parse(await fareResponse.Content.ReadAsStringAsync()))
        {
            Assert.AreEqual(HttpStatusCode.OK, fareResponse.StatusCode);
            Assert.AreEqual(
                "Eligible",
                json.RootElement[0].GetProperty("evaluations")[0].GetProperty("status").GetString()
            );
        }
        var evaluated = await client.GetFromJsonAsync<EvaluatedFareSearchResultDto[]>(path);
        Assert.HasCount(1, evaluated!);
        Assert.AreEqual("Eligible", evaluated![0].Evaluations[0].Status);

        var selectionPath = $"/trips/{trip.Id}/flights";
        Assert.AreEqual(
            HttpStatusCode.NoContent,
            (await client.GetAsync(selectionPath)).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (
                await client.PutAsJsonAsync(
                    $"{selectionPath}/{party.Id}",
                    new SelectFlightRequest(null, null)
                )
            ).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (
                await client.PutAsJsonAsync(
                    $"{selectionPath}/{party.Id}",
                    new SelectFlightRequest(evaluated[0].CacheKey, 99)
                )
            ).StatusCode
        );
        var firstSelection = await client.PutAsJsonAsync(
            $"{selectionPath}/{party.Id}",
            new SelectFlightRequest(evaluated[0].CacheKey, 0)
        );
        Assert.AreEqual(HttpStatusCode.OK, firstSelection.StatusCode);
        Assert.AreEqual(
            "fare-1",
            (await firstSelection.Content.ReadFromJsonAsync<SelectedFlight>())!
                .Itinerary.GetProperty("ignav_id")
                .GetString()
        );
        var replacement = await client.PutAsJsonAsync(
            $"{selectionPath}/{party.Id}",
            new SelectFlightRequest(evaluated[0].CacheKey, 1)
        );
        Assert.AreEqual(HttpStatusCode.OK, replacement.StatusCode);
        var saved = (await client.GetFromJsonAsync<SelectedFlight[]>(selectionPath))!;
        Assert.HasCount(1, saved);
        Assert.AreEqual(1, saved[0].ItineraryIndex);
        Assert.AreEqual("fare-2", saved[0].Itinerary.GetProperty("ignav_id").GetString());
        CollectionAssert.AreEqual(new[] { false, false }, saved[0].PurchasedLegs);
        var purchasesPath = $"{selectionPath}/{party.Id}/purchases";
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (
                await client.PutAsJsonAsync(
                    purchasesPath,
                    new SetFlightPurchasesRequest(evaluated[0].CacheKey, 1, [true])
                )
            ).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.Conflict,
            (
                await client.PutAsJsonAsync(
                    purchasesPath,
                    new SetFlightPurchasesRequest(evaluated[0].CacheKey, 0, [true, false])
                )
            ).StatusCode
        );
        var purchaseResponse = await client.PutAsJsonAsync(
            purchasesPath,
            new SetFlightPurchasesRequest(evaluated[0].CacheKey, 1, [true, false])
        );
        Assert.AreEqual(HttpStatusCode.OK, purchaseResponse.StatusCode);
        CollectionAssert.AreEqual(
            new[] { true, false },
            (await client.GetFromJsonAsync<SelectedFlight[]>(selectionPath))![0].PurchasedLegs
        );

        var stay = new PlanningConstraint
        {
            Id = Guid.NewGuid(),
            UserId = user.Id!.Value,
            Type = "presence",
            StartDate = new(2030, 1, 5),
            EndDate = new(2030, 1, 10),
        };
        Assert.AreEqual(
            HttpStatusCode.OK,
            (
                await client.PutAsJsonAsync(
                    $"/trips/{trip.Id}/flights/constraints",
                    document with
                    {
                        Constraints = [stay],
                    }
                )
            ).StatusCode
        );
        evaluated = await client.GetFromJsonAsync<EvaluatedFareSearchResultDto[]>(path);
        Assert.HasCount(1, evaluated!);
        Assert.AreEqual("Rejected", evaluated![0].Evaluations[0].Status);
        Assert.AreEqual("presence", evaluated[0].Evaluations[0].Issues.Single().Code);
        Assert.AreEqual(
            HttpStatusCode.Conflict,
            (
                await client.PutAsJsonAsync(
                    $"{selectionPath}/{party.Id}",
                    new SelectFlightRequest(evaluated[0].CacheKey, 0)
                )
            ).StatusCode
        );
        Assert.AreEqual(
            1,
            (await client.GetFromJsonAsync<SelectedFlight[]>(selectionPath))![0].ItineraryIndex
        );
        Assert.AreEqual(
            HttpStatusCode.NoContent,
            (await client.DeleteAsync($"{selectionPath}/{party.Id}")).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.NoContent,
            (await client.DeleteAsync($"{selectionPath}/{party.Id}")).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.NoContent,
            (await client.GetAsync(selectionPath)).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.Conflict,
            (
                await client.PostAsJsonAsync(
                    $"/trips/{trip.Id}/flights/search/{evaluated[0].CacheKey}/bookingLinks",
                    new BookingLinksRequest("fare-1")
                )
            ).StatusCode
        );

        using var anonymous = factory.CreateClient();
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(path)).StatusCode);
        Assert.AreEqual(
            HttpStatusCode.Unauthorized,
            (await anonymous.GetAsync(operation.PollingUrl)).StatusCode
        );
        using var other = factory.CreateClient();
        other.DefaultRequestHeaders.Add("X-Test-Subject", "other");
        other.DefaultRequestHeaders.Add("X-Test-Email", "other@example.com");
        await other.PutAsJsonAsync(
            "/user/profile",
            new UserProfile(new("Seattle", -122, 47), [], "SEA")
        );
        Assert.AreEqual(HttpStatusCode.NotFound, (await other.GetAsync(path)).StatusCode);
        Assert.AreEqual(HttpStatusCode.NotFound, (await other.GetAsync(selectionPath)).StatusCode);
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (await other.GetAsync(operation.PollingUrl)).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (
                await client.PostAsJsonAsync(path, new StartFlightSearchRequest(Guid.Empty))
            ).StatusCode
        );
    }

    private sealed class FakeIgnav(JsonElement? response = null, int transientFailures = 0)
        : IIgnavClient
    {
        public int Calls { get; private set; }

        public Task<JsonElement> SearchAsync(
            IgnavFareRequest request,
            CancellationToken cancellationToken
        )
        {
            Calls++;
            if (Calls <= transientFailures)
                return Task.FromException<JsonElement>(
                    new HttpRequestException("Temporary provider failure")
                );
            return Task.FromResult(response ?? Response);
        }

        public Task<JsonElement> GetBookingLinksAsync(
            string ignavId,
            CancellationToken cancellationToken
        ) => Task.FromResult(Response);
    }

    private sealed class TestClock : TimeProvider
    {
        private DateTimeOffset _now = DateTimeOffset.UtcNow;

        public override DateTimeOffset GetUtcNow() => _now;

        public void Advance(TimeSpan time) => _now += time;
    }
}
