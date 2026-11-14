using System.Text.Json;
using Microsoft.Spatial;
using Npgsql;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Flights;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Database;

[TestClass]
public sealed class TransportationPostgresTests
{
    [TestMethod]
    [DataRow("activity")]
    [DataRow("hotel")]
    [DataRow("home")]
    [DataRow("airport")]
    public async Task SourceDeletionBecomesAnInlineSnapshotInPostgres(string kind)
    {
        await TripReadPostgresTests.WithDatabase(
            async (source, db) =>
            {
                var user = await db.GetOrCreateUserAsync(
                    new("google", "transport@example.com", "Traveler")
                );
                var other = await db.GetOrCreateUserAsync(
                    new("google", "home@example.com", "Other")
                );
                await db.SetUserProfileAsync(other.Id, new(new("Boston", -71, 42), []));
                var trip = await db.CreateTripAsync(user.Id, "Journey", "");
                var place = await db.SaveDestinationPlaceAsync(
                    user.Id,
                    new(trip.Id, "tokyo-jp", "Tokyo", "JP", "Asia/Tokyo", 139, 35)
                );
                var visit = (
                    await db.AddDestinationVisitAsync(
                        user.Id,
                        new(trip.Id, place.CityId, Guid.NewGuid(), 0, null, null)
                    )
                )!;
                var hotel = (
                    await db.SaveHotelAsync(
                        user.Id,
                        trip.Id,
                        new(
                            Guid.NewGuid(),
                            trip.Id,
                            "Hotel",
                            "Hotel address",
                            new("Point", GeographyPoint.Create(35, 139)),
                            "Asia/Tokyo"
                        ),
                        null
                    )
                )!;
                place = (await db.GetDestinationPlaceAsync(user.Id, trip.Id, place.CityId))!;
                var activity = await db.SaveActivityAsync(
                    user.Id,
                    new Activity(
                        Guid.NewGuid(),
                        trip.Id,
                        place.CityId,
                        new("Point", GeographyPoint.Create(35, 139)),
                        new(
                            "Museum",
                            TimeSpan.FromHours(1),
                            "",
                            null,
                            ActivityState.Proposed,
                            ["museum"]
                        ),
                        DateTimeOffset.UtcNow,
                        DateTimeOffset.UtcNow
                    ),
                    place.ContextVersion,
                    null
                );
                var airport = new AirportCatalog().All.First(a => a.Code == "HND");
                await db.RefreshAirportsAsync([airport]);
                var id = kind switch
                {
                    "activity" => activity!.Id,
                    "hotel" => hotel.Id,
                    "home" => other.Id,
                    _ => airport.Id,
                };
                var model = TransportationFixture
                    .Journey(TransportationFixture.Reference("from", kind, id), route: true)
                    .ToModel(Guid.NewGuid(), 0, false);
                var saved = (await db.SaveTransportationAsync(user.Id, trip.Id, model, null))!;
                Assert.AreEqual(1L, saved.Version);
                var before = saved.Features.Single(f => f.Id == "from");
                Assert.IsNotNull(before.Geometry);
                await using var delete = source.CreateCommand(
                    $"DELETE FROM {kind switch { "activity" => "activities", "hotel" => "hotels", "home" => "users", _ => "airports" }} WHERE id=$1"
                );
                delete.Parameters.AddWithValue(id);
                await delete.ExecuteNonQueryAsync();
                var after = (await db.GetTransportationAsync(user.Id, trip.Id)).Single();
                var endpoint = after.Features.Single(f => f.Id == "from");
                Assert.IsNull(endpoint.Properties.Reference);
                Assert.AreEqual(before.Properties.Name, endpoint.Properties.Name);
                Assert.AreEqual(before.Properties.Address, endpoint.Properties.Address);
                Assert.AreEqual(
                    before.Geometry.Coordinates.GetRawText(),
                    endpoint.Geometry!.Coordinates.GetRawText()
                );
                Assert.IsGreaterThan(saved.Version, after.Version);
                Assert.IsFalse(after.RouteStale);
                Assert.AreEqual(model.Notes, after.Notes);
                Assert.IsNotNull(await db.GetDestinationPlaceAsync(user.Id, trip.Id, place.CityId));
            }
        );
    }

