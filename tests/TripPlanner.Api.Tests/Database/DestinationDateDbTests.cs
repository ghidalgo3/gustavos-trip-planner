using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Tests.Database;

[TestClass]
public sealed class DestinationDateDbTests
{
    [TestMethod]
    public Task ConcurrentVisits_InMemory() => Verify(new InMemoryPlannerDb());

    [TestMethod]
    public async Task ConcurrentVisits_Postgres()
    {
        string? connectionString = Environment.GetEnvironmentVariable("TRIPPLANNER_TEST_POSTGRES");
        if (string.IsNullOrEmpty(connectionString))
        {
            Assert.Inconclusive("Set TRIPPLANNER_TEST_POSTGRES to run PostgreSQL date tests.");
        }
        string name = "planner_dates_" + Guid.NewGuid().ToString("N");
        await using var admin = NpgsqlDataSource.Create(connectionString!);
        await using (var create = admin.CreateCommand($"CREATE DATABASE {name}"))
        {
            await create.ExecuteNonQueryAsync();
        }
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
            await Verify(new PostgresPlannerDb(source));
            await Verify(
                AuditedPlannerDb.Create(
                    new PostgresPlannerDb(source),
                    new PostgresActivityLogStore(source),
                    new HttpContextAccessor(),
                    TimeProvider.System
                )
            );
        }
        finally
        {
            await using var drop = admin.CreateCommand($"DROP DATABASE {name} WITH (FORCE)");
            await drop.ExecuteNonQueryAsync();
        }
    }

    private static async Task Verify(IPlannerDb database)
    {
        var user = await database.GetOrCreateUserAsync(
            new("google", "dates@example.com", "Planner")
        );
        var trip = await database.CreateTripAsync(user.Id, "Date constraints", "");
        foreach (string city in new[] { "paris-fr", "lyon-fr" })
        {
            await database.SaveDestinationPlaceAsync(
                user.Id,
                new(trip.Id, city, city, "FR", "Europe/Paris", 2.35, 48.86)
            );
        }
        async Task<bool> Add(string city)
        {
            try
            {
                return await database.AddDestinationVisitAsync(
                    user.Id,
                    new(trip.Id, city, Guid.NewGuid(), 0, new(2027, 6, 10), new(2027, 6, 15))
                )
                    is not null;
            }
            catch (DestinationDatesOverlapException)
            {
                return false;
            }
        }
        var results = await Task.WhenAll(
            Task.Run(() => Add("paris-fr")),
            Task.Run(() => Add("lyon-fr"))
        );
        Assert.AreEqual(
            1,
            results.Count(success => success),
            "Concurrent overlapping creates must not both succeed."
        );
        var first = (await database.GetDestinationVisitsAsync(user.Id, trip.Id)).Single();
        string otherCity = first.CityId == "paris-fr" ? "lyon-fr" : "paris-fr";
        var second = (
            await database.AddDestinationVisitAsync(
                user.Id,
                new(trip.Id, otherCity, Guid.NewGuid(), 1, new(2027, 6, 15), new(2027, 6, 20))
            )
        )!;
        await Assert.ThrowsAsync<DestinationDatesOverlapException>(() =>
            database.ReplaceDestinationVisitAsync(
                user.Id,
                trip.Id,
                first.CityId,
                first.StayId,
                new(new(2027, 6, 10), new(2027, 6, 16))
            )
        );
        Assert.AreEqual(
            new DateOnly(2027, 6, 15),
            (await database.GetDestinationVisitsAsync(user.Id, trip.Id))
                .Single(v => v.StayId == first.StayId)
                .DepartureDate
        );
        Assert.IsNotNull(
            await database.ReplaceDestinationVisitAsync(
                user.Id,
                trip.Id,
                second.CityId,
                second.StayId,
                new(new(2027, 6, 16), new(2027, 6, 20))
            )
        );
    }
}
