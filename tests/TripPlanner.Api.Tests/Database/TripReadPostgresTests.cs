using System.Net;
using System.Net.Http.Json;
using System.Transactions;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Documents;
using TripPlanner.Api.Tests.Support;
using TripPlanner.SeedDatabase;

namespace TripPlanner.Api.Tests.Database;

[TestClass]
public sealed class TripReadPostgresTests
{
    [TestMethod]
    public async Task SeederReschedulesExistingVisitsWithoutOverlapOrDuplicateTrips()
    {
        await WithDatabase(
            async (_, database) =>
            {
                var owner = await database.GetOrCreateUserAsync(
                    new("google", "seed@example.com", "Owner")
                );
                var seeder = new DatabaseSeeder(database);
                var today = new DateOnly(2026, 11, 8);
                Assert.AreEqual(
                    new SeedResult(12, 0, 0),
                    await seeder.SeedAsync(owner.Id, 12, today.AddDays(-1))
                );
                var trips = await database.GetTripsAsync(owner.Id);
                var originalVisits = new List<DestinationVisit>();
                foreach (var trip in trips)
                {
                    originalVisits.AddRange(
                        await database.GetDestinationVisitsAsync(owner.Id, trip.Id)
                    );
                }

                Assert.AreEqual(
                    new SeedResult(0, 12, 0),
                    await seeder.SeedAsync(owner.Id, 12, today)
                );
                Assert.AreEqual(
                    new SeedResult(0, 0, 12),
                    await seeder.SeedAsync(owner.Id, 12, today)
                );
                Assert.HasCount(12, await database.GetTripsAsync(owner.Id));
                foreach (var trip in trips)
                {
                    var visits = await database.GetDestinationVisitsAsync(owner.Id, trip.Id);
                    foreach (var visit in visits)
                    {
                        var old = originalVisits.Single(original =>
                            original.StayId == visit.StayId
                        );
                        Assert.AreEqual(old.ArrivalDate!.Value.AddDays(1), visit.ArrivalDate);
                        Assert.AreEqual(visit.ArrivalDate!.Value.AddDays(3), visit.DepartureDate);
                    }
                }
                var past = await database.GetTripPageAsync(owner.Id, new(Past: true), today);
                Assert.HasCount(10, past.Trips);
                Assert.IsFalse(past.HasMore);
                var future = await database.GetTripPageAsync(owner.Id, new(Past: false), today);
                Assert.HasCount(2, future.Trips);
                Assert.IsTrue(future.Trips.All(trip => trip.StartDate > today));
            }
        );
    }

    [TestMethod]
    public async Task TripListPagesAndSearchesDatedTripsInPostgres()
    {
        await WithDatabase(
            async (_, database) =>
            {
                var owner = await database.GetOrCreateUserAsync(
                    new("google", "pages@example.com", "Owner")
                );
                var stranger = await database.GetOrCreateUserAsync(
                    new("google", "stranger@example.com", "Stranger")
                );
                var today = new DateOnly(2030, 6, 15);
                for (int index = 0; index < 15; index++)
                {
                    var trip = await database.CreateTripAsync(owner.Id, $"Trip {index:00}", "");
                    await database.SaveDestinationPlaceAsync(
                        owner.Id,
                        new(trip.Id, "paris-fr", "Paris", "FR", "Europe/Paris", 2.35, 48.86)
                    );
                    var date = today.AddDays(index - 2);
                    await database.AddDestinationVisitAsync(
                        owner.Id,
                        new(trip.Id, "paris-fr", Guid.NewGuid(), 0, date, date)
                    );
                }
                await database.CreateTripAsync(owner.Id, "Undated", "");
                var query = new TripListQuery(Past: false);
                var first = await database.GetTripPageAsync(owner.Id, query, today);
                var second = await database.GetTripPageAsync(
                    owner.Id,
                    query with
                    {
                        Skip = 10,
                    },
                    today
                );
                Assert.HasCount(10, first.Trips);
                Assert.IsTrue(first.HasMore);
                Assert.HasCount(4, second.Trips);
                Assert.IsFalse(second.HasMore);
                Assert.AreEqual("Trip 02", first.Trips[0].Name);
                Assert.AreEqual(today, first.Trips[0].StartDate);
                Assert.AreEqual(today, first.Trips[0].EndDate);
                Assert.IsTrue(first.Trips.All(trip => trip.CanPlan));
                Assert.AreEqual("Undated", second.Trips[^1].Name);
                var past = await database.GetTripPageAsync(
                    owner.Id,
                    query with
                    {
                        Past = true,
                    },
                    today
                );
                CollectionAssert.AreEqual(
                    new[] { "Trip 01", "Trip 00" },
                    past.Trips.Select(trip => trip.Name).ToArray()
                );
                var found = await database.GetTripPageAsync(
                    owner.Id,
                    query with
                    {
                        Search = "TRIP 14",
                    },
                    today
                );
                Assert.AreEqual("Trip 14", found.Trips.Single().Name);
                Assert.IsEmpty(
                    (
                        await database.GetTripPageAsync(
                            owner.Id,
                            query with
                            {
                                Search = "%",
                            },
                            today
                        )
                    ).Trips
                );
                Assert.IsEmpty((await database.GetTripPageAsync(stranger.Id, query, today)).Trips);
            }
        );
    }