    [TestMethod]
    public async Task HotelsSurviveStayChangesAndLinkedMovementInvalidatesRoutes()
    {
        await TripReadPostgresTests.WithDatabase(
            async (_, db) =>
            {
                var user = await db.GetOrCreateUserAsync(
                    new("google", "hotels@example.com", "Traveler")
                );
                var trip = await db.CreateTripAsync(user.Id, "Hotels", "");
                var place = await db.SaveDestinationPlaceAsync(
                    user.Id,
                    new(trip.Id, "tokyo-jp", "Tokyo", "JP", "Asia/Tokyo", 139, 35)
                );
                var visit = (
                    await db.AddDestinationVisitAsync(
                        user.Id,
                        new(trip.Id, place.CityId, Guid.NewGuid(), 0, null, null)
                    )
                )!;
                GeoJsonPoint point = new("Point", GeographyPoint.Create(35, 139));
                await db.SaveStayLocationAsync(
                    user.Id,
                    trip.Id,
                    place.CityId,
                    visit.StayId,
                    new("Feature", visit.StayId.ToString(), point, new("First hotel", "Address"))
                );
                var first = (await db.GetStayLocationsAsync(user.Id, trip.Id))[visit.StayId]
                    .Properties
                    .HotelId!
                    .Value;
                var saved = (
                    await db.SaveTransportationAsync(
                        user.Id,
                        trip.Id,
                        TransportationFixture
                            .Journey(
                                to: TransportationFixture.Reference("to", "hotel", first),
                                route: true
                            )
                            .ToModel(Guid.NewGuid(), 0, false),
                        null
                    )
                )!;
                await db.SaveStayLocationAsync(
                    user.Id,
                    trip.Id,
                    place.CityId,
                    visit.StayId,
                    new("Feature", visit.StayId.ToString(), point, new("Second hotel"))
                );
                Assert.AreEqual(
                    first,
                    (await db.GetTransportationAsync(user.Id, trip.Id))
                        .Single()
                        .Features.Single(f => f.Id == "to")
                        .Properties.Reference!.Id
                );
                await db.DeleteDestinationVisitAsync(user.Id, trip.Id, place.CityId, visit.StayId);
                Assert.HasCount(2, await db.GetHotelsAsync(user.Id, trip.Id));
                var hotel = (await db.GetHotelsAsync(user.Id, trip.Id)).Single(h => h.Id == first);
                await db.SaveHotelAsync(
                    user.Id,
                    trip.Id,
                    hotel with
                    {
                        Geometry = new("Point", GeographyPoint.Create(36, 140)),
                    },
                    hotel.Version
                );
                var moved = (await db.GetTransportationAsync(user.Id, trip.Id)).Single();
                Assert.IsTrue(moved.RouteStale);
                Assert.IsGreaterThan(saved.Version, moved.Version);
                Assert.IsNull(
                    await db.SaveTransportationAsync(user.Id, trip.Id, saved, saved.Version)
                );
                var read = (await db.ReadTripDataAsync(user.Id, trip.Id, CancellationToken.None))!;
                Assert.HasCount(1, read.Transportation);
                Assert.HasCount(2, read.Hotels);
            }
        );
    }

    [TestMethod]
    public async Task ForeignKeysAndUnknownCoordinateDeletionAreEnforcedWithoutTheApi()
    {
        await TripReadPostgresTests.WithDatabase(
            async (source, db) =>
            {
                var user = await db.GetOrCreateUserAsync(
                    new("google", "constraints@example.com", "Traveler")
                );
                var trip = await db.CreateTripAsync(user.Id, "Journey", "");
                var place = await db.SaveDestinationPlaceAsync(
                    user.Id,
                    new(trip.Id, "tokyo-jp", "Tokyo", "JP", "Asia/Tokyo", 139, 35)
                );
                await db.AddDestinationVisitAsync(
                    user.Id,
                    new(trip.Id, place.CityId, Guid.NewGuid(), 0, null, null)
                );
                place = (await db.GetDestinationPlaceAsync(user.Id, trip.Id, place.CityId))!;
                var activity = (
                    await db.SaveActivityAsync(
                        user.Id,
                        new Activity(
                            Guid.NewGuid(),
                            trip.Id,
                            place.CityId,
                            null,
                            new(
                                "Unknown location",
                                null,
                                "",
                                null,
                                ActivityState.Proposed,
                                ["museum"]
                            ),
                            DateTimeOffset.UtcNow,
                            DateTimeOffset.UtcNow
                        ),
                        place.ContextVersion,
                        null
                    )
                )!;
                var saved = (
                    await db.SaveTransportationAsync(
                        user.Id,
                        trip.Id,
                        TransportationFixture
                            .Journey(
                                TransportationFixture.Reference("from", "activity", activity.Id)
                            )
                            .ToModel(Guid.NewGuid(), 0, false),
                        null
                    )
                )!;
                await using (
                    var delete = source.CreateCommand("DELETE FROM activities WHERE id=$1")
                )
                {
                    delete.Parameters.AddWithValue(activity.Id);
                    var error = await Assert.ThrowsAsync<PostgresException>(() =>
                        delete.ExecuteNonQueryAsync()
                    );
                    Assert.AreEqual("23514", error.SqlState);
                }
                Assert.IsNotNull(
                    await db.GetActivityAsync(user.Id, trip.Id, place.CityId, activity.Id)
                );
                await using var invalid = source.CreateCommand(
                    "UPDATE transportation_endpoints SET activity_id=$1 WHERE transportation_id=$2 AND role='from'"
                );
                invalid.Parameters.AddWithValue(Guid.NewGuid());
                invalid.Parameters.AddWithValue(saved.Id);
                Assert.AreEqual(
                    "23503",
                    (
                        await Assert.ThrowsAsync<PostgresException>(() =>
                            invalid.ExecuteNonQueryAsync()
                        )
                    ).SqlState
                );
                await db.DeleteTripAsync(user.Id, trip.Id);
                Assert.IsEmpty(await db.GetTransportationAsync(user.Id, trip.Id));
            }
        );
    }

    [TestMethod]
    public async Task AirportRefreshPreservesIdentityAndRetiresMissingAirports()
    {
        await TripReadPostgresTests.WithDatabase(
            async (_, db) =>
            {
                var airport = new AirportCatalog().All.First(a => a.Code == "HND");
                var first = (await db.RefreshAirportsAsync([airport])).Single();
                var updated = (
                    await db.RefreshAirportsAsync([
                        airport with
                        {
                            Id = Guid.NewGuid(),
                            Name = "Updated name",
                        },
                    ])
                ).Single();
                Assert.AreEqual(first.Id, updated.Id);
                Assert.AreEqual("Updated name", updated.Name);
                var retired = (await db.RefreshAirportsAsync([])).Single();
                Assert.AreEqual(first.Id, retired.Id);
                Assert.IsFalse(retired.Active);
            }
        );
    }
}
