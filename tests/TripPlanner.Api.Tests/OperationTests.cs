using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Npgsql;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services;

namespace TripPlanner.Api.Tests;

[TestClass]
public sealed class OperationTests
{
    private static JsonElement Response =>
        JsonSerializer.SerializeToElement(new { itineraries = Array.Empty<object>() });
    private static IgnavRoundTripRequest Query =>
        new("BOS", "CDG", new(2030, 1, 5), new(2030, 1, 14), 1, "economy", "US", null);

    private static SearchPlanPreview Preview(
        Guid partyId,
        params IgnavRoundTripRequest[] requests
    ) =>
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
    public async Task QueueContract_InMemory() => await QueueContract(new InMemoryPlannerDb());

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
            var settings = new NpgsqlConnectionStringBuilder(connectionString) { Database = name };
            await using var source = NpgsqlDataSource.Create(settings.ConnectionString);
            await new DatabaseMigrator(
                source,
                NullLogger<DatabaseMigrator>.Instance
            ).MigrateAsync();
            await using (
                var schema = source.CreateCommand(
                    """
                    SELECT count(*), to_regclass('public.operations'),
                        to_regclass('public.fare_searches'), to_regclass('public.operation_items')
                    FROM schema_migrations;
                    """
                )
            )
            await using (var reader = await schema.ExecuteReaderAsync())
            {
                await reader.ReadAsync();
                Assert.AreEqual(1L, reader.GetInt64(0));
                Assert.IsFalse(reader.IsDBNull(1));
                Assert.IsFalse(reader.IsDBNull(2));
                Assert.IsTrue(reader.IsDBNull(3));
            }
            await QueueContract(new PostgresPlannerDb(source));
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
        var preview = Preview(party.Id, Query, Query with { ReturnDate = new(2030, 1, 15) });
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
        Assert.IsNull(await db.GetFareSearchResultsAsync(user.Id, trip.Id, preview));

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

        Assert.HasCount(2, await db.GetOperationsAsync(user.Id, "flightSearch", 10, 0));
        Assert.HasCount(1, await db.GetOperationsAsync(user.Id, "flightSearch", 1, 1));
        Assert.IsEmpty(await db.GetOperationsAsync(user.Id, "anotherType", 10, 0));
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
            NullLogger<PlanningWorker>.Instance
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
    public async Task FlightSearchAndGenericOperationRoutes_AreAuthorizedAndUseSavedConstraints()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Subject", "ada");
        client.DefaultRequestHeaders.Add("X-Test-Email", "ada@example.com");
        var user = (
            await (
                await client.PutAsJsonAsync(
                    "/api/user/homeCity",
                    new SetHomeCityRequest("Boston", -71, 42)
                )
            ).Content.ReadFromJsonAsync<CurrentUserResponse>()
        )!;
        var trip = (
            await (
                await client.PostAsJsonAsync(
                    $"/api/user/{user.Id}/trips",
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
                await client.PutAsJsonAsync(
                    $"/api/user/{user.Id}/trips/{trip.Id}/constraints",
                    document
                )
            ).StatusCode
        );
        var path = $"/api/trips/{trip.Id}/flightSearch";
        Assert.AreEqual(HttpStatusCode.NotFound, (await client.GetAsync(path)).StatusCode);
        var request = new StartFlightSearchRequest(Guid.NewGuid());
        var response = await client.PostAsJsonAsync(path, request);
        Assert.AreEqual(HttpStatusCode.Accepted, response.StatusCode);
        var operation = (await response.Content.ReadFromJsonAsync<TrackedOperation>())!;
        Assert.AreEqual("/api/operations/" + operation.Id, operation.PollingUrl);
        Assert.AreEqual(operation.PollingUrl, response.Headers.Location!.ToString());
        Assert.AreEqual(OperationState.FlightSearch, operation.Type);

        var listed = (
            await client.GetFromJsonAsync<TrackedOperation[]>(
                "/api/operations?top=1&skip=0&type=flightSearch"
            )
        )!;
        Assert.HasCount(1, listed);
        Assert.AreEqual(operation.Id, listed[0].Id);
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (await client.GetAsync("/api/operations?top=0")).StatusCode
        );
        Assert.AreEqual(
            operation.Id,
            (await client.GetFromJsonAsync<TrackedOperation>(operation.PollingUrl))!.Id
        );

        var worker = new PlanningWorker(
            factory.Database,
            new FakeIgnav(),
            Microsoft.Extensions.Options.Options.Create(new IgnavOptions()),
            Microsoft.Extensions.Options.Options.Create(new PlanningOptions()),
            TimeProvider.System,
            NullLogger<PlanningWorker>.Instance
        );
        while (await worker.ProcessNextAsync()) { }
        Assert.AreEqual(HttpStatusCode.OK, (await client.GetAsync(path)).StatusCode);

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
            "/api/user/homeCity",
            new SetHomeCityRequest("Seattle", -122, 47)
        );
        Assert.AreEqual(HttpStatusCode.NotFound, (await other.GetAsync(path)).StatusCode);
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

    private sealed class FakeIgnav : IIgnavClient
    {
        public int Calls { get; private set; }

        public Task<JsonElement> SearchAsync(
            IgnavRoundTripRequest request,
            CancellationToken cancellationToken
        )
        {
            Calls++;
            return Task.FromResult(Response);
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
