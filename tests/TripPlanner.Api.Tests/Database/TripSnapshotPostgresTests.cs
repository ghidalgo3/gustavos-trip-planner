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
using TripPlanner.Api.Services.Snapshots;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Database;

[TestClass]
public sealed class TripSnapshotPostgresTests
{
    [TestMethod]
    public async Task SnapshotReadsOneDatabaseVersionAcrossAConcurrentMultirowCommit()
    {
        await WithDatabase(
            async (source, db) =>
            {
                var user = await db.GetOrCreateUserAsync(
                    new("google", "snapshot@example.com", "Snapshot")
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
                var snapshot = await new TripSnapshotReader(db, session).ReadAsync(
                    user.Id,
                    trip.Id,
                    CancellationToken.None
                );
                Assert.AreEqual("After", snapshot!.Destinations.Single().Name);
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
    public async Task TravelVersionsAndVisitDeletionCleanupAreEnforcedByPostgres()
    {
        await WithDatabase(
            async (_, db) =>
            {
                var user = await db.GetOrCreateUserAsync(
                    new("google", "travel-db@example.com", "Travel")
                );
                var trip = await db.CreateTripAsync(user.Id, "Travel", "");
                var place = await db.SaveDestinationPlaceAsync(
                    user.Id,
                    new(trip.Id, "paris-fr", "Paris", "FR", "Europe/Paris", 2.35, 48.86)
                );
                var visit = (
                    await db.AddDestinationVisitAsync(
                        user.Id,
                        new(trip.Id, place.CityId, Guid.NewGuid(), 0, null, null)
                    )
                )!;
                var connection = new TripTravelConnection(
                    Guid.NewGuid(),
                    "Train",
                    new(TripSnapshotProjection.LocalId(trip.Id, "place", "home"), null, null),
                    new(null, null, visit.StayId),
                    "train",
                    "user",
                    null,
                    null,
                    null,
                    null,
                    null,
                    []
                );
                var context = await db.GetActivityPlanningRevisionAsync(user.Id, trip.Id);
                var saved = await db.SaveTripTravelAsync(
                    user.Id,
                    trip.Id,
                    [connection],
                    0,
                    context
                );
                Assert.IsNotNull(saved);
                Assert.IsNull(await db.SaveTripTravelAsync(user.Id, trip.Id, [], 0, context));
                Assert.AreEqual(
                    "train",
                    (await db.GetTripTravelAsync(user.Id, trip.Id)).Connections.Single().Mode
                );
                await db.DeleteDestinationVisitAsync(user.Id, trip.Id, place.CityId, visit.StayId);
                var after = await db.GetTripTravelAsync(user.Id, trip.Id);
                Assert.IsEmpty(after.Connections);
                Assert.AreEqual(saved.Version + 1, after.Version);
            }
        );
    }

    private static async Task WithDatabase(Func<NpgsqlDataSource, PostgresPlannerDb, Task> test)
    {
        var connection = Environment.GetEnvironmentVariable("TRIPPLANNER_TEST_POSTGRES");
        if (string.IsNullOrWhiteSpace(connection))
        {
            Assert.Inconclusive(
                "Set TRIPPLANNER_TEST_POSTGRES to enable isolated PostgreSQL snapshot tests."
            );
            return;
        }
        var name = "snapshot_test_" + Guid.NewGuid().ToString("N");
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