    [TestMethod]
    public async Task MigrationMakesLegacyIdeasReadableInReadViews()
    {
        await WithDatabase(
            async (source, db) =>
            {
                var owner = await db.GetOrCreateUserAsync(
                    new("google", "legacy-idea@example.com", "Owner")
                );
                var trip = await db.CreateTripAsync(owner.Id, "Legacy trip", "");
                var place = await db.SaveDestinationPlaceAsync(
                    owner.Id,
                    new(trip.Id, "paris-fr", "Paris", "FR", "Europe/Paris", 2.35, 48.86)
                );
                await using (
                    var seed = source.CreateCommand(
                        """
                        WITH pending AS (DELETE FROM schema_migrations WHERE version IN (20, 22))
                        INSERT INTO activities(id, trip_id, city_id, properties)
                        VALUES (gen_random_uuid(), $1, $2, '{"name":"Museum","description":"","state":"idea"}');
                        """
                    )
                )
                {
                    seed.Parameters.AddWithValue(trip.Id);
                    seed.Parameters.AddWithValue(place.CityId);
                    await seed.ExecuteNonQueryAsync();
                }

                await new DatabaseMigrator(
                    source,
                    NullLogger<DatabaseMigrator>.Instance
                ).MigrateAsync();

                var readView = await db.ReadTripDataAsync(
                    owner.Id,
                    trip.Id,
                    CancellationToken.None
                );
                Assert.IsNotNull(readView);
                var activity = readView.Activities.Single();
                Assert.AreEqual("Museum", activity.Properties.Name);
                Assert.AreEqual(ActivityState.Maybe, activity.Properties.State);
            }
        );
    }

    [TestMethod]
    public async Task ReadViewReadsOneDatabaseVersionAcrossAConcurrentMultirowCommit()
    {
        await WithDatabase(
            async (source, db) =>
            {
                var user = await db.GetOrCreateUserAsync(
                    new("google", "readview@example.com", "ReadView")
                );
                var trip = await db.CreateTripAsync(user.Id, "Before", "");
                var place = await db.SaveDestinationPlaceAsync(
                    user.Id,
                    new(trip.Id, "paris-fr", "Before", "FR", "Europe/Paris", 2.35, 48.86)
                );
                var session = new PostgresTripDataSession(source);
                var readStarted = new TaskCompletionSource(
                    TaskCreationOptions.RunContinuationsAsynchronously
                );
                var writeDone = new TaskCompletionSource(
                    TaskCreationOptions.RunContinuationsAsynchronously
                );
                var read = session.ReadAsync(
                    async () =>
                    {
                        var first = await db.GetVisibleTripAsync(user.Id, trip.Id);
                        readStarted.SetResult();
                        await writeDone.Task.WaitAsync(TimeSpan.FromSeconds(30));
                        var destination = await db.GetDestinationPlaceAsync(
                            user.Id,
                            trip.Id,
                            place.CityId
                        );
                        var last = await db.GetVisibleTripAsync(user.Id, trip.Id);
                        return (
                            First: first!.Name,
                            Destination: destination!.Name,
                            Last: last!.Name
                        );
                    },
                    CancellationToken.None
                );
                await readStarted.Task.WaitAsync(TimeSpan.FromSeconds(30));
                await session.WriteAsync(
                    trip.Id,
                    async () =>
                    {
                        await db.UpdateTripAsync(user.Id, trip.Id, "After", "");
                        await db.ReplaceDestinationPlaceAsync(
                            user.Id,
                            place with
                            {
                                Name = "After",
                            }
                        );
                        return true;
                    },
                    CancellationToken.None
                );
                writeDone.SetResult();
                var captured = await read;
                Assert.AreEqual(("Before", "Before", "Before"), captured);
                Assert.IsNull(Transaction.Current);
                Assert.AreEqual("After", (await db.GetVisibleTripAsync(user.Id, trip.Id))!.Name);
                var readView = await new TripReader(db).ReadAsync(
                    user.Id,
                    trip.Id,
                    CancellationToken.None
                );
                Assert.AreEqual("After", readView!.Destinations.Single().Name);
            }
        );
    }

