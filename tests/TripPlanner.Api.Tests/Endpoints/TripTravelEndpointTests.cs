using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Snapshots;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Endpoints;

[TestClass]
public sealed class TripTravelEndpointTests
{
    [TestMethod]
    [DataRow("walk")]
    [DataRow("bike")]
    [DataRow("car")]
    [DataRow("bus")]
    [DataRow("train")]
    [DataRow("transit")]
    [DataRow("flight")]
    public async Task UntimedJourneyRemainsTaskAndSchedulingPreservesItsIdentity(string mode)
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var owner = await TripSnapshotEndpointTests.Seed(factory, client);
        var trip = await factory.Database.CreateTripAsync(owner.Id, "Journey", "");
        var paris = await factory.Database.SaveDestinationPlaceAsync(
            owner.Id,
            new(trip.Id, "paris-fr", "Paris", "FR", "Europe/Paris", 2.35, 48.86)
        );
        var visit = (
            await factory.Database.AddDestinationVisitAsync(
                owner.Id,
                new(trip.Id, paris.CityId, Guid.NewGuid(), 0, null, null)
            )
        )!;
        string path = $"/trips/{trip.Id}/travel";
        var connection = new TravelConnectionRequest(
            Guid.NewGuid(),
            "Travel to Paris",
            new(PlaceId: TripSnapshotProjection.LocalId(trip.Id, "place", "home")),
            new(VisitId: visit.StayId),
            mode,
            DepartureDate: new(2030, 4, 1),
            TimeZone: "America/New_York"
        );
        using var read = await client.GetAsync(path);
        using var request = new HttpRequestMessage(HttpMethod.Put, path)
        {
            Content = JsonContent.Create(
                new TripTravelRequest([connection]),
                options: TripSnapshotProjection.JsonOptions
            ),
        };
        request.Headers.IfMatch.Add(read.Headers.ETag!);
        using var saved = await client.SendAsync(request);
        Assert.AreEqual(
            HttpStatusCode.OK,
            saved.StatusCode,
            await saved.Content.ReadAsStringAsync()
        );
        Assert.AreEqual("\"travel-1\"", saved.Headers.ETag?.ToString());
        async Task<JsonElement> Entry()
        {
            var snapshot = await client.GetFromJsonAsync<JsonElement>($"/trips/{trip.Id}/snapshot");
            return snapshot
                .GetProperty("plan")
                .GetProperty("entries")
                .EnumerateArray()
                .Single(e => e.GetProperty("uid").GetString() == connection.Id.ToString());
        }
        var task = await Entry();
        Assert.AreEqual("Task", task.GetProperty("@type").GetString());
        Assert.IsFalse(task.TryGetProperty("start", out _));
        Assert.AreEqual(
            "2030-04-01",
            task.GetProperty(TripSnapshotProjection.Extension + "departureDate").GetString()
        );
        Assert.AreEqual(
            "America/New_York",
            task.GetProperty(TripSnapshotProjection.Extension + "departureTimeZone").GetString()
        );
        connection = connection with
        {
            DepartureDate = new(2030, 4, 1),
            DepartureTime = new(9, 0),
            TimeZone = "America/New_York",
            DurationOverride = TimeSpan.FromHours(26),
        };
        using var timed = await client.PutResourceAsJsonAsync(
            path,
            new TripTravelRequest([connection]),
            TripSnapshotProjection.JsonOptions
        );
        Assert.AreEqual(
            HttpStatusCode.OK,
            timed.StatusCode,
            await timed.Content.ReadAsStringAsync()
        );
        var calendarEvent = await Entry();
        Assert.AreEqual("Event", calendarEvent.GetProperty("@type").GetString());
        Assert.AreEqual("2030-04-01T09:00:00", calendarEvent.GetProperty("start").GetString());
        Assert.AreEqual(
            "PT26H",
            calendarEvent.GetProperty("duration").GetString(),
            "Elapsed travel must not become a calendar-day duration across DST."
        );
        Assert.AreEqual(connection.Id.ToString(), calendarEvent.GetProperty("uid").GetString());
        using var stale = new HttpRequestMessage(HttpMethod.Put, path)
        {
            Content = JsonContent.Create(new TripTravelRequest([])),
        };
        stale.Headers.IfMatch.Add(read.Headers.ETag!);
        Assert.AreEqual(
            HttpStatusCode.PreconditionFailed,
            (await client.SendAsync(stale)).StatusCode
        );
        await factory.Database.DeleteDestinationVisitAsync(
            owner.Id,
            trip.Id,
            paris.CityId,
            visit.StayId
        );
        Assert.IsEmpty((await factory.Database.GetTripTravelAsync(owner.Id, trip.Id)).Connections);
    }

    [TestMethod]
    public async Task TravelRejectsForeignReferencesWithoutSavingAndRequiresPreconditions()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var owner = await TripSnapshotEndpointTests.Seed(factory, client);
        var trip = await factory.Database.CreateTripAsync(owner.Id, "Trip", "");
        string path = $"/trips/{trip.Id}/travel";
        var input = new TripTravelRequest([
            new(
                Guid.NewGuid(),
                "Unknown",
                new(VisitId: Guid.NewGuid()),
                new(PlaceId: "urn:foreign:place"),
                "train"
            ),
        ]);
        Assert.AreEqual((HttpStatusCode)428, (await client.PutAsJsonAsync(path, input)).StatusCode);
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (await client.PutResourceAsJsonAsync(path, input)).StatusCode
        );
        Assert.AreEqual(0L, (await factory.Database.GetTripTravelAsync(owner.Id, trip.Id)).Version);
    }
}
