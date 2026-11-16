using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Endpoints;

[TestClass]
public sealed class StayTimesTests
{
    [TestMethod]
    public async Task StayTimesDefaultAndCanBeOverriddenPerVisitWithoutDuplicatingTheHotel()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, user, place, _) = await ActivityPlanningFixture.Seed(factory, client);
        var first = (await factory.Database.GetDestinationVisitsAsync(user.Id, trip.Id)).Single();
        var second = (
            await factory.Database.AddDestinationVisitAsync(
                user.Id,
                first with
                {
                    StayId = Guid.NewGuid(),
                    ArrivalDate = new(2027, 6, 20),
                    DepartureDate = new(2027, 6, 22),
                }
            )
        )!;
        string Path(Guid id) => $"/trips/{trip.Id}/destinations/{place.CityId}/stays/{id}/location";
        var request = new StayLocationRequest(
            "Feature",
            new("Point", GeographyPoint.Create(48.86, 2.35)),
            new("Hotel", "Hotel street")
        );
        Assert.AreEqual(
            HttpStatusCode.OK,
            (await client.PutResourceAsJsonAsync(Path(first.StayId), request)).StatusCode
        );
        var selected = (
            await client.GetFromJsonAsync<GeoJsonFeature<StayLocationProperties>>(
                Path(first.StayId)
            )
        )!;
        Assert.AreEqual(new TimeOnly(16, 0), selected.Properties.CheckInTime);
        Assert.AreEqual(new TimeOnly(11, 0), selected.Properties.CheckOutTime);
        request = request with
        {
            Properties = request.Properties! with { HotelId = selected.Properties.HotelId },
        };
        Assert.AreEqual(
            HttpStatusCode.OK,
            (await client.PutResourceAsJsonAsync(Path(second.StayId), request)).StatusCode
        );
        request = request with
        {
            Properties = request.Properties! with
            {
                CheckInTime = new(18, 30),
                CheckOutTime = new(10, 15),
            },
        };
        Assert.AreEqual(
            HttpStatusCode.OK,
            (await client.PutResourceAsJsonAsync(Path(first.StayId), request)).StatusCode
        );
        var updated = (
            await client.GetFromJsonAsync<GeoJsonFeature<StayLocationProperties>>(
                Path(first.StayId)
            )
        )!;
        var other = (
            await client.GetFromJsonAsync<GeoJsonFeature<StayLocationProperties>>(
                Path(second.StayId)
            )
        )!;
        Assert.AreEqual(selected.Properties.HotelId, updated.Properties.HotelId);
        Assert.AreEqual(new TimeOnly(18, 30), updated.Properties.CheckInTime);
        Assert.AreEqual(new TimeOnly(10, 15), updated.Properties.CheckOutTime);
        Assert.AreEqual(new TimeOnly(16, 0), other.Properties.CheckInTime);
        Assert.AreEqual(new TimeOnly(11, 0), other.Properties.CheckOutTime);
        Assert.HasCount(1, await factory.Database.GetHotelsAsync(user.Id, trip.Id));
        var document = await client.GetFromJsonAsync<JsonElement>($"/trips/{trip.Id}/document");
        var lodging = document
            .GetProperty("itinerary")
            .GetProperty("items")
            .EnumerateArray()
            .Single(item =>
                item.GetProperty("kind").GetString() == "lodging"
                && item.GetProperty("visitId").GetString() == first.StayId.ToString()
            );
        Assert.AreEqual("18:30:00", lodging.GetProperty("checkInTime").GetString());
        Assert.AreEqual("10:15:00", lodging.GetProperty("checkOutTime").GetString());
    }

    [TestMethod]
    [DataRow("4PM")]
    [DataRow("25:00:00")]
    [DataRow("16:00")]
    [DataRow("16:00:00Z")]
    [DataRow("16:00:01")]
    public async Task InvalidStayClocksAreRejected(string time)
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, user, place, _) = await ActivityPlanningFixture.Seed(factory, client);
        var visit = (await factory.Database.GetDestinationVisitsAsync(user.Id, trip.Id)).Single();
        var response = await client.PutResourceAsJsonAsync(
            $"/trips/{trip.Id}/destinations/{place.CityId}/stays/{visit.StayId}/location",
            new
            {
                type = "Feature",
                geometry = new { type = "Point", coordinates = new[] { 2.35, 48.86 } },
                properties = new
                {
                    name = "Hotel",
                    checkInTime = time,
                    checkOutTime = "11:00:00",
                },
            }
        );
        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.IsEmpty(await factory.Database.GetStayLocationsAsync(user.Id, trip.Id));
    }
}
