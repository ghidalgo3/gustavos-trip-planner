using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Tests.Database;

[TestClass]
public sealed class ActivityKindDbTests
{
    internal static readonly string[] Labels =
    [
        "100% local",
        "Architecture",
        "Art",
        "Food",
        "Nightlife",
        "_hidden",
        "夜景",
    ];

    [TestMethod]
    [DataRow(false)]
    [DataRow(true)]
    public async Task KindsAreScopedDistinctSearchablePagedAndReflectSavedActivities(bool postgres)
    {
        if (postgres)
        {
            await TripReadPostgresTests.WithDatabase(
                async (_, database) => await Contract(database)
            );
        }
        else
        {
            await Contract(new InMemoryPlannerDb());
        }
    }

    private static async Task Contract(IPlannerDb database)
    {
        var owner = await database.GetOrCreateUserAsync(
            new("google", "kind-owner@example.com", "Owner")
        );
        var (tripId, activityId) = await Seed(database, owner);
        foreach (
            var (search, expected) in new (string?, string[])[]
            {
                (null, Labels),
                ("  ", Labels),
                (" aRt ", ["Art"]),
                ("%", ["100% local"]),
                ("_", ["_hidden"]),
                ("夜", ["夜景"]),
                ("missing", []),
            }
        )
        {
            var page = await database.GetActivityKindPageAsync(owner.Id, new(Search: search));
            CollectionAssert.AreEqual(expected, page.Kinds.ToArray());
            Assert.IsFalse(page.HasMore);
        }
        var all = new List<string>();
        while (true)
        {
            var page = await database.GetActivityKindPageAsync(
                owner.Id,
                new(Top: 2, Skip: all.Count)
            );
            all.AddRange(page.Kinds);
            if (!page.HasMore)
            {
                break;
            }
            Assert.HasCount(2, page.Kinds);
        }
        CollectionAssert.AreEqual(Labels, all.ToArray());
        Assert.IsEmpty(
            (await database.GetActivityKindPageAsync(owner.Id, new(Skip: Labels.Length))).Kinds
        );

        var activity = (await database.GetActivityAsync(owner.Id, tripId, "paris-fr", activityId))!;
        var place = (await database.GetDestinationPlaceAsync(owner.Id, tripId, "paris-fr"))!;
        var updated = await database.SaveActivityAsync(
            owner.Id,
            activity with
            {
                Properties = activity.Properties with { Kinds = ["Art", "New kind"] },
            },
            place.ContextVersion,
            activity.UpdatedAt
        );
        Assert.IsNotNull(updated);
        var changed = await database.GetActivityKindPageAsync(owner.Id, new());
        Assert.Contains("New kind", changed.Kinds);
        Assert.DoesNotContain("Architecture", changed.Kinds);
        Assert.DoesNotContain("Nightlife", changed.Kinds);
        Assert.IsTrue(
            await database.DeleteActivityAsync(
                owner.Id,
                tripId,
                "paris-fr",
                activityId,
                place.ContextVersion,
                updated.UpdatedAt
            )
        );
        var removed = await database.GetActivityKindPageAsync(owner.Id, new());
        Assert.DoesNotContain("New kind", removed.Kinds);
        Assert.Contains("Art", removed.Kinds);
    }

    internal static async Task<(Guid TripId, Guid ActivityId)> Seed(IPlannerDb database, User owner)
    {
        await Add(
            database,
            owner.Id,
            "First trip",
            ["Art", "Food", "100% local", "_hidden", "夜景"]
        );
        var second = await Add(
            database,
            owner.Id,
            "Second trip",
            ["Art", "Architecture", "Nightlife"]
        );
        var other = await database.GetOrCreateUserAsync(
            new("google", "other-kinds@example.com", "Other")
        );
        var shared = await Add(
            database,
            other.Id,
            "Shared trip owned by someone else",
            ["PRIVATE_KIND"]
        );
        var party = (await database.GetPartiesAsync(other.Id, shared.TripId)).Single();
        await database.ChangePartyMemberAsync(
            other.Id,
            shared.TripId,
            party.Id,
            owner.Id,
            true,
            role: PartyRole.Planner
        );
        return second;
    }

    private static async Task<(Guid TripId, Guid ActivityId)> Add(
        IPlannerDb database,
        Guid userId,
        string name,
        string[] kinds
    )
    {
        var trip = await database.CreateTripAsync(userId, name, "");
        var place = await database.SaveDestinationPlaceAsync(
            userId,
            new(trip.Id, "paris-fr", "Paris", "FR", "Europe/Paris", 2.35, 48.86)
        );
        await database.AddDestinationVisitAsync(
            userId,
            new(trip.Id, place.CityId, Guid.NewGuid(), 0, null, null)
        );
        place = (await database.GetDestinationPlaceAsync(userId, trip.Id, place.CityId))!;
        var now = DateTimeOffset.UtcNow;
        var activity = new Activity(
            Guid.NewGuid(),
            trip.Id,
            place.CityId,
            null,
            new("Visit", null, "", null, ActivityState.Proposed, kinds),
            now,
            now
        );
        var saved = await database.SaveActivityAsync(userId, activity, place.ContextVersion, null);
        Assert.IsNotNull(saved);
        return (trip.Id, saved.Id);
    }
}
