using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Spatial;
using Npgsql;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.TripForms;
using static TripPlanner.Api.Tests.Support.OperationFixture;

namespace TripPlanner.Api.Tests.Database;

[TestClass]
public sealed class PlannerDbTests
{
    [TestMethod]
    public async Task QueueContract_InMemory()
    {
        var db = new InMemoryPlannerDb();
        await QueueContract(db);
        await QueuePriorityContract(db);
        await TripFormQueueContract(db);
        await DestinationContract(db);
        await ResourceConstraintsContract(db);
        await PartyRolesContract(db);
    }

    [TestMethod]
    public async Task QueueContract_Postgres()
    {
        var connectionString = Environment.GetEnvironmentVariable("TRIPPLANNER_TEST_POSTGRES");
        if (string.IsNullOrEmpty(connectionString))
        {
            Assert.Inconclusive(
                "Set TRIPPLANNER_TEST_POSTGRES to run isolated PostgreSQL queue tests."
            );
        }

        var name = "planner_test_" + Guid.NewGuid().ToString("N");
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
                Assert.AreEqual(14L, reader.GetInt64(0));
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
            await DestinationContract(db);
            await ResourceConstraintsContract(db);
            await PartyRolesContract(db);
            await MigrationPreservesFlightPlanning(source);
            await MigrationUpgradesActivityJobs(source);
            await MigrationUpgradesClockTimes(source);
            await MigrationUpgradesDurations(source);
            await MigrationRetiresTransit(source);
        }
        finally
        {
            await using var drop = admin.CreateCommand($"DROP DATABASE {name} WITH (FORCE)");
            await drop.ExecuteNonQueryAsync();
        }
    }

    private static async Task MigrationRetiresTransit(NpgsqlDataSource source)
    {
        var db = new PostgresPlannerDb(source);
        var (user, _, _) = await Seed(db);
        var (trip, _, _, _) = await Support.ActivityPlanningFixture.SeedDatabase(db, user);
        await using (
            var legacy = source.CreateCommand(
                """
                WITH preferences AS (INSERT INTO activity_preferences(subject_id,scope,city_id,version,preferences)
                    VALUES($1,'profile','',1,'{"instructions":"Prefer transit museums","defaults":{"transportMode":"transit"}}')),
                plans AS (INSERT INTO activity_plans(trip_id,city_id,version,input_revision,plan,assessment,saved_at)
                    VALUES($2,'paris-fr',1,1,'{"settings":{"transportMode":"transit"},"days":[{"settings":{"transportMode":"transit"}}],"transportOverrides":[{"mode":"transit","duration":"PT20M"},{"mode":"taxi","duration":"PT10M"}]}',
                    '{"travelDuration":"PT20M"}',now())),
                evidence AS (INSERT INTO activity_planning_evidence(trip_id,city_id,evidence)
                    VALUES($2,'paris-fr','{"routes":[{"mode":"transit"},{"mode":"walking"}]}'))
                DELETE FROM schema_migrations WHERE version=14;
                """
            )
        )
        {
            legacy.Parameters.AddWithValue(user.Id);
            legacy.Parameters.AddWithValue(trip.Id);
            await legacy.ExecuteNonQueryAsync();
        }
        await new DatabaseMigrator(source, NullLogger<DatabaseMigrator>.Instance).MigrateAsync();
        await using var check = source.CreateCommand(
            """
            SELECT p.plan::text, p.assessment::text, p.version,
                (SELECT preferences::text FROM activity_preferences WHERE subject_id=$1 AND scope='profile'),
                (SELECT evidence::text FROM activity_planning_evidence WHERE trip_id=$2 AND city_id='paris-fr'),
                (SELECT revision FROM activity_planning_versions WHERE trip_id=$2) > p.input_revision
            FROM activity_plans p WHERE p.trip_id=$2 AND p.city_id='paris-fr';
            """
        );
        check.Parameters.AddWithValue(user.Id);
        check.Parameters.AddWithValue(trip.Id);
        await using var reader = await check.ExecuteReaderAsync();
        Assert.IsTrue(await reader.ReadAsync());
        using var plan = JsonDocument.Parse(reader.GetString(0));
        Assert.AreEqual(
            "walking",
            plan.RootElement.GetProperty("settings").GetProperty("transportMode").GetString()
        );
        Assert.AreEqual(
            "walking",
            plan.RootElement.GetProperty("days")[0]
                .GetProperty("settings")
                .GetProperty("transportMode")
                .GetString()
        );
        var overrides = plan.RootElement.GetProperty("transportOverrides");
        Assert.AreEqual("walking", overrides[0].GetProperty("mode").GetString());
        Assert.AreEqual(JsonValueKind.Null, overrides[0].GetProperty("duration").ValueKind);
        Assert.AreEqual("PT10M", overrides[1].GetProperty("duration").GetString());
        Assert.AreEqual(2L, reader.GetInt64(2));
        StringAssert.Contains(reader.GetString(1), "PT20M");
        StringAssert.Contains(reader.GetString(3), "Prefer transit museums");
        StringAssert.Contains(reader.GetString(3), "walking");
        Assert.DoesNotContain("transit", reader.GetString(4));
        Assert.IsTrue(reader.GetBoolean(5));
    }

    private static async Task MigrationUpgradesDurations(NpgsqlDataSource source)
    {
        var db = new PostgresPlannerDb(source);
        var (user, _, _) = await Seed(db);
        var (trip, _, place, activity) = await Support.ActivityPlanningFixture.SeedDatabase(
            db,
            user
        );
        await using (
            var legacy = source.CreateCommand(
                """
                WITH activity AS (UPDATE activities SET properties = (properties - 'duration') || '{"durationMinutes":90}' WHERE id=$1),
                preferences AS (INSERT INTO activity_preferences(subject_id,scope,city_id,version,preferences)
                    VALUES($2,'profile','',1,'{"instructions":"90 minutes","defaults":{"slackMinutes":60}}')),
                plans AS (INSERT INTO activity_plans(trip_id,city_id,version,input_revision,plan,assessment,saved_at)
                    VALUES($3,'paris-fr',1,1,'{"settings":{"breakfastMinutes":30},"transportOverrides":[{"minutes":null}]}',
                        '{"travelMinutes":90,"days":[{"availableMinutes":1500,"breaks":[{"minutes":30}]}]}',now())),
                evidence AS (INSERT INTO activity_planning_evidence(trip_id,city_id,evidence)
                    VALUES($3,'paris-fr','{"routes":[{"minutes":90,"walkingMinutes":10,"waitingMinutes":0}]}'))
                DELETE FROM schema_migrations WHERE version = 13;
                """
            )
        )
        {
            legacy.Parameters.AddWithValue(activity.Id);
            legacy.Parameters.AddWithValue(user.Id);
            legacy.Parameters.AddWithValue(trip.Id);
            await legacy.ExecuteNonQueryAsync();
        }
        var migrator = new DatabaseMigrator(source, NullLogger<DatabaseMigrator>.Instance);
        await migrator.MigrateAsync();
        await migrator.MigrateAsync();
        Assert.AreEqual(
            TimeSpan.FromMinutes(90),
            (await db.GetActivityAsync(user.Id, trip.Id, place.CityId, activity.Id))!
                .Properties
                .Duration
        );
        await using var read = source.CreateCommand(
            """
            SELECT a.plan::text,a.assessment::text,e.evidence::text,p.preferences::text
            FROM activity_plans a JOIN activity_planning_evidence e USING(trip_id,city_id),activity_preferences p
            WHERE a.trip_id=$1 AND p.subject_id=$2;
            """
        );
        read.Parameters.AddWithValue(trip.Id);
        read.Parameters.AddWithValue(user.Id);
        await using var reader = await read.ExecuteReaderAsync();
        Assert.IsTrue(await reader.ReadAsync());
        using var plan = JsonDocument.Parse(reader.GetString(0));
        Assert.AreEqual(
            "PT30M",
            plan.RootElement.GetProperty("settings").GetProperty("breakfastDuration").GetString()
        );
        Assert.AreEqual(
            JsonValueKind.Null,
            plan.RootElement.GetProperty("transportOverrides")[0].GetProperty("duration").ValueKind
        );
        using var assessment = JsonDocument.Parse(reader.GetString(1));
        Assert.AreEqual("PT90M", assessment.RootElement.GetProperty("travelDuration").GetString());
        Assert.AreEqual(
            "PT1500M",
            assessment
                .RootElement.GetProperty("days")[0]
                .GetProperty("availableDuration")
                .GetString()
        );
        using var evidence = JsonDocument.Parse(reader.GetString(2));
        Assert.AreEqual(
            "PT0M",
            evidence.RootElement.GetProperty("routes")[0].GetProperty("waitingDuration").GetString()
        );
        var preferences = JsonSerializer.Deserialize<ActivityPreferences>(
            reader.GetString(3),
            JsonSerializerOptions.Web
        )!;
        Assert.AreEqual("90 minutes", preferences.Instructions);
        Assert.AreEqual(TimeSpan.FromHours(1), preferences.Defaults!.SlackDuration);
    }

    private static async Task MigrationUpgradesClockTimes(NpgsqlDataSource source)
    {
        var db = new PostgresPlannerDb(source);
        var (user, trip, _) = await Seed(db);
        await db.SaveDestinationPlaceAsync(
            user.Id,
            new(trip.Id, "paris-fr", "Paris", "FR", "", 2.35, 48.85)
        );
        await using (
            var legacy = source.CreateCommand(
                """
                WITH preferences AS (INSERT INTO activity_preferences(subject_id,scope,city_id,version,preferences)
                VALUES ($1,'profile','',1,'{"instructions":"09:00","defaults":{"sleepStart":"23:00","sleepEnd":"07:00"}}')),
                plans AS (INSERT INTO activity_plans(trip_id,city_id,version,input_revision,plan,assessment,saved_at)
                VALUES ($2,'paris-fr',1,1,'{"settings":{"sleepStart":"23:00","sleepEnd":"07:00"},"days":[{"availableFrom":"09:00","availableUntil":null}],"rules":[{"fixedStart":"10:30","openingWindows":[{"start":"09:00","end":"18:00:00"}]}]}','{}',now())),
                evidence AS (INSERT INTO activity_planning_evidence(trip_id,city_id,evidence)
                VALUES ($2,'paris-fr','{"hours":[{"windows":[{"date":"2027-06-10","start":"09:00","end":"18:00"}]}]}'))
                DELETE FROM schema_migrations WHERE version = 12;
                """
            )
        )
        {
            legacy.Parameters.AddWithValue(user.Id);
            legacy.Parameters.AddWithValue(trip.Id);
            await legacy.ExecuteNonQueryAsync();
        }
        var migrator = new DatabaseMigrator(source, NullLogger<DatabaseMigrator>.Instance);
        await migrator.MigrateAsync();
        await migrator.MigrateAsync();
        await using var read = source.CreateCommand(
            """
            SELECT p.preferences::text, a.plan::text, e.evidence::text
            FROM activity_preferences p, activity_plans a JOIN activity_planning_evidence e USING(trip_id,city_id)
            WHERE p.subject_id=$1 AND a.trip_id=$2;
            """
        );
        read.Parameters.AddWithValue(user.Id);
        read.Parameters.AddWithValue(trip.Id);
        await using var reader = await read.ExecuteReaderAsync();
        Assert.IsTrue(await reader.ReadAsync());
        var preferences = JsonSerializer.Deserialize<ActivityPreferences>(
            reader.GetString(0),
            JsonSerializerOptions.Web
        )!;
        Assert.AreEqual("09:00", preferences.Instructions);
        Assert.AreEqual(new TimeOnly(23, 0), preferences.Defaults!.SleepStart);
        using var plan = JsonDocument.Parse(reader.GetString(1));
        Assert.AreEqual(
            "09:00:00",
            plan.RootElement.GetProperty("days")[0].GetProperty("availableFrom").GetString()
        );
        Assert.AreEqual(
            JsonValueKind.Null,
            plan.RootElement.GetProperty("days")[0].GetProperty("availableUntil").ValueKind
        );
        var rule = plan.RootElement.GetProperty("rules")[0];
        Assert.AreEqual("10:30:00", rule.GetProperty("fixedStart").GetString());
        Assert.AreEqual(
            "18:00:00",
            rule.GetProperty("openingWindows")[0].GetProperty("end").GetString()
        );
        using var evidence = JsonDocument.Parse(reader.GetString(2));
        var window = evidence.RootElement.GetProperty("hours")[0].GetProperty("windows")[0];
        Assert.AreEqual("2027-06-10", window.GetProperty("date").GetString());
        Assert.AreEqual("09:00:00", window.GetProperty("start").GetString());
    }

    private static async Task PartyRolesContract(IPlannerDb db)
    {
        var (owner, trip, party) = await Seed(db);
        var member = await db.GetOrCreateUserAsync(
            new("google", $"{Guid.NewGuid()}@example.com", "Planner")
        );
        await db.ChangePartyMemberAsync(owner.Id, trip.Id, party.Id, member.Id, true);
        Assert.AreEqual(
            PartyRole.Traveller,
            (await db.GetPartiesAsync(owner.Id, trip.Id)).Single().RoleFor(member.Id)
        );
        Assert.IsNull(await db.GetTripAsync(member.Id, trip.Id));
        await db.ChangePartyMemberAsync(
            owner.Id,
            trip.Id,
            party.Id,
            member.Id,
            true,
            role: PartyRole.Planner
        );
        Assert.AreEqual(
            PartyRole.Planner,
            (await db.GetPartiesAsync(member.Id, trip.Id)).Single().RoleFor(member.Id)
        );
        Assert.IsNotNull(await db.GetTripAsync(member.Id, trip.Id));
        Assert.IsNotNull(await db.UpdateTripAsync(member.Id, trip.Id, "Shared planning", ""));
        var place = await db.SaveDestinationPlaceAsync(
            member.Id,
            new(trip.Id, "paris-fr", "Paris", "FR", "", 2.35, 48.85)
        );
        Assert.IsNotNull(
            await db.AddDestinationVisitAsync(
                member.Id,
                new(trip.Id, place.CityId, Guid.NewGuid(), 0, null, null)
            )
        );
        place = (await db.GetDestinationPlaceAsync(member.Id, trip.Id, place.CityId))!;
        var stayLocation = new GeoJsonFeature<StayLocationProperties>(
            "Feature",
            "stay",
            new("Point", GeographyPoint.Create(latitude: 48.86, longitude: 2.34)),
            new("Hotel")
        );
        Assert.IsTrue(
            await db.SaveStayLocationAsync(member.Id, trip.Id, place.CityId, stayLocation)
        );
        Assert.AreEqual(
            "Hotel",
            (await db.GetStayLocationsAsync(owner.Id, trip.Id))[place.CityId].Properties.Name
        );
        var now = DateTimeOffset.UtcNow;
        var activity = new Activity(
            Guid.NewGuid(),
            trip.Id,
            place.CityId,
            null,
            new("Museum", TimeSpan.FromHours(1), "", null, ActivityState.Proposed),
            now,
            now
        );
        Assert.IsNotNull(
            await db.SaveActivityAsync(member.Id, activity, place.ContextVersion, null)
        );
        Assert.IsNotNull(
            await db.SetFlightConstraintsAsync(
                member.Id,
                trip.Id,
                JsonSerializer.SerializeToElement(new PlanningDocument(), JsonSerializerOptions.Web)
            )
        );
        Assert.AreEqual(
            PartyMemberChangeStatus.PartyNotFound,
            await db.ChangePartyMemberAsync(member.Id, trip.Id, party.Id, owner.Id, false)
        );
        Assert.IsFalse(await db.DeleteTripAsync(member.Id, trip.Id));
        await db.ChangePartyMemberAsync(
            owner.Id,
            trip.Id,
            party.Id,
            member.Id,
            true,
            role: PartyRole.Traveller
        );
        Assert.IsNull(await db.GetTripAsync(member.Id, trip.Id));
        Assert.IsNull(await db.UpdateTripAsync(member.Id, trip.Id, "Unauthorized", ""));
        Assert.IsFalse(await db.SaveStayLocationAsync(member.Id, trip.Id, place.CityId, null));
        Assert.IsTrue(await db.SaveStayLocationAsync(owner.Id, trip.Id, place.CityId, null));
        Assert.IsEmpty(await db.GetStayLocationsAsync(owner.Id, trip.Id));
        await db.ChangePartyMemberAsync(owner.Id, trip.Id, party.Id, member.Id, false);
        Assert.IsFalse(
            (await db.GetPartiesAsync(owner.Id, trip.Id))
                .Single()
                .MemberRoles.ContainsKey(member.Id)
        );
    }

    private static async Task ResourceConstraintsContract(IPlannerDb db)
    {
        var (user, trip, _) = await Seed(db);
        var constraints = JsonSerializer.SerializeToElement(new { budget = 1234 });
        var flightConstraints = JsonSerializer.SerializeToElement(
            new PlanningDocument { AiPrompt = "Direct flights" },
            JsonSerializerOptions.Web
        );
        await db.UpdateTripAsync(user.Id, trip.Id, "Europe", "Museums", constraints: constraints);
        await db.SetFlightConstraintsAsync(user.Id, trip.Id, flightConstraints);
        var fetched = (await db.GetVisibleTripAsync(user.Id, trip.Id))!;
        Assert.AreEqual(1234, fetched.Constraints.GetProperty("budget").GetInt32());
        Assert.AreEqual(
            "Direct flights",
            PlanningDocument.FromJson(fetched.FlightConstraints).AiPrompt
        );
        var place = await db.SaveDestinationPlaceAsync(
            user.Id,
            new(trip.Id, "paris-fr", "Paris", "FR", "", 2.35, 48.85) { Constraints = constraints }
        );
        Assert.AreEqual(1234, place.Constraints.GetProperty("budget").GetInt32());
        await db.AddDestinationVisitAsync(
            user.Id,
            new(trip.Id, place.CityId, Guid.NewGuid(), 0, null, null)
        );
        place = (await db.GetDestinationPlaceAsync(user.Id, trip.Id, place.CityId))!;
        var operationId = Guid.NewGuid();
        await db.CreateActivityJobAsync(
            user.Id,
            trip.Id,
            operationId,
            place.CityId,
            place.ContextVersion,
            "Museum",
            null,
            null
        );
        Assert.IsNull(
            await db.GetActivityJobResultAsync(user.Id, trip.Id, place.CityId, operationId)
        );
        Assert.IsNull(
            await db.GetActivityJobResultAsync(user.Id, trip.Id, place.CityId, Guid.NewGuid())
        );
        var workerJob = (await db.ClaimActivityJobAsync(TimeSpan.FromMinutes(1)))!;
        Assert.IsNull(
            await db.GetActivityJobResultAsync(user.Id, trip.Id, place.CityId, operationId)
        );
        var log = new InMemoryActivityLogStore(db);
        var audited = AuditedPlannerDb.Create(
            db,
            log,
            new HttpContextAccessor(),
            TimeProvider.System
        );
        var saved = await db.ReplaceDestinationPlaceAsync(
            user.Id,
            place with
            {
                Name = "Paris city",
                Longitude = 2.3,
                Constraints = JsonSerializer.SerializeToElement(new { accessible = true }),
            }
        );
        Assert.IsNotNull(saved);
        Assert.AreEqual("Paris city", saved.Name);
        Assert.AreEqual(2.3, saved.Longitude);
        Assert.IsTrue(saved.Constraints.GetProperty("accessible").GetBoolean());
        Assert.AreNotEqual(place.ContextVersion, saved.ContextVersion);
        // Failure must commit even when auditing reads the job's null result.
        Assert.IsTrue(await audited.CompleteActivityJobAsync(workerJob, [], [], null));
        Assert.AreEqual("Failed", (await db.GetOperationAsync(user.Id, operationId))!.Status);
        Assert.IsNull(
            await db.GetActivityJobResultAsync(user.Id, trip.Id, place.CityId, operationId)
        );
        Assert.IsNull(await db.ClaimActivityJobAsync(TimeSpan.FromMinutes(1)));
        Assert.IsEmpty(await log.ListAsync(user.Id, 10, 0, CancellationToken.None));
        var now = DateTimeOffset.UtcNow;
        var activity = new Activity(
            Guid.NewGuid(),
            trip.Id,
            place.CityId,
            null,
            new("Museum", TimeSpan.FromHours(1), "", null, ActivityState.Planned),
            now,
            now
        );
        var nextOperationId = Guid.NewGuid();
        await db.CreateActivityJobAsync(
            user.Id,
            trip.Id,
            nextOperationId,
            place.CityId,
            saved.ContextVersion,
            "Museum",
            null,
            null
        );
        var freshJob = (await db.ClaimActivityJobAsync(TimeSpan.FromMinutes(1)))!;
        Assert.IsTrue(await audited.CompleteActivityJobAsync(freshJob, [activity], [], null));
        Assert.AreEqual(
            "Completed",
            (await db.GetOperationAsync(user.Id, nextOperationId))!.Status
        );
        Assert.IsNotNull(await db.GetActivityAsync(user.Id, trip.Id, place.CityId, activity.Id));
        var result = await db.GetActivityJobResultAsync(
            user.Id,
            trip.Id,
            place.CityId,
            nextOperationId
        );
        Assert.IsNotNull(result);
        Assert.AreEqual(activity.Id.ToString(), result.Activities.Features.Single().Id);
        Assert.IsNull(
            await db.GetActivityJobResultAsync(
                Guid.NewGuid(),
                trip.Id,
                place.CityId,
                nextOperationId
            )
        );
        Assert.HasCount(1, await log.ListAsync(user.Id, 10, 0, CancellationToken.None));
        Assert.IsTrue(await db.DeleteDestinationAsync(user.Id, trip.Id, place.CityId));
        Assert.IsNull(await db.GetDestinationPlaceAsync(user.Id, trip.Id, place.CityId));
        Assert.IsEmpty(await db.GetDestinationVisitsAsync(user.Id, trip.Id));
        Assert.IsNull(await db.GetActivityAsync(user.Id, trip.Id, place.CityId, activity.Id));
        Assert.IsNull(await db.GetOperationAsync(user.Id, operationId));
        Assert.IsNull(await db.GetOperationAsync(user.Id, nextOperationId));
        Assert.IsFalse(await db.DeleteDestinationAsync(user.Id, trip.Id, place.CityId));
    }

    private static async Task MigrationUpgradesActivityJobs(NpgsqlDataSource source)
    {
        var db = new PostgresPlannerDb(source);
        var (user, trip, _) = await Seed(db);
        var place = await db.SaveDestinationPlaceAsync(
            user.Id,
            new(trip.Id, "paris-fr", "Paris", "FR", "", 2.35, 48.85)
        );
        await db.AddDestinationVisitAsync(
            user.Id,
            new(trip.Id, place.CityId, Guid.NewGuid(), 0, null, null)
        );
        place = (await db.GetDestinationPlaceAsync(user.Id, trip.Id, place.CityId))!;
        var id = Guid.NewGuid();
        byte[] image = [1, 2, 3];
        await db.CreateActivityJobAsync(
            user.Id,
            trip.Id,
            id,
            place.CityId,
            place.ContextVersion,
            "Museum",
            image,
            "image/png"
        );
        // Reproduce a database that applied the earlier activity migration.
        await using (
            var rollback = source.CreateCommand(
                "ALTER TABLE activity_jobs DROP COLUMN image_sha256; DELETE FROM schema_migrations WHERE version = 6;"
            )
        )
        {
            await rollback.ExecuteNonQueryAsync();
        }

        await new DatabaseMigrator(source, NullLogger<DatabaseMigrator>.Instance).MigrateAsync();
        var retried = await db.CreateActivityJobAsync(
            user.Id,
            trip.Id,
            id,
            place.CityId,
            place.ContextVersion,
            "Museum",
            image,
            "image/png"
        );
        Assert.AreEqual(id, retried.Id);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            db.CreateActivityJobAsync(
                user.Id,
                trip.Id,
                id,
                place.CityId,
                place.ContextVersion,
                "Museum",
                [4, 5, 6],
                "image/png"
            )
        );
        var prompt = await db.CreateActivityJobAsync(
            user.Id,
            trip.Id,
            Guid.NewGuid(),
            place.CityId,
            place.ContextVersion,
            "Find museums",
            null,
            null
        );
        Assert.AreEqual("pending", prompt.Status);
    }

    private static async Task MigrationPreservesFlightPlanning(NpgsqlDataSource source)
    {
        // Reconstruct the previous schema inside this disposable test database.
        var db = new PostgresPlannerDb(source);
        var (user, trip, _) = await Seed(db);
        await db.SetFlightConstraintsAsync(
            user.Id,
            trip.Id,
            JsonSerializer.SerializeToElement(
                new PlanningDocument { AiPrompt = "Existing plan" },
                JsonSerializerOptions.Web
            )
        );
        await using (
            var rollback = source.CreateCommand(
                """
                UPDATE trips SET constraints = flight_constraints;
                ALTER TABLE trips DROP COLUMN flight_constraints;
                ALTER TABLE destination_places DROP COLUMN constraints;
                DELETE FROM schema_migrations WHERE version = 5;
                """
            )
        )
        {
            await rollback.ExecuteNonQueryAsync();
        }

        await new DatabaseMigrator(source, NullLogger<DatabaseMigrator>.Instance).MigrateAsync();
        var migrated = (await db.GetTripAsync(user.Id, trip.Id))!;
        Assert.IsEmpty(migrated.Constraints.EnumerateObject());
        Assert.AreEqual(
            "Existing plan",
            PlanningDocument.FromJson(migrated.FlightConstraints).AiPrompt
        );
    }

    private static async Task DestinationContract(IPlannerDb db)
    {
        var (user, trip, _) = await Seed(db);
        var place = await db.SaveDestinationPlaceAsync(
            user.Id,
            new(trip.Id, "paris-fr", "Paris", "FR", "Europe/Paris", 2.3522, 48.8566)
        );
        Assert.AreEqual("paris-fr", place.CityId);
        var first = await db.AddDestinationVisitAsync(
            user.Id,
            new(trip.Id, "paris-fr", Guid.NewGuid(), 0, null, null)
        );
        Assert.IsNotNull(first);
        Assert.AreEqual(0, first.Order);
        var second = await db.AddDestinationVisitAsync(
            user.Id,
            new(
                trip.Id,
                "paris-fr",
                Guid.NewGuid(),
                0,
                new DateOnly(2027, 6, 10),
                new DateOnly(2027, 6, 14)
            )
        );
        Assert.IsNotNull(second);
        Assert.AreEqual(1, second.Order);
        var revised = await db.ReplaceDestinationVisitAsync(
            user.Id,
            trip.Id,
            "paris-fr",
            first.StayId,
            new(new DateOnly(2027, 6, 1), new DateOnly(2027, 6, 5))
        );
        Assert.AreEqual(new DateOnly(2027, 6, 1), revised?.ArrivalDate);
        Assert.HasCount(2, await db.GetDestinationVisitsAsync(user.Id, trip.Id));
        place = (await db.GetDestinationPlaceAsync(user.Id, trip.Id, "paris-fr"))!;
        Assert.IsFalse(string.IsNullOrEmpty(place.ContextVersion));
        var now = DateTimeOffset.UtcNow;
        var activity = new Activity(
            Guid.NewGuid(),
            trip.Id,
            "paris-fr",
            null,
            new("Museum", null, "", null, ActivityState.Planned)
            {
                Links = [new("https://museum.example/tickets", "Tickets")],
            },
            now,
            now
        );
        Assert.IsNotNull(await db.SaveActivityAsync(user.Id, activity, place.ContextVersion, null));
        Assert.IsTrue(
            await db.DeleteDestinationVisitAsync(user.Id, trip.Id, "paris-fr", first.StayId)
        );
        Assert.HasCount(1, await db.GetDestinationVisitsAsync(user.Id, trip.Id));
        Assert.IsTrue(
            await db.DeleteDestinationVisitAsync(user.Id, trip.Id, "paris-fr", second.StayId)
        );
        Assert.HasCount(0, await db.GetDestinationVisitsAsync(user.Id, trip.Id));
        var storedActivity = await db.GetActivityAsync(user.Id, trip.Id, "paris-fr", activity.Id);
        Assert.IsNotNull(storedActivity);
        Assert.AreEqual("Tickets", storedActivity.Properties.Links.Single().Label);
        Assert.IsNull(
            await db.SaveActivityAsync(
                user.Id,
                activity with
                {
                    Id = Guid.NewGuid(),
                },
                place.ContextVersion,
                null
            )
        );
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
            new(party.Id, [null, "selected-flight"], ["CDG"])
            {
                SavedFares =
                [
                    new(
                        party.Id,
                        "saved-fare",
                        first,
                        JsonSerializer.SerializeToElement(
                            new { itineraries = new[] { new { ignav_id = "retained-offer" } } }
                        ),
                        DateTimeOffset.UtcNow,
                        DateTimeOffset.UtcNow.AddHours(1)
                    ),
                ],
            }
        );
        CollectionAssert.Contains(saved.NextOrigins, "CDG");
        var restoredChoice = (await db.GetFlightChoicesAsync(user.Id, trip.Id)).Single();
        CollectionAssert.AreEqual(
            new string?[] { null, "selected-flight" },
            restoredChoice.LegKeys
        );
        Assert.AreEqual(
            "retained-offer",
            restoredChoice
                .SavedFares.Single()
                .Response.GetProperty("itineraries")[0]
                .GetProperty("ignav_id")
                .GetString()
        );
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
}
