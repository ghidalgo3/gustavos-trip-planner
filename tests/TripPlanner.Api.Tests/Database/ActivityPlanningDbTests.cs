using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.ActivityPlanning;
using TripPlanner.Api.Services.Flights;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Database;

[TestClass]
public sealed class ActivityPlanningDbTests
{
    private sealed class UnusedMaps : AzureMapsStub
    {
        public override Task<string?> ResolveTimeZoneAsync(
            Microsoft.Spatial.GeographyPoint point,
            CancellationToken cancellationToken
        ) => throw new AssertFailedException("This fixture already has a destination time zone.");
    }

    [TestMethod]
    [DataRow(false)]
    [DataRow(true)]
    public async Task DatabaseParity_AtomicStates_ReferenceCleanup_Reviews_AndRevocation(
        bool postgres
    )
    {
        NpgsqlDataSource? source = null;
        IPlannerDb db = new InMemoryPlannerDb();
        if (postgres)
        {
            string? connection = Environment.GetEnvironmentVariable("TRIPPLANNER_TEST_POSTGRES");
            if (string.IsNullOrWhiteSpace(connection))
            {
                Assert.Inconclusive(
                    "Set TRIPPLANNER_TEST_POSTGRES to an isolated PostgreSQL/PostGIS test database."
                );
                return;
            }
            source = NpgsqlDataSource.Create(connection);
            await new DatabaseMigrator(
                source,
                NullLogger<DatabaseMigrator>.Instance
            ).MigrateAsync();
            db = new PostgresPlannerDb(source);
        }
        try
        {
            var user = await db.GetOrCreateUserAsync(
                new("google", $"m3-{Guid.NewGuid():N}@example.com", "Planner")
            );
            user = await db.SetUserProfileAsync(user.Id, new(new("Boston", -71, 42), []));
            var (trip, _, place, activity) = await ActivityPlanningFixture.SeedDatabase(db, user);

            var service = new ActivityPlanningService(
                db,
                new(new AirportCatalog()),
                TimeProvider.System,
                new UnusedMaps()
            );
            var planningContext = (
                await service.ReadAsync(user.Id, trip.Id, place.CityId, CancellationToken.None)
            )!;
            var plan = ActivityPlanningFixture.Plan(planningContext);
            var saved = await db.SaveActivityPlanAsync(
                user.Id,
                trip.Id,
                place.CityId,
                new(
                    plan,
                    planningContext.Evaluate(plan, ActivityPlanningFixture.Now),
                    0,
                    planningContext.InputRevision,
                    ActivityPlanningFixture.Now
                ),
                0,
                planningContext.InputRevision
            );
            Assert.IsNotNull(saved);
            Assert.IsNull(
                await db.SaveActivityPlanAsync(
                    user.Id,
                    trip.Id,
                    place.CityId,
                    saved,
                    0,
                    planningContext.InputRevision
                )
            );
            var rejected = activity with
            {
                Properties = activity.Properties with { State = ActivityState.Rejected },
                UpdatedAt = ActivityPlanningFixture.Now.AddMinutes(1),
            };
            Assert.IsNotNull(
                await db.SaveActivityAsync(
                    user.Id,
                    rejected,
                    place.ContextVersion,
                    activity.UpdatedAt
                )
            );
            saved = await db.GetActivityPlanAsync(user.Id, trip.Id, place.CityId);
            Assert.IsEmpty(saved!.Plan.SelectedActivityIds);
            Assert.Contains(activity.Id, saved.Plan.ExcludedActivityIds);
            Assert.IsEmpty(saved.Plan.Days.SelectMany(d => d.ActivityIds));
            planningContext = (
                await service.ReadAsync(user.Id, trip.Id, place.CityId, CancellationToken.None)
            )!;
            var job = new ActivityPlanningJob(
                Guid.NewGuid(),
                user.Id,
                trip.Id,
                place.CityId,
                "draft",
                "hash",
                saved.Plan,
                planningContext.InputRevision,
                saved.Version,
                false,
                "MCP",
                ActivityPlanningFixture.Now
            );
            Assert.IsNotNull(await db.CreateActivityPlanningJobAsync(user.Id, trip.Id, job));
            Assert.IsNotNull(await db.CreateActivityPlanningJobAsync(user.Id, trip.Id, job));
            var claimed = await db.ClaimActivityPlanningJobAsync(TimeSpan.FromMinutes(3));
            Assert.IsNotNull(claimed);
            var result = service.Assess(planningContext, plan, job.Id) with { Kind = "draft" };
            Assert.IsTrue(await db.CompleteActivityPlanningJobAsync(claimed, result, null, true));
            Assert.AreEqual(
                "MCP",
                (
                    await db.GetActivityPlanningJobAsync(user.Id, trip.Id, place.CityId, job.Id)
                )!.Source
            );
            Assert.IsFalse(
                await db.SaveActivityProposalReviewAsync(
                    user.Id,
                    trip.Id,
                    place.CityId,
                    job.Id,
                    new([]),
                    new([]),
                    planningContext.InputRevision - 1,
                    saved.Version
                )
            );
            Assert.IsTrue(
                await db.SaveActivityProposalReviewAsync(
                    user.Id,
                    trip.Id,
                    place.CityId,
                    job.Id,
                    new([]),
                    new([]),
                    planningContext.InputRevision,
                    saved.Version
                )
            );
            var traveller = await db.GetOrCreateUserAsync(
                new("google", $"traveller-{Guid.NewGuid():N}@example.com", "Traveller")
            );
            var party = (await db.GetPartiesAsync(user.Id, trip.Id)).Single();
            await db.ChangePartyMemberAsync(user.Id, trip.Id, party.Id, traveller.Id, true);
            var memberReadView = (
                await service.ReadAsync(user.Id, trip.Id, place.CityId, CancellationToken.None)
            )!;
            var matched = memberReadView.SavedPlan! with
            {
                Plan = memberReadView.SavedPlan.Plan with
                {
                    Days = memberReadView
                        .SavedPlan.Plan.Days.Select(d =>
                            d with
                            {
                                FlightMatches = [new(traveller.Id, "arrival", new string('a', 64))],
                            }
                        )
                        .ToArray(),
                },
            };
            Assert.IsNotNull(
                await db.SaveActivityPlanAsync(
                    user.Id,
                    trip.Id,
                    place.CityId,
                    matched,
                    matched.Version,
                    memberReadView.InputRevision
                )
            );
            var tokenHash = Guid.NewGuid().ToString("N");
            var subscription = new ActivityCalendarSubscription(
                Guid.NewGuid(),
                traveller.Id,
                trip.Id,
                tokenHash,
                ActivityPlanningFixture.Now
            );
            Assert.IsNotNull(
                await db.CreateActivityCalendarSubscriptionAsync(
                    traveller.Id,
                    trip.Id,
                    subscription
                )
            );
            await db.ChangePartyMemberAsync(user.Id, trip.Id, party.Id, traveller.Id, false);
            Assert.IsEmpty(
                (
                    await db.GetActivityPlanAsync(user.Id, trip.Id, place.CityId)
                )!.Plan.Days.SelectMany(d => d.FlightMatches)
            );
            await db.ChangePartyMemberAsync(user.Id, trip.Id, party.Id, traveller.Id, true);
            Assert.IsNull(
                await db.FindActivityCalendarSubscriptionAsync(tokenHash),
                "Removing and readding a member must not revive a bearer URL."
            );
            await db.DeleteDestinationVisitAsync(
                user.Id,
                trip.Id,
                place.CityId,
                planningContext.Visits[0].StayId
            );
            Assert.IsEmpty(
                (await db.GetActivityPlanAsync(user.Id, trip.Id, place.CityId))!.Plan.Days
            );
            await db.DeleteTripAsync(user.Id, trip.Id);
        }
        finally
        {
            if (source is not null)
            {
                await source.DisposeAsync();
            }
        }
    }
}
