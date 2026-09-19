using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Tests;

[TestClass]
public class TripsEndpointTests
{
    private static WebApplicationFactory<Program> _factory = null!;

    [ClassInitialize]
    public static void ClassInitialize(TestContext context) =>
        _factory = new WebApplicationFactory<Program>();

    [ClassCleanup]
    public static void ClassCleanup() => _factory.Dispose();

    [TestMethod]
    public async Task PostThenGet_RoundTripsTheTrip()
    {
        using var client = _factory.CreateClient();
        var request = new CreateTripRequest(
            "Lisbon",
            new DateOnly(2026, 10, 1),
            new DateOnly(2026, 10, 8),
            "Scaffold smoke test"
        );

        var created = await client.PostAsJsonAsync("/api/trips", request);

        Assert.AreEqual(HttpStatusCode.Created, created.StatusCode);
        var trip = await created.Content.ReadFromJsonAsync<Trip>();
        Assert.IsNotNull(trip);
        Assert.AreEqual("Lisbon", trip.Destination);
        Assert.AreNotEqual(Guid.Empty, trip.Id);
        Assert.AreEqual($"/api/trips/{trip.Id}", created.Headers.Location?.ToString());

        var fetched = await client.GetFromJsonAsync<Trip>($"/api/trips/{trip.Id}");

        Assert.AreEqual(trip, fetched);
    }

    [TestMethod]
    public async Task Get_UnknownId_ReturnsNotFound()
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync($"/api/trips/{Guid.NewGuid()}");

        Assert.AreEqual(HttpStatusCode.NotFound, response.StatusCode);
    }

    [TestMethod]
    public async Task Post_EndDateBeforeStartDate_ReturnsValidationProblem()
    {
        using var client = _factory.CreateClient();
        var request = new CreateTripRequest(
            "Reykjavik",
            new DateOnly(2026, 10, 8),
            new DateOnly(2026, 10, 1),
            null
        );

        var response = await client.PostAsJsonAsync("/api/trips", request);

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        StringAssert.Contains(await response.Content.ReadAsStringAsync(), "EndDate");
    }

    [TestMethod]
    public async Task Delete_RemovesTheTrip()
    {
        using var client = _factory.CreateClient();
        var created = await client.PostAsJsonAsync(
            "/api/trips",
            new CreateTripRequest(
                "Oslo",
                new DateOnly(2026, 11, 1),
                new DateOnly(2026, 11, 5),
                null
            )
        );
        var trip = await created.Content.ReadFromJsonAsync<Trip>();
        Assert.IsNotNull(trip);

        var deleted = await client.DeleteAsync($"/api/trips/{trip.Id}");
        Assert.AreEqual(HttpStatusCode.NoContent, deleted.StatusCode);

        var refetched = await client.GetAsync($"/api/trips/{trip.Id}");
        Assert.AreEqual(HttpStatusCode.NotFound, refetched.StatusCode);
    }
}
