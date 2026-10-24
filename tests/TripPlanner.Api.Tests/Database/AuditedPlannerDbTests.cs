using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Tests.Database;

[TestClass]
public sealed class AuditedPlannerDbTests
{
    [TestMethod]
    public async Task PostgreSql_MutationAndAuditCommitTogether_AndOAuthSchemaMatchesTheLibrary()
    {
        string? connectionString = Environment.GetEnvironmentVariable("TRIPPLANNER_TEST_POSTGRES");
        if (string.IsNullOrEmpty(connectionString))
        {
            Assert.Inconclusive("Set TRIPPLANNER_TEST_POSTGRES to run PostgreSQL audit tests.");
        }

        string name = "planner_test_" + Guid.NewGuid().ToString("N");
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
            var database = new PostgresPlannerDb(source);
            var store = new PostgresActivityLogStore(source);
            var audited = AuditedPlannerDb.Create(
                database,
                store,
                new HttpContextAccessor(),
                TimeProvider.System
            );
            var user = await database.GetOrCreateUserAsync(
                new("google", "owner@example.com", "Owner")
            );
            var trip = await audited.CreateTripAsync(user.Id, "Audited trip", "");
            Assert.HasCount(1, await store.ListAsync(user.Id, 100, 0, default));
            Assert.HasCount(1, await database.GetTripsAsync(user.Id));
            Assert.IsNull(
                await audited.UpdateTripAsync(Guid.NewGuid(), trip.Id, "Unauthorized", "")
            );
            Assert.HasCount(1, await store.ListAsync(user.Id, 100, 0, default));
            var failing = AuditedPlannerDb.Create(
                database,
                new FailingLogStore(),
                new HttpContextAccessor(),
                TimeProvider.System
            );
            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                failing.CreateTripAsync(user.Id, "Must roll back", "")
            );
            Assert.HasCount(
                1,
                await database.GetTripsAsync(user.Id),
                "A failed audit insert must roll back the trip and its party."
            );
            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                failing.UpdateTripAsync(user.Id, trip.Id, "Must also roll back", "")
            );
            Assert.AreEqual("Audited trip", (await database.GetTripAsync(user.Id, trip.Id))!.Name);
            Assert.IsTrue(await audited.DeleteTripAsync(user.Id, trip.Id));
            Assert.HasCount(2, await store.ListAsync(user.Id, 100, 0, default));
            await using (var tamper = source.CreateCommand("DELETE FROM trip_activity_log"))
            {
                await Assert.ThrowsAsync<PostgresException>(() => tamper.ExecuteNonQueryAsync());
            }

            var options =
                new Microsoft.EntityFrameworkCore.DbContextOptionsBuilder<OAuthDbContext>();
            Microsoft.EntityFrameworkCore.NpgsqlDbContextOptionsBuilderExtensions.UseNpgsql(
                options,
                source
            );
            using var oauth = new OAuthDbContext(options.Options);
            oauth
                .Set<OpenIddict.EntityFrameworkCore.Models.OpenIddictEntityFrameworkCoreApplication>()
                .Add(new() { ClientId = "schema-test", ClientType = "public" });
            await oauth.SaveChangesAsync();
        }
        finally
        {
            await using var drop = admin.CreateCommand($"DROP DATABASE {name} WITH (FORCE)");
            await drop.ExecuteNonQueryAsync();
        }
    }

    private sealed class FailingLogStore : IActivityLogStore
    {
        public Task AppendAsync(TripMutation entry, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Simulated audit failure");

        public Task<IReadOnlyList<TripMutation>> ListAsync(
            Guid userId,
            int take,
            int skip,
            CancellationToken cancellationToken
        ) => throw new NotSupportedException();
    }
}
