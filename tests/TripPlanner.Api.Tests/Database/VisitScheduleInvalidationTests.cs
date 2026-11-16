using System.Text.Json;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.ActivityPlanning;
using TripPlanner.Api.Services.Flights;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Database;

[TestClass]
public sealed class VisitScheduleInvalidationTests
{
    [TestMethod]
    public Task ChangedVisitDates_InMemory() => Verify(new InMemoryPlannerDb());

    [TestMethod]
    public Task ChangedVisitDates_Postgres() =>
        TripReadPostgresTests.WithDatabase((_, database) => Verify(database));

    private static async Task Verify(IPlannerDb database)
    {
        foreach (
            string change in new[]
            {
                "move",
                "arrival",
                "departure",
                "clear",
                "unchanged",
                "overlap",
            }
        )
        {
            var user = await database.GetOrCreateUserAsync(
                new("google", $"visit-{Guid.NewGuid():N}@example.com", "Planner")
            );
            var (trip, _, place, activity) = await ActivityPlanningFixture.SeedDatabase(
                database,
                user
            );
            var first = (await database.GetDestinationVisitsAsync(user.Id, trip.Id)).Single();
            await database.ReplaceDestinationVisitAsync(
                user.Id,
                trip.Id,
                place.CityId,
                first.StayId,
                new(new(2027, 6, 10), new(2027, 6, 12))
            );
            var repeat = (
                await database.AddDestinationVisitAsync(
                    user.Id,
                    new(
                        trip.Id,
                        place.CityId,
                        Guid.NewGuid(),
                        1,
                        new(2027, 6, 20),
                        new(2027, 6, 21)
                    )
                )
            )!;
            var later = activity with
            {
                Id = Guid.NewGuid(),
                Properties = activity.Properties with { Name = "Later visit" },
            };
            await database.SaveActivityAsync(
                user.Id,
                later,
                (
                    await database.GetDestinationPlaceAsync(user.Id, trip.Id, place.CityId)
                )!.ContextVersion,
                null
            );
            await database.SaveDestinationPlaceAsync(
                user.Id,
                new(trip.Id, "lyon-fr", "Lyon", "FR", "Europe/Paris", 4.8, 45.7)
            );
            await database.AddDestinationVisitAsync(
                user.Id,
                new(trip.Id, "lyon-fr", Guid.NewGuid(), 2, new(2027, 6, 25), new(2027, 6, 26))
            );
            var service = new ActivityPlanningService(
                database,
                new(new AirportCatalog()),
                TimeProvider.System,
                new AzureMapsStub()
            );
            var context = (
                await service.ReadAsync(user.Id, trip.Id, place.CityId, CancellationToken.None)
            )!;
            var plan = ActivityPlanningFixture.Plan(context) with
            {
                SelectedActivityIds = [activity.Id, later.Id],
                Days =
                [
                    new(first.StayId, new(2027, 6, 10), [activity.Id])
                    {
                        Name = "Old day",
                        AvailabilityConfirmed = true,
                    },
                    new(repeat.StayId, new(2027, 6, 20), [later.Id])
                    {
                        Name = "Keep day",
                        AvailabilityConfirmed = true,
                    },
                ],
                Rules =
                [
                    new(activity.Id)
                    {
                        FixedDate = new(2027, 6, 10),
                        FixedStart = new(9, 0),
                        MustDo = true,
                        Duration = TimeSpan.FromHours(1),
                        AlwaysAvailable = true,
                    },
                    new(later.Id)
                    {
                        FixedDate = new(2027, 6, 20),
                        FixedStart = new(10, 0),
                        AlwaysAvailable = true,
                    },
                ],
                TransportOverrides =
                [
                    new(new(2027, 6, 10), null, activity.Id, "walking", TimeSpan.FromMinutes(15)),
                    new(new(2027, 6, 20), null, later.Id, "walking", TimeSpan.FromMinutes(20)),
                ],
            };
            var saved = (
                await database.SaveActivityPlanAsync(
                    user.Id,
                    trip.Id,
                    place.CityId,
                    new(
                        plan,
                        context.Evaluate(plan, ActivityPlanningFixture.Now),
                        0,
                        context.InputRevision,
                        ActivityPlanningFixture.Now
                    ),
                    0,
                    context.InputRevision
                )
            )!;
            var otherContext = (
                await service.ReadAsync(user.Id, trip.Id, "lyon-fr", CancellationToken.None)
            )!;
            var otherPlan = ActivityPlanRules.Initial(otherContext);
            var other = (
                await database.SaveActivityPlanAsync(
                    user.Id,
                    trip.Id,
                    "lyon-fr",
                    new(
                        otherPlan,
                        otherContext.Evaluate(otherPlan, ActivityPlanningFixture.Now),
                        0,
                        otherContext.InputRevision,
                        ActivityPlanningFixture.Now
                    ),
                    0,
                    otherContext.InputRevision
                )
            )!;
            var input = change switch
            {
                "move" => new DestinationStayInput(new(2027, 6, 13), new(2027, 6, 15)),
                "arrival" => new(new(2027, 6, 9), new(2027, 6, 12)),
                "departure" => new(new(2027, 6, 10), new(2027, 6, 13)),
                "clear" => new(null, null),
                "overlap" => new(new(2027, 6, 10), new(2027, 6, 21)),
                _ => new(new(2027, 6, 10), new(2027, 6, 12)),
            };
            if (change == "overlap")
            {
                await Assert.ThrowsAsync<DestinationDatesOverlapException>(() =>
                    database.ReplaceDestinationVisitAsync(
                        user.Id,
                        trip.Id,
                        place.CityId,
                        first.StayId,
                        input
                    )
                );
            }
            else
            {
                Assert.IsNotNull(
                    await database.ReplaceDestinationVisitAsync(
                        user.Id,
                        trip.Id,
                        place.CityId,
                        first.StayId,
                        input
                    )
                );
            }
            var result = (await database.GetActivityPlanAsync(user.Id, trip.Id, place.CityId))!;
            Assert.AreEqual(
                JsonSerializer.Serialize(other),
                JsonSerializer.Serialize(
                    await database.GetActivityPlanAsync(user.Id, trip.Id, "lyon-fr")
                ),
                change
            );
            if (change is "unchanged" or "overlap")
            {
                Assert.AreEqual(
                    JsonSerializer.Serialize(saved),
                    JsonSerializer.Serialize(result),
                    change
                );
                continue;
            }
            Assert.AreEqual(saved.Version + 1, result.Version, change);
            Assert.HasCount(1, result.Plan.Days, change);
            Assert.AreEqual(
                JsonSerializer.Serialize(saved.Plan.Days[1]),
                JsonSerializer.Serialize(result.Plan.Days[0]),
                change
            );
            var rule = result.Plan.Rules.Single(rule => rule.ActivityId == activity.Id);
            Assert.IsNull(rule.FixedDate, change);
            Assert.IsNull(rule.FixedStart, change);
            Assert.IsTrue(rule.MustDo, change);
            Assert.AreEqual(TimeSpan.FromHours(1), rule.Duration, change);
            Assert.AreEqual(
                JsonSerializer.Serialize(saved.Plan.Rules[1]),
                JsonSerializer.Serialize(result.Plan.Rules[1]),
                change
            );
            Assert.HasCount(1, result.Plan.TransportOverrides, change);
            CollectionAssert.AreEquivalent(
                saved.Plan.SelectedActivityIds,
                result.Plan.SelectedActivityIds,
                change
            );
            Assert.AreEqual(
                ActivityState.Yes,
                (await database.GetActivityAsync(user.Id, trip.Id, place.CityId, activity.Id))!
                    .Properties
                    .State,
                change
            );
            long revision = await database.GetActivityPlanningRevisionAsync(user.Id, trip.Id);
            Assert.IsNull(
                await database.SaveActivityPlanAsync(
                    user.Id,
                    trip.Id,
                    place.CityId,
                    saved,
                    saved.Version,
                    revision
                ),
                "Stale plan versions must not restore invalidated dates."
            );
            string feed = ActivityCalendar.Render(
                trip,
                [
                    (
                        result,
                        (
                            await database.GetActivitiesAsync(user.Id, trip.Id, place.CityId)
                        ).ToArray(),
                        (await database.GetDestinationVisitsAsync(user.Id, trip.Id)).ToArray()
                    ),
                ]
            );
            Assert.DoesNotContain($"-{activity.Id:D}@tripplanner", feed);
        }
    }
}
