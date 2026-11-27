using Microsoft.AspNetCore.Http;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;
using TripPlanner.SeedDatabase;

namespace TripPlanner.Api.Tests.Database;

[TestClass]
public sealed class DatabaseSeederTests
{
    private static readonly DateOnly Today = new(2026, 11, 8);

    [TestMethod]
    [DataRow(1999, 12, 30)]
    [DataRow(2100, 12, 31)]
    public async Task UnsupportedScheduleDatesAreRejectedBeforeWritingTrips(
        int year,
        int month,
        int day
    )
    {
        var database = new InMemoryPlannerDb();
        var owner = await database.GetOrCreateUserAsync(new("google", "seed@example.com", "Owner"));
        var seeder = new DatabaseSeeder(database);
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() =>
            seeder.SeedAsync(owner.Id, 1000, new(year, month, day))
        );
        Assert.IsEmpty(database.Trips);
    }

    [TestMethod]
    [DataRow(3)]
    [DataRow(1000)]
    public async Task SeedsCompleteTripsAndRerunsPreserveEdits(int count)
    {
        var database = new InMemoryPlannerDb();
        var owner = await database.GetOrCreateUserAsync(new("google", "seed@example.com", "Owner"));
        var seeder = new DatabaseSeeder(database);

        Assert.AreEqual(
            new SeedResult(count, 0, 0),
            await seeder.SeedAsync(owner.Id, count, Today)
        );
        var trips = await database.GetTripsAsync(owner.Id);
        Assert.HasCount(count, trips);
        Assert.IsTrue(trips.Any(trip => trip.Name == "Trip Small"));
        Assert.IsTrue(trips.Any(trip => trip.Name == "Trip Medium"));
        Assert.IsTrue(trips.Any(trip => trip.Name == "Trip Large"));
        var allVisits = new List<TripPlanner.Api.Models.DestinationVisit>();
        var ranges = new List<(DateOnly Start, DateOnly End)>();
        foreach (var trip in trips)
        {
            string[] expectedCities =
                trip.Name.StartsWith("Trip Small", StringComparison.Ordinal) ? ["new-york-us"]
                : trip.Name.StartsWith("Trip Medium", StringComparison.Ordinal)
                    ? ["amsterdam-nl", "london-gb"]
                :
                [
                    "new-york-us",
                    "london-gb",
                    "rome-it",
                    "istanbul-tr",
                    "hong-kong-hk",
                    "seoul-kr",
                    "tokyo-jp",
                    "sydney-au",
                    "honolulu-us",
                    "los-angeles-us",
                    "chicago-us",
                ];
            var visits = await database.GetDestinationVisitsAsync(owner.Id, trip.Id);
            CollectionAssert.AreEqual(
                expectedCities,
                visits.OrderBy(visit => visit.Order).Select(visit => visit.CityId).ToArray()
            );
            Assert.HasCount(
                expectedCities.Length,
                await database.GetDestinationPlacesAsync(owner.Id, trip.Id)
            );
            var ordered = visits.OrderBy(visit => visit.Order).ToArray();
            foreach (var visit in ordered)
            {
                Assert.IsNotNull(visit.ArrivalDate);
                Assert.AreEqual(visit.ArrivalDate.Value.AddDays(3), visit.DepartureDate);
            }
            for (int index = 1; index < ordered.Length; index++)
            {
                Assert.AreEqual(ordered[index - 1].DepartureDate, ordered[index].ArrivalDate);
            }
            ranges.Add((ordered[0].ArrivalDate!.Value, ordered[^1].DepartureDate!.Value));
            var party = (await database.GetPartiesAsync(owner.Id, trip.Id)).Single();
            CollectionAssert.AreEqual(new[] { owner.Id }, party.UserIds.ToArray());
            allVisits.AddRange(visits);
        }

        var chronological = ranges.OrderBy(range => range.Start).ToArray();
        Assert.AreEqual(Today.AddDays(1), chronological[0].Start);
        for (int index = 1; index < chronological.Length; index++)
        {
            Assert.AreEqual(chronological[index - 1].End.AddDays(1), chronological[index].Start);
        }
        if (count == 1000)
        {
            Assert.IsTrue(chronological[^1].End > Today.AddYears(40));
        }

        var small = trips.Single(trip => trip.Name == "Trip Small");
        await database.UpdateTripAsync(owner.Id, small.Id, small.Name, "Keep my edits");
        var confirmedTrips = await database.GetTripsAsync(owner.Id);
        Assert.AreEqual(
            new SeedResult(0, 0, count),
            await seeder.SeedAsync(owner.Id, count, Today)
        );
        CollectionAssert.AreEquivalent(
            confirmedTrips.ToArray(),
            (await database.GetTripsAsync(owner.Id)).ToArray()
        );
        var confirmedVisits = new List<TripPlanner.Api.Models.DestinationVisit>();
        foreach (var trip in confirmedTrips)
        {
            confirmedVisits.AddRange(await database.GetDestinationVisitsAsync(owner.Id, trip.Id));
        }
        CollectionAssert.AreEquivalent(allVisits, confirmedVisits);
    }

    [TestMethod]
    [DataRow(false)]
    [DataRow(true)]
    public async Task SeedsFifteenLocalActivitiesPerLargeTripDestination(bool usePostgres)
    {
        if (usePostgres)
        {
            await TripReadPostgresTests.WithDatabase(
                (source, database) =>
                    AssertLargeTripActivitiesAsync(
                        AuditedPlannerDb.Create(
                            database,
                            new PostgresActivityLogStore(source),
                            new HttpContextAccessor(),
                            TimeProvider.System
                        )
                    )
            );
        }
        else
        {
            await AssertLargeTripActivitiesAsync(new InMemoryPlannerDb());
        }
    }

    [TestMethod]
    public async Task RerunFillsMissingActivitiesWithoutOverwritingEditsOrDuplicatingAnExistingName()
    {
        var database = new InMemoryPlannerDb();
        var owner = await database.GetOrCreateUserAsync(new("google", "seed@example.com", "Owner"));
        var seeder = new DatabaseSeeder(database);
        await seeder.SeedAsync(owner.Id, 3, Today);
        var trip = (await database.GetTripsAsync(owner.Id)).Single(trip =>
            trip.Name == "Trip Large"
        );
        const string cityId = "new-york-us";
        var place = await database.GetDestinationPlaceAsync(owner.Id, trip.Id, cityId);
        Assert.IsNotNull(place);
        var activities = await database.GetActivitiesAsync(owner.Id, trip.Id, cityId);
        var renamed = activities[0] with
        {
            Properties = activities[0].Properties with
            {
                Name = "My museum visit",
                State = ActivityState.Yes,
            },
        };
        Assert.IsNotNull(
            await database.SaveActivityAsync(
                owner.Id,
                renamed,
                place.ContextVersion,
                renamed.UpdatedAt
            )
        );

        foreach (var activity in activities.Skip(1).Take(2))
        {
            Assert.IsTrue(
                await database.DeleteActivityAsync(
                    owner.Id,
                    trip.Id,
                    cityId,
                    activity.Id,
                    place.ContextVersion,
                    activity.UpdatedAt
                )
            );
        }
        var manual = activities[1] with
        {
            Id = Guid.NewGuid(),
            Properties = activities[1].Properties with { Notes = "My own notes" },
        };
        Assert.IsNotNull(
            await database.SaveActivityAsync(owner.Id, manual, place.ContextVersion, null)
        );

        Assert.AreEqual(new SeedResult(0, 1, 2), await seeder.SeedAsync(owner.Id, 3, Today));
        var restored = await database.GetActivitiesAsync(owner.Id, trip.Id, cityId);
        Assert.HasCount(15, restored);
        Assert.AreEqual(renamed, restored.Single(activity => activity.Id == renamed.Id));
        Assert.AreEqual(
            manual,
            restored.Single(activity => activity.Properties.Name == manual.Properties.Name)
        );
        Assert.IsTrue(restored.Any(activity => activity.Id == activities[2].Id));
        Assert.AreEqual(new SeedResult(0, 0, 3), await seeder.SeedAsync(owner.Id, 3, Today));
    }

    [TestMethod]
    [DataRow(false)]
    [DataRow(true)]
    public async Task DatesExistingTripsWithoutReplacingTheirVisits(bool alreadyDated)
    {
        var database = new InMemoryPlannerDb();
        var owner = await database.GetOrCreateUserAsync(new("google", "seed@example.com", "Owner"));
        var seeder = new DatabaseSeeder(database);
        await seeder.SeedAsync(owner.Id, 12, Today.AddDays(-1));
        var trips = await database.GetTripsAsync(owner.Id);
        var originalVisits = new List<TripPlanner.Api.Models.DestinationVisit>();
        foreach (var trip in trips)
        {
            var visits = await database.GetDestinationVisitsAsync(owner.Id, trip.Id);
            originalVisits.AddRange(visits);
            if (!alreadyDated)
            {
                foreach (var visit in visits)
                {
                    await database.ReplaceDestinationVisitAsync(
                        owner.Id,
                        trip.Id,
                        visit.CityId,
                        visit.StayId,
                        new(null, null)
                    );
                }
            }
        }
        var small = trips.Single(trip => trip.Name == "Trip Small");
        await database.UpdateTripAsync(owner.Id, small.Id, small.Name, "Keep my notes");
        var confirmedTrips = await database.GetTripsAsync(owner.Id);

        Assert.AreEqual(new SeedResult(0, 12, 0), await seeder.SeedAsync(owner.Id, 12, Today));
        CollectionAssert.AreEquivalent(
            confirmedTrips.ToArray(),
            (await database.GetTripsAsync(owner.Id)).ToArray()
        );
        var currentVisits = new List<TripPlanner.Api.Models.DestinationVisit>();
        foreach (var trip in trips)
        {
            currentVisits.AddRange(await database.GetDestinationVisitsAsync(owner.Id, trip.Id));
        }
        CollectionAssert.AreEquivalent(
            originalVisits.Select(visit => visit.StayId).ToArray(),
            currentVisits.Select(visit => visit.StayId).ToArray()
        );
        Assert.IsTrue(
            currentVisits.All(visit =>
                visit.ArrivalDate is not null
                && visit.DepartureDate == visit.ArrivalDate.Value.AddDays(3)
            )
        );
        if (alreadyDated)
        {
            foreach (var old in originalVisits)
            {
                Assert.AreEqual(
                    old.ArrivalDate!.Value.AddDays(1),
                    currentVisits.Single(visit => visit.StayId == old.StayId).ArrivalDate
                );
            }
        }
        Assert.AreEqual(new SeedResult(0, 0, 12), await seeder.SeedAsync(owner.Id, 12, Today));
    }

    [TestMethod]
    public async Task NamesAreScopedToOwnerEvenWhenSameNamedTripIsShared()
    {
        var database = new InMemoryPlannerDb();
        var owner = await database.GetOrCreateUserAsync(new("google", "seed@example.com", "Owner"));
        var other = await database.GetOrCreateUserAsync(
            new("google", "other@example.com", "Other")
        );
        var shared = await database.CreateTripAsync(other.Id, "Trip Small", "Shared trip");
        var party = (await database.GetPartiesAsync(other.Id, shared.Id)).Single();
        await database.ChangePartyMemberAsync(other.Id, shared.Id, party.Id, owner.Id, true);

        var seeder = new DatabaseSeeder(database);
        Assert.AreEqual(new SeedResult(3, 0, 0), await seeder.SeedAsync(owner.Id, 3, Today));
        Assert.AreEqual(
            3,
            (await database.GetTripsAsync(owner.Id)).Count(trip => trip.OwnerUserId == owner.Id)
        );
        Assert.AreEqual(shared, await database.GetTripAsync(other.Id, shared.Id));
        Assert.AreEqual(owner, await seeder.FindOwnerAsync(" SEED@EXAMPLE.COM "));
    }

    [TestMethod]
    [DataRow(0)]
    [DataRow(2)]
    public async Task RequiresEmailWhenThereIsNoSingleUser(int userCount)
    {
        var database = new InMemoryPlannerDb();
        for (int index = 0; index < userCount; index++)
        {
            await database.GetOrCreateUserAsync(
                new("google", $"user{index}@example.com", $"User {index}")
            );
        }

        var seeder = new DatabaseSeeder(database);
        await Assert.ThrowsAsync<InvalidOperationException>(() => seeder.FindOwnerAsync(null));
        Assert.IsEmpty(database.Trips);
    }

    private static async Task AssertLargeTripActivitiesAsync(IPlannerDb database)
    {
        var owner = await database.GetOrCreateUserAsync(new("google", "seed@example.com", "Owner"));
        var seeder = new DatabaseSeeder(database);
        await seeder.SeedAsync(owner.Id, 6, Today);

        foreach (var trip in await database.GetTripsAsync(owner.Id))
        {
            bool isLarge = trip.Name.StartsWith("Trip Large", StringComparison.Ordinal);
            foreach (var place in await database.GetDestinationPlacesAsync(owner.Id, trip.Id))
            {
                var activities = await database.GetActivitiesAsync(owner.Id, trip.Id, place.CityId);
                Assert.HasCount(isLarge ? 15 : 0, activities, $"{trip.Name}: {place.Name}");
                if (isLarge)
                {
                    Assert.HasCount(
                        15,
                        activities.Select(activity => activity.Properties.Name).Distinct()
                    );
                    Assert.HasCount(
                        15,
                        activities.Select(activity => activity.Geometry?.Position).Distinct()
                    );
                }
                foreach (var activity in activities)
                {
                    Assert.IsNotNull(activity.Geometry);
                    var point = activity.Geometry.Position;
                    Assert.IsLessThan(1, Math.Abs(point.Latitude - place.Latitude));
                    Assert.IsLessThan(1, Math.Abs(point.Longitude - place.Longitude));
                    Assert.IsTrue(activity.Properties.Duration > TimeSpan.Zero);
                    Assert.IsFalse(string.IsNullOrWhiteSpace(activity.Properties.Description));
                    Assert.IsNotEmpty(activity.Properties.Kinds);
                }
            }
        }

        Assert.AreEqual(new SeedResult(0, 0, 6), await seeder.SeedAsync(owner.Id, 6, Today));
    }
}