    [TestMethod]
    public async Task ConcurrentRestReplacementsHaveExactlyOneWinnerIncludingUppercaseNativeUrls()
    {
        await WithDatabase(
            async (source, db) =>
            {
                var user = await db.GetOrCreateUserAsync(
                    new("google", "native-db@example.com", "Native")
                );
                await db.SetUserProfileAsync(user.Id, new(new("Boston", -71, 42), []));
                var trip = await db.CreateTripAsync(user.Id, "Before", "");
                using var parent = new TestApplicationFactory();
                using var factory = parent.WithWebHostBuilder(builder =>
                    builder.ConfigureTestServices(services =>
                    {
                        services.RemoveAll<IPlannerDb>();
                        services.AddSingleton<IPlannerDb>(db);
                        services.RemoveAll<ITripDataSession>();
                        services.AddSingleton<ITripDataSession>(
                            new PostgresTripDataSession(source)
                        );
                    })
                );
                using var client = factory.CreateClient();
                client.DefaultRequestHeaders.Add("X-Test-Subject", user.Email);
                client.DefaultRequestHeaders.Add("X-Test-Email", user.Email);
                var path = $"/TRIPS/{trip.Id.ToString().ToUpperInvariant()}";
                using var initial = await client.GetAsync(path);
                initial.EnsureSuccessStatusCode();
                Assert.IsNotNull(initial.Headers.ETag);
                Assert.AreEqual(
                    (HttpStatusCode)428,
                    (
                        await client.PutAsJsonAsync(
                            path,
                            new UpdateTripRequest("Missing version", "")
                        )
                    ).StatusCode
                );
                async Task<HttpResponseMessage> Write(string name)
                {
                    using var request = new HttpRequestMessage(HttpMethod.Put, path)
                    {
                        Content = JsonContent.Create(new UpdateTripRequest(name, "")),
                    };
                    request.Headers.IfMatch.Add(initial.Headers.ETag);
                    return await client.SendAsync(request);
                }
                var responses = await Task.WhenAll(Write("One"), Write("Two"));
                CollectionAssert.AreEquivalent(
                    new[] { HttpStatusCode.OK, HttpStatusCode.PreconditionFailed },
                    responses.Select(r => r.StatusCode).ToArray()
                );
                foreach (var response in responses)
                {
                    response.Dispose();
                }
            }
        );
    }

