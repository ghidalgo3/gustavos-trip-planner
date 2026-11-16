using Microsoft.Spatial;
using TripPlanner.Api.Models;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Database;

[TestClass]
public sealed class StayTimesDbTests
{
    [TestMethod]
    public Task StayTimesPersistIndependentlyInPostgres() =>
        TripReadPostgresTests.WithDatabase(
            async (_, database) =>
            {
                var user = await database.GetOrCreateUserAsync(
                    new("google", "stay-clocks@example.com", "Planner")
                );
                var (trip, _, place, _) = await ActivityPlanningFixture.SeedDatabase(
                    database,
                    user
                );
                var first = (await database.GetDestinationVisitsAsync(user.Id, trip.Id)).Single();
                var second = (
                    await database.AddDestinationVisitAsync(
                        user.Id,
                        first with
                        {
                            StayId = Guid.NewGuid(),
                            ArrivalDate = new(2027, 6, 20),
                            DepartureDate = new(2027, 6, 22),
                        }
                    )
                )!;
                var feature = new GeoJsonFeature<StayLocationProperties>(
                    "Feature",
                    first.StayId.ToString(),
                    new("Point", GeographyPoint.Create(48.86, 2.35)),
                    new("Hotel")
                );
                Assert.IsTrue(
                    await database.SaveStayLocationAsync(
                        user.Id,
                        trip.Id,
                        place.CityId,
                        first.StayId,
                        feature
                    )
                );
                var locations = await database.GetStayLocationsAsync(user.Id, trip.Id);
                var canonical = locations[first.StayId];
                Assert.AreEqual(new TimeOnly(16, 0), canonical.Properties.CheckInTime);
                Assert.AreEqual(new TimeOnly(11, 0), canonical.Properties.CheckOutTime);
                Assert.IsTrue(
                    await database.SaveStayLocationAsync(
                        user.Id,
                        trip.Id,
                        place.CityId,
                        second.StayId,
                        canonical with
                        {
                            Id = second.StayId.ToString(),
                        }
                    )
                );
                Assert.IsTrue(
                    await database.SaveStayLocationAsync(
                        user.Id,
                        trip.Id,
                        place.CityId,
                        first.StayId,
                        canonical with
                        {
                            Properties = canonical.Properties with
                            {
                                CheckInTime = new(18, 30),
                                CheckOutTime = new(10, 15),
                            },
                        }
                    )
                );
                locations = await database.GetStayLocationsAsync(user.Id, trip.Id);
                Assert.AreEqual(
                    new TimeOnly(18, 30),
                    locations[first.StayId].Properties.CheckInTime
                );
                Assert.AreEqual(
                    new TimeOnly(10, 15),
                    locations[first.StayId].Properties.CheckOutTime
                );
                Assert.AreEqual(
                    new TimeOnly(16, 0),
                    locations[second.StayId].Properties.CheckInTime
                );
                Assert.AreEqual(
                    new TimeOnly(11, 0),
                    locations[second.StayId].Properties.CheckOutTime
                );
                Assert.HasCount(1, await database.GetHotelsAsync(user.Id, trip.Id));
            }
        );
}
