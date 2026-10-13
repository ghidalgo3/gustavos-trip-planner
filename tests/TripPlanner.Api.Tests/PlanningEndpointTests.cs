using System.Net;
using System.Net.Http.Json;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Tests;

[TestClass]
public class PlanningEndpointTests
{
    [TestMethod]
    public async Task SaveReload_PreservesDraft()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (user, trip) = await CreateAsync(client);
        string path = $"/trips/{trip.Id}/flights/constraints";
        var current = await client.GetFromJsonAsync<PlanningDocument>(path);
        PlanningParty[] parties = (
            await client.GetFromJsonAsync<PlanningParty[]>($"/trips/{trip.Id}/parties")
        )!;
        Assert.IsNotNull(current);
        Assert.HasCount(1, parties);
        Assert.AreEqual("BOS", parties[0].SuggestedOrigin?.Code);
        var document = new PlanningDocument
        {
            Destination = new("CDG", "Europe/Paris"),
            Parties =
            [
                new()
                {
                    PartyId = parties[0].Id,
                    Origin = new("BOS", "America/New_York"),
                    PreferredAirlines = ["DL"],
                },
            ],
            Constraints =
            [
                new()
                {
                    Id = Guid.NewGuid(),
                    UserId = user.Id!.Value,
                    Type = "departureWindow",
                    Window = new(new(2030, 1, 5), new(2030, 1, 8)),
                },
                new()
                {
                    Id = Guid.NewGuid(),
                    UserId = user.Id!.Value,
                    Type = "returnHomeWindow",
                    Window = new(new(2030, 1, 15), new(2030, 1, 18)),
                },
            ],
        };
        var saved = await client.PutAsJsonAsync(path, document);
        Assert.AreEqual(HttpStatusCode.OK, saved.StatusCode);
        var reloaded = await client.GetFromJsonAsync<PlanningDocument>(path);
        Assert.AreEqual("CDG", reloaded?.Destination?.Code);
        Assert.AreEqual(document.Constraints[0].Id, reloaded?.Constraints[0].Id);
        var beforeUpdate = factory.Database.Trips.Single().FlightConstraints.GetRawText();
        // Editing a trip's description must not erase planning details.
        Assert.AreEqual(
            HttpStatusCode.OK,
            (
                await client.PutAsJsonAsync(
                    $"/trips/{trip.Id}",
                    new UpdateTripRequest("Renamed", "New description")
                )
            ).StatusCode
        );
        Assert.AreEqual(
            beforeUpdate,
            factory.Database.Trips.Single().FlightConstraints.GetRawText()
        );
    }

    [TestMethod]
    public async Task PlanningRoutes_RequireOwnership()
    {
        await using var factory = new TestApplicationFactory();
        using var ownerClient = factory.CreateClient();
        var (owner, trip) = await CreateAsync(ownerClient);
        using var otherClient = factory.CreateClient();
        _ = await CreateAsync(otherClient);
        string path = $"/trips/{trip.Id}/flights/constraints";
        Assert.AreEqual(HttpStatusCode.NotFound, (await otherClient.GetAsync(path)).StatusCode);
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (await otherClient.PutAsJsonAsync(path, new PlanningDocument())).StatusCode
        );
        using var anonymous = factory.CreateClient();
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(path)).StatusCode);
    }

    [TestMethod]
    public async Task Save_RejectsForeignReferencesAndMalformedDocuments()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (user, trip) = await CreateAsync(client);
        string path = $"/trips/{trip.Id}/flights/constraints";
        var invalid = new PlanningDocument
        {
            Constraints =
            [
                new()
                {
                    Id = Guid.NewGuid(),
                    UserId = Guid.NewGuid(),
                    Type = "nonstop",
                },
            ],
        };
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (await client.PutAsJsonAsync(path, invalid)).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (
                await client.PutAsJsonAsync(
                    path,
                    new { schemaVersion = 1, constraints = (object?)null }
                )
            ).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (await client.PutAsJsonAsync(path, new { schemaVersion = 999 })).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.OK,
            (await client.PutAsJsonAsync(path, new PlanningDocument())).StatusCode
        );
    }

    [TestMethod]
    public async Task CalendarDatesPlanWithoutConstraints_AndAirportSuggestions()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (user, trip) = await CreateAsync(client);
        var path = $"/trips/{trip.Id}/flights/constraints";
        var parties = (
            await client.GetFromJsonAsync<PlanningParty[]>($"/trips/{trip.Id}/parties")
        )!;
        var airports = (
            await client.GetFromJsonAsync<TripPlanner.Api.Services.Airport[]>("/airports?q=CDG")
        )!;
        Assert.AreEqual("CDG", airports[0].Code);
        var document = new PlanningDocument
        {
            Destination = airports[0].Location,
            TravelDates = new(new(2030, 1, 5), new(2030, 1, 15)),
            Parties = [new() { PartyId = parties[0].Id, Origin = parties[0].SuggestedOrigin }],
        };
        Assert.AreEqual(
            HttpStatusCode.OK,
            (await client.PutAsJsonAsync(path, document)).StatusCode
        );
        var response = await client.PostAsJsonAsync(
            $"/trips/{trip.Id}/flights:search",
            new StartFlightSearchRequest(Guid.NewGuid())
        );
        Assert.AreEqual(HttpStatusCode.Accepted, response.StatusCode);
    }

    private static async Task<(CurrentUserResponse User, Trip Trip)> CreateAsync(HttpClient client)
    {
        string email = $"{Guid.NewGuid()}@example.com";
        client.DefaultRequestHeaders.Add("X-Test-Subject", email);
        client.DefaultRequestHeaders.Add("X-Test-Email", email);
        var onboarded = await client.PutAsJsonAsync(
            "/user/profile",
            new UserProfile(new("Boston", -71, 42), [])
        );
        var user = (await onboarded.Content.ReadFromJsonAsync<CurrentUserResponse>())!;
        var created = await client.PostAsJsonAsync(
            $"/user/{user.Id}/trips",
            new CreateTripRequest("Test trip", "")
        );
        return (user, (await created.Content.ReadFromJsonAsync<Trip>())!);
    }
}