    [TestMethod]
    public async Task LocalImportRetriesAreAtomicScopedAndSurviveTripDeletion()
    {
        await WithDatabase(
            async (source, db) =>
            {
                var owner = await db.GetOrCreateUserAsync(
                    new("google", "import@example.com", "Owner")
                );
                var other = await db.GetOrCreateUserAsync(
                    new("google", "other@example.com", "Other")
                );
                var store = new PostgresTripImportStore(source);
                var request = TripDocumentFixture.Create(
                    1,
                    Guid.NewGuid(),
                    "Device trip",
                    "Keep me",
                    System.Text.Json.JsonSerializer.SerializeToElement(new { budget = 500 })
                );
                var transfer = Guid.NewGuid();
                var results = await Task.WhenAll(
                    Enumerable
                        .Range(0, 8)
                        .Select(_ =>
                            store.ImportAsync(owner.Id, transfer, request, CancellationToken.None)
                        )
                );
                Assert.AreEqual(1, results.Count(result => result.Status == 201));
                Assert.AreEqual(7, results.Count(result => result.Status == 200));
                Assert.IsTrue(results.All(result => result.Trip!.Id == request.Id));
                Assert.HasCount(1, await db.GetTripsAsync(owner.Id));
                Assert.HasCount(1, await db.GetPartiesAsync(owner.Id, request.Id));
                Assert.AreEqual(
                    404,
                    (await store.GetAsync(other.Id, transfer, CancellationToken.None)).Status
                );
                Assert.AreEqual(
                    409,
                    (
                        await store.ImportAsync(
                            other.Id,
                            Guid.NewGuid(),
                            request,
                            CancellationToken.None
                        )
                    ).Status
                );
                Assert.AreEqual(
                    409,
                    (
                        await store.ImportAsync(
                            owner.Id,
                            transfer,
                            request with
                            {
                                Name = "Different payload",
                            },
                            CancellationToken.None
                        )
                    ).Status
                );
                await db.DeleteTripAsync(owner.Id, request.Id);
                Assert.AreEqual(
                    410,
                    (
                        await store.ImportAsync(owner.Id, transfer, request, CancellationToken.None)
                    ).Status
                );
                Assert.AreEqual(
                    410,
                    (await store.GetAsync(owner.Id, transfer, CancellationToken.None)).Status
                );
                Assert.IsEmpty(await db.GetTripsAsync(owner.Id));
            }
        );
    }

    [TestMethod]
    public async Task InvalidLocalImportLeavesNoReceiptOrTrip()
    {
        await WithDatabase(
            async (source, db) =>
            {
                var owner = await db.GetOrCreateUserAsync(
                    new("google", "invalid-import@example.com", "Owner")
                );
                var store = new PostgresTripImportStore(source);
                var request = TripDocumentFixture.Create(
                    1,
                    Guid.NewGuid(),
                    new string('x', 201),
                    "",
                    System.Text.Json.JsonSerializer.SerializeToElement(new { })
                );
                var transfer = Guid.NewGuid();
                await Assert.ThrowsAsync<PostgresException>(() =>
                    store.ImportAsync(owner.Id, transfer, request, CancellationToken.None)
                );
                Assert.IsEmpty(await db.GetTripsAsync(owner.Id));
                Assert.AreEqual(
                    404,
                    (await store.GetAsync(owner.Id, transfer, CancellationToken.None)).Status
                );
            }
        );
    }

    internal static async Task WithDatabase(Func<NpgsqlDataSource, PostgresPlannerDb, Task> test)
    {
        var connection = Environment.GetEnvironmentVariable("TRIPPLANNER_TEST_POSTGRES");
        if (string.IsNullOrWhiteSpace(connection))
        {
            Assert.Inconclusive(
                "Set TRIPPLANNER_TEST_POSTGRES to enable isolated PostgreSQL readView tests."
            );
            return;
        }
        var name = "read_view_test_" + Guid.NewGuid().ToString("N");
        await using var admin = NpgsqlDataSource.Create(connection);
        await using (var create = admin.CreateCommand($"CREATE DATABASE {name}"))
        {
            await create.ExecuteNonQueryAsync();
        }
        try
        {
            var settings = new NpgsqlConnectionStringBuilder(connection)
            {
                Database = name,
                SearchPath = "gustavo_planner,public",
            };
            await using var source = NpgsqlDataSource.Create(settings.ConnectionString);
            await new DatabaseMigrator(
                source,
                NullLogger<DatabaseMigrator>.Instance
            ).MigrateAsync();
            await test(source, new PostgresPlannerDb(source));
        }
        finally
        {
            await using var drop = admin.CreateCommand($"DROP DATABASE {name} WITH (FORCE)");
            await drop.ExecuteNonQueryAsync();
        }
    }
}
